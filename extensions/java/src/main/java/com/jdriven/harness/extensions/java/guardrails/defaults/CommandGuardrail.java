package com.jdriven.harness.extensions.java.guardrails.defaults;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Keeps the model from running dangerous shell commands.
 * Never-acceptable commands are denied outright (don't Ask when you mean Deny).
 * Anything not on the read-only list waits for a human. Only {@code beforeToolUse} is implemented; the other
 * hooks keep their no-op defaults.
 */
public final class CommandGuardrail implements Guardrail {
    private static final List<Pattern> NEVER = List.of(
            Pattern.compile("\\brm\\b(?=[^;&|]*\\s-[a-zA-Z]*[rR])(?=[^;&|]*\\s-[a-zA-Z]*f)"),
            Pattern.compile("\\bgit\\s+push\\b"),
            Pattern.compile("\\bgit\\s+reset\\s+--hard\\b"));

    private static final Pattern READ_ONLY = Pattern.compile(
            "\\s*(ls|dir|cat|type|git\\s+(status|diff|log)|(\\./)?gradlew(\\.bat)?\\s+test)(\\s.*)?");

    /** Anything that can chain, redirect or substitute makes a "read-only" prefix meaningless: `ls; rm x`. */
    private static final Pattern SHELL_CONTROL = Pattern.compile("[;&|<>`\\n\\r]|\\$\\(");

    /**
     * Globs, variables, quotes and escapes become other words when the shell runs, so protected-paths
     * cannot see where they lead: `cat .en*` reads `.env`.
     */
    private static final Pattern SHELL_EXPANSION = Pattern.compile("[*?\\[\\]{}$%~\"'\\\\^]");

    /** `git diff --output=build.gradle.kts` writes a file, read-only list or not. */
    private static final Pattern WRITES_FILE = Pattern.compile("\\s--output\\b");

    @Override
    public String getName() {
        return "command";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        if (!call.getTool().getName().equals("run_command")) return ToolDecision.allow();

        String command = call.getInput().string("command");
        for (Pattern never : NEVER) {
            if (never.matcher(command).find()) {
                return ToolDecision.deny("'" + command + "' is never allowed in this workshop");
            }
        }
        boolean readOnly = READ_ONLY.matcher(command).matches() && !SHELL_CONTROL.matcher(command).find()
                && !SHELL_EXPANSION.matcher(command).find() && !WRITES_FILE.matcher(command).find();
        return readOnly
                ? ToolDecision.allow()
                : ToolDecision.ask("runs a command: " + command);
    }
}
