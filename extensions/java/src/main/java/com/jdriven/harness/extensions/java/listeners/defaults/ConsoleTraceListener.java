package com.jdriven.harness.extensions.java.listeners.defaults;

import com.jdriven.harness.api.AgentEvent;
import com.jdriven.harness.api.AgentEventListener;
import com.jdriven.harness.api.ContentBlock;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.api.Usage;

import java.io.PrintStream;

/**
 * Lets the human watch the loop: every inference call, tool call and guardrail decision that was not
 * a default, rendered as one line each. ASCII only, because Windows consoles mangle anything else.
 * Makes the context economy visible rather than theoretical.
 */
public final class ConsoleTraceListener implements AgentEventListener {
    private static final String DIM = "\u001B[2m";
    private static final String DARK = "\u001B[90m";
    private static final String RESET = "\u001B[0m";

    private final PrintStream out;

    public ConsoleTraceListener() {
        this(System.out);
    }

    public ConsoleTraceListener(PrintStream out) {
        this.out = out;
    }

    @Override
    public void onEvent(AgentEvent event) {
        switch (event) {
            case AgentEvent.TurnStarted e -> line("turn", "run " + e.getRunId());
            case AgentEvent.InferenceRequested e ->
                    line("infer", "#" + e.getIteration() + " ~ system " + e.getSystemTokens() + " + messages " + e.getMessageTokens()
                            + " + tools " + e.getToolTokens() + " tokens [" + String.join(", ", e.getToolNames()) + "]");
            case AgentEvent.InferenceCompleted e -> {
                Usage u = e.getUsage();
                line("usage", "#" + e.getIteration() + " " + e.getStopReason() + ": in " + u.getInputTokens() + " (cache read "
                        + u.getCacheReadInputTokens() + ", write " + u.getCacheCreationInputTokens() + "), out " + u.getOutputTokens());
                for (ContentBlock block : e.getContent()) {
                    if (block instanceof ContentBlock.Thinking t && !t.getThinking().isBlank()) line("think", DARK + oneLine(t.getThinking(), 240) + RESET);
                }
            }
            case AgentEvent.DynamicSectionEmitted e -> line("section", e.getSection() + " = " + oneLine(e.getText(), 120));
            case AgentEvent.ToolCallProposed e -> line("tool", e.getToolName() + " " + oneLine(e.getInput().toString(), 160));
            case AgentEvent.GuardrailDecision e when e.isDefault() -> {
                // Defaults (Allow, Proceed, ...) would drown out the decisions that matter.
            }
            case AgentEvent.GuardrailDecision e -> line("guard", e.getGuardrail() + "." + e.getHook() + " -> " + e.getDecision());
            case AgentEvent.ApprovalRequested e -> line("approve", e.getToolName() + ": " + e.getDecision());
            case AgentEvent.ToolCallCompleted e -> {
                String result = switch (e.getOutcome()) {
                    case ToolOutcome.Success s -> "ok in " + e.getDuration().toMillis() + " ms: " + oneLine(s.getContent(), 160);
                    case ToolOutcome.Failure f -> "error in " + e.getDuration().toMillis() + " ms: " + oneLine(f.getMessage(), 160);
                };
                line("result", e.getToolName() + " " + result);
            }
            case AgentEvent.TurnEnded e -> line("end", e.getReason());
            case AgentEvent.Warning e -> line("warn", e.getMessage());
            case AgentEvent.Log e -> line("log", e.getSource() + ": " + e.getMessage());
        }
    }

    private void line(String tag, String text) {
        out.println(DIM + "[" + String.format("%-7s", tag) + "]" + RESET + " " + text);
    }

    private static String oneLine(String text, int max) {
        String flat = text.replaceAll("\\s+", " ").strip();
        return flat.length() <= max ? flat : flat.substring(0, max - 3) + "...";
    }
}
