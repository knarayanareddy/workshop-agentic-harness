package com.jdriven.harness.extensions.java.guardrails.exercise;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.extensions.java.helpers.Commands;

import java.util.regex.Pattern;

/**
 * Keeps the model from running Python. An interpreter runs whatever it is given, so it walks around every
 * pattern the other guardrails match on. Deny, not Ask: one press of [a] would approve it for good.
 */
public final class NoPythonGuardrail implements Guardrail {
    /** python, python3, python3.12, py, pip, pip3, uv and uvx; the whole word, so {@code cat script.py} is fine. */
    private static final Pattern PYTHON = Pattern.compile("python[0-9.]*|py|pip[0-9.]*|uvx?");

    @Override
    public String getName() {
        return "no-python";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        String command = Commands.of(call).orElse(null);
        if (command == null) return ToolDecision.allow();
        if (Commands.names(command).stream().noneMatch(name -> PYTHON.matcher(name).matches())) return ToolDecision.allow();
        return ToolDecision.deny("Running Python is not allowed: a script can do anything, out of sight of the guardrails. "
                + "Use the tools instead, or write the script to a file and ask the user to review and run it.");
    }
}
