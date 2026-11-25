package com.jdriven.harness.extensions.kotlin.listeners.exercise

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/** One line per turn on what the agent actually did, straight from the events rather than from its own summary. */
class TurnSummary : AgentEventListener {
    private val calls = linkedMapOf<String, Int>()
    private val changed = linkedSetOf<String>()
    private var denied = 0
    private var pending: AgentEvent.ToolCallProposed? = null

    override fun onEvent(event: AgentEvent) {
        when (event) {
            is AgentEvent.ToolCallProposed -> {
                pending = event
                calls.merge(event.toolName, 1, Int::plus)
            }
            is AgentEvent.GuardrailDecision -> if (event.decision.startsWith("Deny")) denied++
            is AgentEvent.ApprovalRequested -> if (event.decision.startsWith("Deny")) denied++
            is AgentEvent.ToolCallCompleted -> {
                val call = pending?.takeIf { it.toolName == event.toolName } ?: return
                if (event.outcome is ToolOutcome.Success && call.toolName in WRITES) changed += target(call)
            }
            is AgentEvent.TurnEnded -> {
                val tools = calls.entries.joinToString { "${it.key} ${it.value}" }
                println("[summary] ${calls.values.sum()} tool calls ($tools), $denied denied. Changed: ${changed.ifEmpty { setOf("nothing") }.joinToString()}")
                calls.clear()
                changed.clear()
                denied = 0
            }
            else -> {}
        }
    }

    private fun target(call: AgentEvent.ToolCallProposed): String {
        val input = ToolInput(call.input)
        return input.stringOrNull("path") ?: "${input.stringOrNull("actor")} (${call.toolName})"
    }

    private companion object {
        val WRITES = setOf("write_file", "edit_file", "set_actor_value")
    }
}
