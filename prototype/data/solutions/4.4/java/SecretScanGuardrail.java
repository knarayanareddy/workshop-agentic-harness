package com.jdriven.harness.extensions.java.guardrails.exercise;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ResultDecision;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.api.TurnContext;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Masks secrets in tool output before the model sees them. Rewriting is honest here: the tool ran as asked,
 * only what it returned is masked. Register it before the result cap, or a cut could leave half a secret.
 */
public final class SecretScanGuardrail implements Guardrail {
    private static final String MASK = "[REDACTED]";

    /** {@code MODEL_API_KEY=...}: keep the name, mask the value. */
    private static final Pattern ASSIGNMENT = Pattern.compile("\\b([A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)=\\S+");

    private static final List<Pattern> SECRETS = List.of(
            Pattern.compile("sk-ant-[A-Za-z0-9_-]{10,}"),
            Pattern.compile("AKIA[0-9A-Z]{16}"),
            Pattern.compile("gh[pousr]_[A-Za-z0-9]{36,}"),
            Pattern.compile("github_pat_[A-Za-z0-9_]{22,}"),
            Pattern.compile("xox[baprs]-[A-Za-z0-9-]{10,}"),
            Pattern.compile("-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----"));

    @Override
    public String getName() {
        return "secret-scan";
    }

    @Override
    public ResultDecision afterToolUse(ToolCall call, ToolOutcome result, TurnContext ctx) {
        if (!(result instanceof ToolOutcome.Success success)) return ResultDecision.accept();
        String masked = ASSIGNMENT.matcher(success.getContent()).replaceAll("$1=" + MASK);
        for (Pattern secret : SECRETS) masked = secret.matcher(masked).replaceAll(MASK);
        return masked.equals(success.getContent()) ? ResultDecision.accept() : ResultDecision.replace(ToolOutcome.success(masked));
    }
}
