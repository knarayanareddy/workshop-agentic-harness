package com.jdriven.harness.extensions.java.guardrails.exercise;

import com.jdriven.harness.api.Guardrail;
import com.jdriven.harness.api.ToolCall;
import com.jdriven.harness.api.ToolDecision;
import com.jdriven.harness.api.TurnContext;
import com.jdriven.harness.extensions.java.helpers.Commands;

/**
 * Nothing from this workshop may reach GitHub: denies every command that could push or open a pull request.
 * Deny, not Ask (§5.4): a push is never acceptable, so no human should be able to approve one.
 */
public final class NoPushGuardrail implements Guardrail {

    @Override
    public String getName() {
        return "no-push";
    }

    @Override
    public ToolDecision beforeToolUse(ToolCall call, TurnContext ctx) {
        String command = Commands.of(call).orElse(null);
        if (command == null) return ToolDecision.allow();
        String reason;
        if (Commands.hasWords(command, "git", "push")) reason = "Pushing is not allowed";
        else if (Commands.hasWords(command, "git", "send-email")) reason = "Sending patches upstream is not allowed";
        else if (Commands.hasWords(command, "git", "remote", "add") || Commands.hasWords(command, "git", "remote", "set-url")) reason = "Changing git remotes is not allowed";
        else if (Commands.hasWords(command, "gh", "pr") || Commands.hasWords(command, "hub", "pull-request")) reason = "Opening pull requests is not allowed";
        else if (Commands.hasWords(command, "gh", "api") || command.toLowerCase().contains("api.github.com")) reason = "Calling the GitHub API is not allowed";
        else return ToolDecision.allow();
        return ToolDecision.deny(reason + ". Work from this workshop stays on this machine: commit locally if you need to, but never push or open a pull request.");
    }
}
