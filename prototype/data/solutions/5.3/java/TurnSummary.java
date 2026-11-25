package com.jdriven.harness.extensions.java.listeners.exercise;

import com.jdriven.harness.api.AgentEvent;
import com.jdriven.harness.api.AgentEventListener;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** One line per turn on what the agent actually did, straight from the events rather than from its own summary. */
public final class TurnSummary implements AgentEventListener {
    private static final Set<String> WRITES = Set.of("write_file", "edit_file", "set_actor_value");

    private final Map<String, Integer> calls = new LinkedHashMap<>();
    private final Set<String> changed = new LinkedHashSet<>();
    private int denied;
    private AgentEvent.ToolCallProposed pending;

    @Override
    public void onEvent(AgentEvent event) {
        if (event instanceof AgentEvent.ToolCallProposed e) {
            pending = e;
            calls.merge(e.getToolName(), 1, Integer::sum);
        } else if (event instanceof AgentEvent.GuardrailDecision e) {
            if (e.getDecision().startsWith("Deny")) denied++;
        } else if (event instanceof AgentEvent.ApprovalRequested e) {
            if (e.getDecision().startsWith("Deny")) denied++;
        } else if (event instanceof AgentEvent.ToolCallCompleted e) {
            if (pending != null && pending.getToolName().equals(e.getToolName())
                    && e.getOutcome() instanceof ToolOutcome.Success && WRITES.contains(e.getToolName())) {
                changed.add(target(pending));
            }
        } else if (event instanceof AgentEvent.TurnEnded) {
            String tools = calls.entrySet().stream().map(c -> c.getKey() + " " + c.getValue()).collect(Collectors.joining(", "));
            int total = calls.values().stream().mapToInt(Integer::intValue).sum();
            System.out.println("[summary] " + total + " tool calls (" + tools + "), " + denied + " denied. Changed: "
                    + (changed.isEmpty() ? "nothing" : String.join(", ", changed)));
            calls.clear();
            changed.clear();
            denied = 0;
        }
    }

    private static String target(AgentEvent.ToolCallProposed call) {
        ToolInput input = new ToolInput(call.getInput());
        String path = input.stringOrNull("path");
        return path != null ? path : input.stringOrNull("actor") + " (" + call.getToolName() + ")";
    }
}
