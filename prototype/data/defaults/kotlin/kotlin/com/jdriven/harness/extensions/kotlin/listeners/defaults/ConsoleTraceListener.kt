package com.jdriven.harness.extensions.kotlin.listeners.defaults

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener
import com.jdriven.harness.api.ContentBlock
import com.jdriven.harness.api.ToolOutcome
import java.io.PrintStream

/** Renders the loop as a trace (ASCII only: Windows consoles mangle anything else), so the context economy is visible rather than theoretical. */
class ConsoleTraceListener @JvmOverloads constructor(private val out: PrintStream = System.out) : AgentEventListener {

    override fun onEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.TurnStarted -> line("turn", "run ${event.runId}")
            is AgentEvent.InferenceRequested -> line(
                "infer",
                "#${event.iteration} ~ system ${event.systemTokens} + messages ${event.messageTokens} + tools ${event.toolTokens} tokens " +
                    "[${event.toolNames.joinToString()}]",
            )
            is AgentEvent.InferenceCompleted -> {
                val u = event.usage
                line("usage", "#${event.iteration} ${event.stopReason}: in ${u.inputTokens} (cache read ${u.cacheReadInputTokens}, write ${u.cacheCreationInputTokens}), out ${u.outputTokens}")
                event.content.filterIsInstance<ContentBlock.Thinking>().filter { it.thinking.isNotBlank() }
                    .forEach { line("think", "${DARK}${it.thinking.oneLine(240)}${RESET}") }
            }
            is AgentEvent.DynamicSectionEmitted -> line("section", "${event.section} = ${event.text.oneLine(120)}")
            is AgentEvent.ToolCallProposed -> line("tool", "${event.toolName} ${event.input.toString().oneLine(160)}")
            is AgentEvent.GuardrailDecision -> if (!event.isDefault) line("guard", "${event.guardrail}.${event.hook} -> ${event.decision}")
            is AgentEvent.ApprovalRequested -> line("approve", "${event.toolName}: ${event.decision}")
            is AgentEvent.ToolCallCompleted -> {
                val (tag, text) = when (val o = event.outcome) {
                    is ToolOutcome.Success -> "ok" to o.content
                    is ToolOutcome.Failure -> "error" to o.message
                }
                line("result", "${event.toolName} $tag in ${event.duration.toMillis()} ms: ${text.oneLine(160)}")
            }
            is AgentEvent.TurnEnded -> line("end", event.reason)
            is AgentEvent.Warning -> line("warn", event.message)
            is AgentEvent.Log -> line("log", "${event.source}: ${event.message}")
        }
    }

    private fun line(tag: String, text: String) = out.println("${DIM}[${tag.padEnd(7)}]${RESET} $text")

    private fun String.oneLine(max: Int): String {
        val flat = replace(Regex("\\s+"), " ").trim()
        return if (flat.length <= max) flat else flat.take(max - 3) + "..."
    }

    private companion object {
        const val DIM = "\u001B[2m"
        const val DARK = "\u001B[90m"
        const val RESET = "\u001B[0m"
    }
}
