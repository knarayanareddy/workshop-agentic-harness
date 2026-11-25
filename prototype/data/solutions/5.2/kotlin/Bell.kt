package com.jdriven.harness.extensions.kotlin.listeners.exercise

import com.jdriven.harness.api.AgentEvent
import com.jdriven.harness.api.AgentEventListener

/**
 * Rings the terminal bell when the agent needs the human: a guardrail asks for approval, or the turn is over.
 * Not on ApprovalRequested: that event fires after the human has answered.
 */
class Bell : AgentEventListener {
    override fun onEvent(event: AgentEvent) {
        val needsYou = (event is AgentEvent.GuardrailDecision && event.decision.startsWith("Ask")) || event is AgentEvent.TurnEnded
        if (!needsYou) return
        print("\u0007")
        System.out.flush()
    }
}
