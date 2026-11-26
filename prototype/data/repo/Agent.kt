package com.jdriven.harness.core

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener
import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.ApprovalRequest
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.EventSink
import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.InferenceDecision
import com.jdriven.harness.api.InferenceRequest
import com.jdriven.harness.api.Message
import com.jdriven.harness.api.ModelClient
import com.jdriven.harness.api.ResultDecision
import com.jdriven.harness.api.Role
import com.jdriven.harness.api.StopReason
import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.ToolDefinition
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.api.TurnDecision
import com.jdriven.harness.api.Workspace
import java.time.Duration
import java.util.UUID

data class AgentConfig(
    /** Inference calls per run before the harness stops with [AgentResult.LimitReached]. */
    val maxIterations: Int = 25,
    /** How often `beforeEndTurn` guardrails may send the model back to work within one run. */
    val maxTurnContinuations: Int = 3,
)

sealed interface AgentResult {
    data class Completed(val text: String) : AgentResult
    data class Aborted(val reason: String) : AgentResult
    data class LimitReached(val limit: String) : AgentResult
}

/**
 * The agent loop. One instance is one session: [run] can be called
 * repeatedly and the transcript accumulates. Not thread-safe — a session processes one turn at a time.
 */
class Agent(
    private val model: ModelClient,
    systemPrompt: List<SystemPromptSection>,
    private val tools: List<Tool>,
    private val guardrails: List<Guardrail>,
    private val approvalHandler: ApprovalHandler,
    private val listeners: List<AgentEventListener>,
    private val workspace: Workspace,
    private val config: AgentConfig = AgentConfig(),
) {
    private val events = EventSink { event -> listeners.forEach { it.onEvent(event) } }

    // Static sections form the system prompt, which is frozen for the whole session. Dynamic sections
    // are rendered into the conversation instead (§3), so nothing ever edits what was already sent.
    private val system: String = systemPrompt.filterIsInstance<SystemPromptSection.Static>().joinToString("\n\n") { it.text }
    private val dynamicSections = systemPrompt.filterIsInstance<SystemPromptSection.Dynamic>()
    private val lastDynamicValue = mutableMapOf<String, String>()

    private val approvedAlways = mutableSetOf<String>()
    private val history = mutableListOf<Message>()

    /** The session transcript so far. */
    val messages: List<Message> get() = history.toList()

    init {
        val toolNames = tools.map { it.name }
        require(toolNames.duplicates().isEmpty()) { "duplicate tool names: ${toolNames.duplicates()}" }
        toolNames.forEach { name ->
            require(SNAKE_CASE.matches(name)) { "'$name' is not snake_case — tool names must match ${SNAKE_CASE.pattern}" }
        }
        val sectionNames = systemPrompt.map { it.name }
        require(sectionNames.duplicates().isEmpty()) { "duplicate system prompt section names: ${sectionNames.duplicates()}" }
    }

    fun run(userMessage: String): AgentResult {
        val runId = UUID.randomUUID().toString().take(8)
        events.emit(AgentEvent.TurnStarted(runId, userMessage))
        appendUser(answerDanglingToolUses() + ContentBlock.Text(userMessage))

        var continuations = 0
        for (iteration in 1..config.maxIterations) {
            var ctx = TurnContext(runId, iteration, config.maxIterations, history.toList(), workspace)

            // [ExtensionPoint] Guardrail.beforeInference — each sees the previous one's rewrite.
            val rewrittenBy = mutableListOf<String>()
            for (g in guardrails) {
                val decision = guarded(runId, g, "beforeInference", { InferenceDecision.Abort("guardrail '${g.name}' failed: ${it.describe()}") }) {
                    g.beforeInference(ctx)
                }
                when (decision) {
                    InferenceDecision.Proceed -> Unit
                    is InferenceDecision.ProceedWith -> {
                        history.clear(); history += decision.messages
                        ctx = ctx.copy(messages = history.toList())
                        rewrittenBy += g.name
                    }
                    is InferenceDecision.Abort -> return end(runId, "aborted: ${decision.reason}") { AgentResult.Aborted(decision.reason) }
                }
            }
            if (rewrittenBy.isNotEmpty()) {
                events.emit(
                    AgentEvent.Warning(
                        runId,
                        "history rewritten by ${rewrittenBy.joinToString()}: the prompt cache restarts, and thinking " +
                            "blocks bound to the old history will be dropped by the API",
                    ),
                )
            }

            // [ExtensionPoint] SystemPromptSection.Dynamic — appended to the outgoing user message.
            renderDynamicSections(ctx)

            val request = InferenceRequest(system, history.toList(), tools.map { ToolDefinition(it.name, it.description, it.inputSchema) })
            events.emit(
                AgentEvent.InferenceRequested(
                    runId, iteration,
                    systemTokens = Tokens.estimate(request.system),
                    messageTokens = request.messages.sumOf { Tokens.estimate(it) },
                    toolTokens = request.tools.sumOf { Tokens.estimate(it) },
                    toolNames = request.tools.map { it.name },
                ),
            )

            val response = model.infer(request)
            events.emit(AgentEvent.InferenceCompleted(runId, iteration, response.stopReason, response.usage, response.content))
            history += Message.assistant(response.content)

            val toolUses = response.content.filterIsInstance<ContentBlock.ToolUse>()
            when (response.stopReason) {
                StopReason.ToolUse if toolUses.isNotEmpty() -> {
                    val toolCtx = ctx.copy(messages = history.toList())
                    // Invariant: every ToolResult goes into ONE user message, in ToolUse order.
                    history += Message.user(toolUses.map { executeToolUse(it, toolCtx) })
                }

                StopReason.ToolUse, StopReason.EndTurn -> {
                    val endCtx = ctx.copy(messages = history.toList())
                    val continueWith = guardrails.mapNotNull { g ->
                        val decision = guarded(runId, g, "beforeEndTurn", { TurnDecision.AllowEnd }) { g.beforeEndTurn(endCtx) }
                        (decision as? TurnDecision.Continue)?.message
                    }
                    if (continueWith.isEmpty()) {
                        return end(runId, "end_turn") { AgentResult.Completed(history.last().text) }
                    }
                    if (continuations >= config.maxTurnContinuations) {
                        events.emit(AgentEvent.Warning(runId, "maxTurnContinuations (${config.maxTurnContinuations}) exhausted; ending the turn although guardrails asked to continue"))
                        return end(runId, "end_turn (continuations exhausted)") { AgentResult.Completed(history.last().text) }
                    }
                    continuations++
                    history += Message.user(continueWith.map { ContentBlock.Text(it) })
                }

                StopReason.MaxTokens -> return end(runId, "max_tokens") { AgentResult.LimitReached("max_tokens") }
                StopReason.Refusal -> return end(runId, "refusal") { AgentResult.Aborted("the model declined to continue (stop_reason: refusal)") }
            }
        }
        return end(runId, "max_iterations") { AgentResult.LimitReached("maxIterations (${config.maxIterations})") }
    }

    private fun renderDynamicSections(ctx: TurnContext) {
        val blocks = dynamicSections.mapNotNull { section ->
            val text = try {
                section.render.render(ctx)
            } catch (e: Exception) {
                events.emit(AgentEvent.Warning(ctx.runId, "dynamic section '${section.name}' failed and was skipped: ${e.describe()}"))
                return@mapNotNull null
            }
            if (text == null) {
                lastDynamicValue.remove(section.name)
                return@mapNotNull null
            }
            if (lastDynamicValue[section.name] == text) return@mapNotNull null
            lastDynamicValue[section.name] = text
            events.emit(AgentEvent.DynamicSectionEmitted(ctx.runId, section.name, text))
            ContentBlock.Text("<context section=\"${section.name}\">\n$text\n</context>")
        }
        if (blocks.isNotEmpty()) appendUser(blocks)
    }

    private fun executeToolUse(use: ContentBlock.ToolUse, ctx: TurnContext): ContentBlock.ToolResult {
        val runId = ctx.runId
        events.emit(AgentEvent.ToolCallProposed(runId, use.id, use.name, use.input))
        val tool = tools.find { it.name == use.name }
            ?: return ContentBlock.ToolResult(use.id, "Unknown tool '${use.name}'. Available tools: ${tools.joinToString { it.name }}", isError = true)
        use.invalidInput?.let { raw ->
            return ContentBlock.ToolResult(use.id, "Not executed: the arguments are not a valid JSON object: $raw\nCall '${use.name}' again with arguments matching its input schema.", isError = true)
        }
        val call = ToolCall(use.id, tool, ToolInput(use.input))

        // [ExtensionPoint] Guardrail.beforeToolUse — first Deny wins; Asks are collected (§5.1).
        val asks = mutableListOf<String>()
        for (g in guardrails) {
            when (val d = guarded(runId, g, "beforeToolUse", { ToolDecision.Deny("guardrail '${g.name}' failed: ${it.describe()}") }) { g.beforeToolUse(call, ctx) }) {
                ToolDecision.Allow -> Unit
                is ToolDecision.Ask -> asks += d.reason
                is ToolDecision.Deny -> return ContentBlock.ToolResult(use.id, "Denied by guardrail '${g.name}': ${d.reason}", isError = true)
            }
        }
        if (asks.isNotEmpty()) {
            denialByHuman(call, asks, runId)?.let { reason ->
                return ContentBlock.ToolResult(use.id, "Denied by the user: $reason", isError = true)
            }
        }

        val started = System.nanoTime()
        var outcome = try {
            tool.execute(call.input, ToolContext(runId, ctx.iteration, use.id, workspace, events))
        } catch (e: Exception) {
            ToolOutcome.Failure(e.describe())
        }
        val duration = Duration.ofNanos(System.nanoTime() - started)

        // [ExtensionPoint] Guardrail.afterToolUse — each sees the previous rewrite; first Reject wins.
        for (g in guardrails) {
            val current = outcome
            when (val d = guarded(runId, g, "afterToolUse", { ResultDecision.Reject("guardrail '${g.name}' failed: ${it.describe()}") }) { g.afterToolUse(call, current, ctx) }) {
                ResultDecision.Accept -> Unit
                is ResultDecision.Replace -> outcome = d.outcome
                is ResultDecision.Reject -> {
                    outcome = ToolOutcome.Failure("${current.text}\n\nRejected by guardrail '${g.name}': ${d.feedback}")
                    break
                }
            }
        }
        events.emit(AgentEvent.ToolCallCompleted(runId, tool.name, outcome, duration))
        return ContentBlock.ToolResult(use.id, outcome.text, isError = outcome is ToolOutcome.Failure)
    }

    /** Consults the [ApprovalHandler] once with all reasons; returns the denial reason, or null if approved. */
    private fun denialByHuman(call: ToolCall, reasons: List<String>, runId: String): String? {
        if (call.tool.name in approvedAlways) {
            events.emit(AgentEvent.ApprovalRequested(runId, call.tool.name, reasons, "approved (always, for this session)"))
            return null
        }
        val decision = try {
            approvalHandler.request(ApprovalRequest(call, reasons))
        } catch (e: Exception) {
            ApprovalDecision.Deny("approval handler failed: ${e.describe()}")
        }
        events.emit(AgentEvent.ApprovalRequested(runId, call.tool.name, reasons, decision.toString()))
        return when (decision) {
            ApprovalDecision.Approve -> null
            ApprovalDecision.ApproveAlways -> { approvedAlways += call.tool.name; null }
            is ApprovalDecision.Deny -> decision.reason
        }
    }

    /** Runs one guardrail hook; a hook that throws gets [onError]'s decision (fail closed). */
    private fun <D : Any> guarded(runId: String, g: Guardrail, hook: String, onError: (Exception) -> D, body: () -> D): D {
        val decision = try {
            body()
        } catch (e: Exception) {
            onError(e)
        }
        events.emit(AgentEvent.GuardrailDecision(runId, g.name, hook, decision.toString(), isDefault = decision in DEFAULT_DECISIONS))
        return decision
    }

    /**
     * A run that stopped on max_tokens can leave ToolUse blocks without results, which the API rejects
     * on the next request. Answer them, so the next turn starts from a valid transcript.
     */
    private fun answerDanglingToolUses(): List<ContentBlock> {
        val last = history.lastOrNull()?.takeIf { it.role == Role.Assistant } ?: return emptyList()
        return last.content.filterIsInstance<ContentBlock.ToolUse>()
            .map { ContentBlock.ToolResult(it.id, "Not executed: the previous response was cut off before this call could run.", isError = true) }
    }

    /** Appends to a trailing user message (one that was never answered) or starts a new one. */
    private fun appendUser(blocks: List<ContentBlock>) {
        val last = history.lastOrNull()
        if (last?.role == Role.User) history[history.lastIndex] = Message.user(last.content + blocks)
        else history += Message.user(blocks)
    }

    private inline fun end(runId: String, reason: String, result: () -> AgentResult): AgentResult {
        events.emit(AgentEvent.TurnEnded(runId, reason))
        return result()
    }

    private companion object {
        val SNAKE_CASE = Regex("[a-z][a-z0-9_]*")
        val DEFAULT_DECISIONS = setOf(InferenceDecision.Proceed, ToolDecision.Allow, ResultDecision.Accept, TurnDecision.AllowEnd)
        fun <T> List<T>.duplicates() = groupingBy { it }.eachCount().filterValues { it > 1 }.keys
    }
}

internal val ToolOutcome.text: String
    get() = when (this) {
        is ToolOutcome.Success -> content
        is ToolOutcome.Failure -> message
    }

internal fun Throwable.describe(): String = message?.takeIf { it.isNotBlank() } ?: this::class.java.simpleName
