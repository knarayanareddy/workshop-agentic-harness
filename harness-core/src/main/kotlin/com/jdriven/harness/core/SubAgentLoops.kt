package com.jdriven.harness.core

import com.jdriven.harness.api.AgentConfig
import com.jdriven.harness.api.AgentRuntime
import com.jdriven.harness.api.ApprovalDecision
import com.jdriven.harness.api.ApprovalHandler
import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Message
import com.jdriven.harness.api.ModelClient
import com.jdriven.harness.api.Role
import com.jdriven.harness.api.SubAgentOutcome
import com.jdriven.harness.api.SubAgentRunner
import com.jdriven.harness.api.SubAgentSpec
import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.api.Workspace
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * v2 — the `list_agents` tool: what tells the model that delegation exists at all.
 *
 * A tool cannot advertise a capability the model has no way to discover, so this is the half of
 * delegation that is ordinary extension code. The other half — running the sub-agent — needs the loop
 * and lives in [SubAgentLoops].
 */
class ListAgentsTool(specs: List<SubAgentSpec>) : Tool {
    private val agents = specs.toList()

    override val name = "list_agents"

    override val description: String =
        "Lists the sub-agents this session may delegate to, with the tools each one has. A sub-agent has its own " +
            "context and its own iteration budget, and returns only a short answer, so delegating keeps what it read " +
            "out of this conversation."

    override val inputSchema = JsonSchema(
        buildJsonObject {
            put("type", JsonPrimitive("object"))
            put("properties", buildJsonObject {})
            put("additionalProperties", JsonPrimitive(false))
        },
    )

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        if (agents.isEmpty()) return ToolOutcome.Failure("No sub-agents are available in this session.")
        val lines = agents.map { "- ${it.name}: ${it.description} (tools: ${it.tools.joinToString(", ")}; max ${it.maxIterations} inference calls)" }
        return ToolOutcome.Success("Sub-agents you can delegate to:\n" + lines.joinToString("\n"))
    }
}

/**
 * v2 — builds a [SubAgentRunner]: an [Agent] nested inside a tool call.
 *
 * This is the reason delegation needed the loop rather than an extension. The isolation claims are
 * enforced here rather than promised:
 *
 *  - the child's tool list is built from [spec] alone, so a tool the spec does not name is *unknown*
 *    to the model, not merely denied;
 *  - it gets no transcript: a fresh [Agent], so the parent's history cannot leak in or out;
 *  - it cannot reach a human: its approval handler only denies, and so does its host (no nested
 *    delegation, no acceptEdits of its own);
 *  - it is bounded by [spec]'s iteration budget;
 *  - its own events are not forwarded to the parent's listeners, so the parent's trace stays the
 *    parent's. Only the summary crosses back.
 */
object SubAgentLoops {
    fun runner(
        spec: SubAgentSpec,
        model: ModelClient,
        systemPrompt: List<SystemPromptSection>,
        tools: List<Tool>,
        guardrails: List<Guardrail>,
        workspace: Workspace,
    ): SubAgentRunner {
        val allowed = tools.filter { it.name in spec.tools }.toList()
        val unknown = spec.tools - allowed.map { it.name }.toSet()

        return object : SubAgentRunner {
            override fun run(prompt: String): SubAgentOutcome {
                if (prompt.isBlank()) return SubAgentOutcome.Failed("[sub-agent '${spec.name}': the task was empty]")
                if (unknown.isNotEmpty()) {
                    return SubAgentOutcome.Failed("[sub-agent '${spec.name}' was configured with unknown tools: ${unknown.joinToString()}]")
                }

                var calls = 0
                val counting = ModelClient { request ->
                    calls++
                    model.infer(request)
                }
                val agent = Agent(
                    model = counting,
                    systemPrompt = systemPrompt,
                    tools = allowed,
                    guardrails = guardrails,
                    // A sub-agent that stopped to ask would hang the parent forever, so it may not ask.
                    approvalHandler = ApprovalHandler { ApprovalDecision.Deny("a sub-agent cannot ask the human; decide from what you were given") },
                    listeners = emptyList(),
                    workspace = workspace,
                    config = AgentConfig(maxIterations = spec.maxIterations),
                    // No nested delegation and no inherited acceptEdits: a child may do less than its parent.
                    runtime = object : AgentRuntime {},
                )

                return when (val result = agent.run(prompt)) {
                    is AgentResult.Completed -> SubAgentOutcome.Completed(result.text, calls, agent.messages.count { it.role == Role.Assistant })
                    is AgentResult.Aborted -> SubAgentOutcome.Failed("[sub-agent '${spec.name}' aborted: ${result.reason}]")
                    is AgentResult.LimitReached -> SubAgentOutcome.Failed("[sub-agent '${spec.name}' hit its limit: ${result.limit}]")
                }
            }
        }
    }

    /** Token cost of a child transcript, using the same estimate as the loop, so parent and child compare. */
    fun estimateHistory(messages: List<Message>): Int = messages.sumOf { Tokens.estimate(it) }
}
