package com.jdriven.harness.extensions.java.guardrails.exercise;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.extensions.java.helpers.Commands;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Denies running code straight from the internet: nobody has read it, and it runs with the user's permissions.
 * Any command that both downloads and runs is denied, piped or not: downloading and running are two steps.
 */
public final class PipeToShellGuardrail implements Guardrail {
    private static final Set<String> DOWNLOADERS = Set.of("curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod");
    private static final Pattern RUNNERS = Pattern.compile("(ba|z|da|k|fi)?sh|python[0-9.]*|perl|ruby|node|php|iex|invoke-expression");

    @Override
    public String getName() {
        return "pipe-to-shell";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        String command = Commands.of(call).orElse(null);
        if (command == null) return ToolDecision.allow();
        List<String> names = Commands.names(command);
        boolean downloadsAndRuns = names.stream().anyMatch(DOWNLOADERS::contains)
                && names.stream().anyMatch(name -> RUNNERS.matcher(name).matches());
        if (!downloadsAndRuns && !command.toLowerCase().contains("downloadstring")) return ToolDecision.allow();
        return ToolDecision.deny("Running a script straight from the internet is never allowed. Download it to a file, show it to the user, and let them decide.");
    }
}
