package com.jdriven.harness.extensions.java.guardrails.defaults;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ResultDecision;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.api.TurnContext;

/**
 * Keeps one runaway tool result from filling the model's context.
 * A safety net, not the first line of defence (§5.4): a tool should cap and describe its own
 * output. This only catches the tools that did not. Only {@code afterToolUse} is implemented.
 */
public final class ResultCapGuardrail implements Guardrail {
    private final int maxChars;

    public ResultCapGuardrail() {
        this(30_000);
    }

    /**
     * @param maxChars the longest successful result that passes through unchanged
     */
    public ResultCapGuardrail(int maxChars) {
        this.maxChars = maxChars;
    }

    @Override
    public String getName() {
        return "result-cap";
    }

    @Override
    public ResultDecision afterToolUse(ToolCall call, ToolOutcome result, TurnContext ctx) {
        if (!(result instanceof ToolOutcome.Success success) || success.getContent().length() <= maxChars) {
            return ResultDecision.accept();
        }
        String content = success.getContent();
        return ResultDecision.replace(ToolOutcome.success(content.substring(0, maxChars)
                + "\n\n[truncated by result-cap: " + content.length() + " characters, showing the first " + maxChars
                + ". Ask for less: narrow the path or pattern.]"));
    }
}
