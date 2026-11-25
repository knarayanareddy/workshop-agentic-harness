package com.jdriven.harness.extensions.java.listeners.exercise;

import com.jdriven.harness.api.AgentEvent;
import com.jdriven.harness.api.AgentEventListener;

/**
 * Rings the terminal bell when the agent needs the human: a guardrail asks for approval, or the turn is over.
 * Not on ApprovalRequested: that event fires after the human has answered.
 */
public final class Bell implements AgentEventListener {
    @Override
    public void onEvent(AgentEvent event) {
        boolean needsYou = (event instanceof AgentEvent.GuardrailDecision e && e.getDecision().startsWith("Ask"))
                || event instanceof AgentEvent.TurnEnded;
        if (!needsYou) return;
        System.out.print("\u0007");
        System.out.flush();
    }
}
