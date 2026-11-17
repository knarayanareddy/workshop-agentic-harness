package com.jdriven.harness.app

import com.jdriven.harness.api.*
import com.jdriven.harness.core.Tokens
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.nio.file.Path
import java.time.Duration
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText

/**
 * Records what the transcript alone does not hold (billed usage per inference, tool durations, approvals,
 * warnings) and renders it together with the session's messages as a self-contained HTML page for /report.
 * One recorder per session: register it as a listener on the [com.jdriven.harness.core.Agent] it reports on.
 */
class SessionRecorder(
    private val model: String,
    private val workspace: Path,
    private val systemPrompt: List<SystemPromptSection> = emptyList(),
) : AgentEventListener {
    private class Inference(val requested: AgentEvent.InferenceRequested) {
        var completed: AgentEvent.InferenceCompleted? = null
    }

    private val started = LocalDateTime.now()
    private val userMessages = mutableSetOf<String>()
    private val inferences = mutableListOf<Inference>()
    private val durations = mutableMapOf<String, Duration>()
    private val toolNotes = mutableMapOf<String, MutableList<String>>()
    private val warnings = mutableListOf<String>()
    private var currentToolUseId: String? = null

    override fun onEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.TurnStarted -> userMessages += event.userMessage
            is AgentEvent.InferenceRequested -> inferences += Inference(event)
            is AgentEvent.InferenceCompleted ->
                inferences.lastOrNull { it.requested.runId == event.runId && it.requested.iteration == event.iteration }?.completed = event
            // Tool calls run one at a time, so everything up to ToolCallCompleted belongs to the last proposed call.
            is AgentEvent.ToolCallProposed -> currentToolUseId = event.toolUseId
            is AgentEvent.ToolCallCompleted -> currentToolUseId?.let { durations[it] = event.duration }
            is AgentEvent.ApprovalRequested -> note("approval: ${event.decision} (${event.reasons.joinToString("; ")})")
            is AgentEvent.GuardrailDecision ->
                if (event.hook != "beforeInference" && event.hook != "beforeEndTurn" && !event.isDefault) {
                    note("guardrail ${event.guardrail} (${event.hook}): ${event.decision}")
                }
            is AgentEvent.Warning -> warnings += event.message
            else -> Unit
        }
    }

    private fun note(text: String) {
        currentToolUseId?.let { toolNotes.getOrPut(it) { mutableListOf() } += text }
    }

    /** Writes the report for [messages] (the session transcript) into [dir] and returns the file. */
    fun writeReport(messages: List<Message>, dir: Path): Path {
        dir.createDirectories()
        val file = dir.resolve("session-${LocalDateTime.now().format(FILE_TIMESTAMP)}.html")
        file.writeText(render(messages))
        return file
    }

    private fun render(messages: List<Message>): String = buildString {
        val completed = inferences.mapNotNull { it.completed }
        val total = completed.fold(Usage(0, 0)) { sum, e ->
            Usage(
                sum.inputTokens + e.usage.inputTokens,
                sum.outputTokens + e.usage.outputTokens,
                sum.cacheReadInputTokens + e.usage.cacheReadInputTokens,
                sum.cacheCreationInputTokens + e.usage.cacheCreationInputTokens,
            )
        }
        val results = messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolResult>().associateBy { it.toolUseId }
        val toolCalls = messages.flatMap { it.content }.filterIsInstance<ContentBlock.ToolUse>()
        val totalInput = total.inputTokens + total.cacheReadInputTokens + total.cacheCreationInputTokens

        append("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">")
        append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">")
        append("<title>Session report</title><style>").append(CSS).append("</style></head><body>")

        append("<header class=\"topbar\"><span class=\"logo-link\">").append(LOGO).append("</span>")
        append("<div class=\"brand\">Agentic <span>Harness</span> <small>session report</small></div>")
        append("<div class=\"spacer\"></div><button class=\"icon-btn\" id=\"themeBtn\" aria-label=\"Toggle theme\">◐</button></header>")

        val title = userMessages.firstOrNull()?.let { if (it.length > 80) it.take(80).trimEnd() + "…" else it } ?: "Empty session"
        append("<main><div class=\"eyebrow\">Session report</div><h1>${esc(title)}</h1><p class=\"lede\">")
        append("Model <code>${esc(model)}</code> · workspace <code>${esc(workspace.toString())}</code><br>")
        append("Started ${started.format(DISPLAY_TIMESTAMP)} · reported ${LocalDateTime.now().format(DISPLAY_TIMESTAMP)}</p>")

        append("<section class=\"cards\">")
        card("Turns", userMessages.size.toString())
        card("Inferences", completed.size.toString())
        card("Tool calls", toolCalls.size.toString(), "${toolCalls.count { results[it.id]?.isError == true }} failed")
        card("Input tokens", fmt(totalInput), "${fmt(total.cacheReadInputTokens)} cached · ${fmt(total.cacheCreationInputTokens)} cache write")
        card("Output tokens", fmt(total.outputTokens))
        card("Cache hit rate", if (totalInput == 0L) "–" else "${total.cacheReadInputTokens * 100 / totalInput}%")
        card("Tool time", ms(durations.values.fold(Duration.ZERO, Duration::plus)))
        append("</section>")

        if (warnings.isNotEmpty()) {
            append("<div class=\"warn\"><ul>")
            warnings.forEach { append("<li>${esc(it)}</li>") }
            append("</ul></div>")
        }

        if (inferences.isNotEmpty()) {
            append("<section><h2>Token usage per inference</h2><div class=\"table-wrap\"><table><thead><tr>")
            append("<th>#</th><th>Run</th><th>Iter</th><th>Stop</th><th class=\"n\">Input</th><th class=\"n\">Cached</th>")
            append("<th class=\"n\">Cache write</th><th class=\"n\">Output</th><th class=\"n\" title=\"Estimates, ≈ chars / 4\">Est. system / messages / tools</th>")
            append("</tr></thead><tbody>")
            inferences.forEachIndexed { i, inf ->
                val r = inf.requested
                val u = inf.completed?.usage
                append("<tr><td>${i + 1}</td><td><code>${esc(r.runId)}</code></td><td>${r.iteration}</td>")
                append("<td>${inf.completed?.stopReason ?: "<span class=\"err\">failed</span>"}</td>")
                append("<td class=\"n\">${u?.let { fmt(it.inputTokens) } ?: "–"}</td>")
                append("<td class=\"n\">${u?.let { fmt(it.cacheReadInputTokens) } ?: "–"}</td>")
                append("<td class=\"n\">${u?.let { fmt(it.cacheCreationInputTokens) } ?: "–"}</td>")
                append("<td class=\"n\">${u?.let { fmt(it.outputTokens) } ?: "–"}</td>")
                append("<td class=\"n muted\">${fmt(r.systemTokens.toLong())} / ${fmt(r.messageTokens.toLong())} / ${fmt(r.toolTokens.toLong())}</td></tr>")
            }
            append("</tbody></table></div></section>")
        }

        systemPromptSection()

        append("<section><h2>Transcript</h2>")
        if (messages.isEmpty()) append("<p class=\"muted\">Nothing yet: the session has no messages.</p>")
        // Match each assistant message to the inference that produced it; a guardrail may have rewritten history in between.
        val usageByContent = completed.groupBy { it.content }.mapValues { ArrayDeque(it.value) }
        var turn = 0
        for (message in messages) {
            when (message.role) {
                Role.User -> message.content.forEach { block ->
                    when {
                        block is ContentBlock.Text && block.text in userMessages ->
                            append("<div class=\"turn\"><div class=\"eyebrow\">Turn ${++turn}</div><div class=\"you\">${esc(block.text)}</div></div>")
                        block is ContentBlock.Text && block.text.startsWith("<context section=") -> {
                            val name = CONTEXT_NAME.find(block.text)?.groupValues?.get(1) ?: "context"
                            append("<details class=\"context\"><summary>Context · ${esc(name)}</summary><pre>${esc(block.text)}</pre></details>")
                        }
                        block is ContentBlock.Text -> append("<div class=\"harness\"><pre>${esc(block.text)}</pre></div>")
                        block is ContentBlock.ToolResult -> Unit // shown with its tool call
                        else -> other(block)
                    }
                }
                Role.Assistant -> {
                    val inference = usageByContent[message.content]?.removeFirstOrNull()
                    append("<article class=\"assistant\"><div class=\"head\"><span class=\"role\">Assistant</span>")
                    inference?.let {
                        append("<span class=\"badge\">${it.stopReason}</span>")
                        append("<span class=\"badge\">in ${fmt(it.usage.inputTokens + it.usage.cacheReadInputTokens + it.usage.cacheCreationInputTokens)}")
                        append(" · out ${fmt(it.usage.outputTokens)}</span>")
                    }
                    append("</div>")
                    message.content.forEach { block ->
                        when (block) {
                            is ContentBlock.Text -> append("<div class=\"text\">${esc(block.text)}</div>")
                            is ContentBlock.Thinking -> append("<details class=\"thinking\"><summary>Thinking</summary><pre>${esc(block.thinking)}</pre></details>")
                            is ContentBlock.RedactedThinking -> append("<div class=\"redacted\">Redacted thinking (${fmt(block.data.length.toLong())} chars, encrypted)</div>")
                            is ContentBlock.ToolUse -> toolCall(block, results[block.id])
                            else -> other(block)
                        }
                    }
                    append("</article>")
                }
            }
        }
        append("</section></main><script>").append(THEME_SCRIPT).append("</script></body></html>\n")
    }

    private fun StringBuilder.card(label: String, value: String, sub: String? = null) {
        append("<div class=\"card\"><div class=\"label\">$label</div><div class=\"value\">${esc(value)}</div>")
        sub?.let { append("<small>${esc(it)}</small>") }
        append("</div>")
    }

    /** Static sections, in order, form the frozen system prompt; dynamic ones only show up in the transcript as context. */
    private fun StringBuilder.systemPromptSection() {
        val static = systemPrompt.filterIsInstance<SystemPromptSection.Static>()
        val dynamic = systemPrompt.filterIsInstance<SystemPromptSection.Dynamic>()
        val full = static.joinToString("\n\n") { it.text }
        append("<section><h2>System prompt</h2>")
        if (systemPrompt.isEmpty()) {
            append("<p class=\"muted\">No system prompt sections are registered.</p></section>")
            return
        }
        append("<div class=\"system-prompt\"><div class=\"head\"><span class=\"role\">System</span>")
        append("<span class=\"badge\">${static.size} static section${if (static.size == 1) "" else "s"}</span>")
        append("<span class=\"badge\" title=\"Estimate, ≈ chars / 4\">≈ ${fmt(Tokens.estimate(full).toLong())} tokens</span>")
        append("<span class=\"badge\">${fmt(full.length.toLong())} chars</span></div>")
        if (static.isEmpty()) append("<p class=\"muted\">No static sections: the system prompt sent to the model is empty.</p>")
        static.forEachIndexed { i, section ->
            append("<details class=\"prompt-section\"><summary><span class=\"idx\">${i + 1}</span>${esc(section.name)}")
            append("<span class=\"badge\">≈ ${fmt(Tokens.estimate(section.text).toLong())} tokens</span></summary>")
            append("<pre>${esc(section.text)}</pre></details>")
        }
        if (dynamic.isNotEmpty()) {
            append("<div class=\"dynamic\"><span class=\"role\">Dynamic</span>")
            dynamic.forEach { append("<span class=\"badge\">${esc(it.name)}</span>") }
            append("<small>Rendered before each inference and appended to the conversation when changed, so they appear in the transcript as context.</small></div>")
        }
        append("</div></section>")
    }

    private fun StringBuilder.toolCall(use: ContentBlock.ToolUse, result: ContentBlock.ToolResult?) {
        val status = when {
            result == null -> "pending"
            result.isError -> "error"
            else -> "ok"
        }
        append("<div class=\"tool $status\"><div class=\"head\"><span class=\"name\">${esc(use.name)}</span>")
        durations[use.id]?.let { append("<span class=\"badge\">${ms(it)}</span>") }
        append("<span class=\"badge $status\">$status</span></div>")
        toolNotes[use.id]?.forEach { append("<div class=\"note\">${esc(it)}</div>") }
        val input = use.invalidInput ?: PRETTY.encodeToString(JsonObject.serializer(), use.input)
        append("<details open><summary>Input</summary><pre>${esc(input)}</pre></details>")
        result?.let { append("<details${if (it.content.length < 2_000) " open" else ""}><summary>Result · ${fmt(it.content.length.toLong())} chars</summary><pre>${esc(it.content)}</pre></details>") }
        append("</div>")
    }

    private fun StringBuilder.other(block: ContentBlock) {
        append("<details class=\"context\"><summary>${esc(block::class.simpleName ?: "block")}</summary><pre>${esc(block.toString())}</pre></details>")
    }

    private companion object {
        val CONTEXT_NAME = Regex("<context section=\"([^\"]*)\"")
        val PRETTY = Json { prettyPrint = true }
        val FILE_TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")
        val DISPLAY_TIMESTAMP: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")

        fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
        fun fmt(n: Long) = "%,d".format(n)
        fun ms(d: Duration) = if (d.toMillis() < 1_000) "${d.toMillis()} ms" else "%.1f s".format(d.toMillis() / 1_000.0)

        val CSS = resource("report.css")
        val LOGO = resource("logo.svg")

        // The theme toggle of workshop.html, under the same storage key so both pages follow one choice.
        const val THEME_SCRIPT = """
(function () {
  var KEY = "agentic-harness-workshop:theme", root = document.documentElement;
  try { var t = JSON.parse(localStorage.getItem(KEY)); if (t) root.setAttribute("data-theme", t); } catch (e) {}
  document.getElementById("themeBtn").addEventListener("click", function () {
    var sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var next = (root.getAttribute("data-theme") || (sysDark ? "dark" : "light")) === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
  });
})();
"""

        fun resource(name: String) = SessionRecorder::class.java.getResource("/report/$name")!!.readText()
    }
}
