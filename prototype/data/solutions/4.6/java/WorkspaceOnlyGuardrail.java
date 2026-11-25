package com.jdriven.harness.extensions.java.guardrails.exercise;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.extensions.java.helpers.Commands;

import java.util.Optional;

/**
 * Keeps run_command inside the workspace; the file tools are contained already. A check on the words of the
 * command line, not a sandbox: the command guardrail sends variables, globs and quotes to a human.
 */
public final class WorkspaceOnlyGuardrail implements Guardrail {

    @Override
    public String getName() {
        return "workspace-only";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        String command = Commands.of(call).orElse(null);
        if (command == null) return ToolDecision.allow();
        Optional<String> outside = Commands.words(command).stream()
                .filter(word -> Commands.isOutsideWorkspace(word, ctx.getWorkspace()))
                .findFirst();
        if (outside.isEmpty()) return ToolDecision.allow();
        return ToolDecision.deny("'" + outside.get() + "' is outside the workspace. Everything you need is inside it: use paths relative to the workspace root.");
    }
}
