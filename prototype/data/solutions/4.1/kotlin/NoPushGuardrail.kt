package com.jdriven.harness.extensions.kotlin.guardrails.exercise

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.extensions.kotlin.helpers.Commands

/**
 * Nothing from this workshop may reach GitHub: denies every command that could push or open a pull request.
 * Deny, not Ask (§5.4): a push is never acceptable, so no human should be able to approve one.
 */
class NoPushGuardrail : Guardrail {
    override val name = "no-push"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        val command = Commands.of(call) ?: return ToolDecision.Allow
        val reason = when {
            Commands.hasWords(command, "git", "push") -> "Pushing is not allowed"
            Commands.hasWords(command, "git", "send-email") -> "Sending patches upstream is not allowed"
            Commands.hasWords(command, "git", "remote", "add") || Commands.hasWords(command, "git", "remote", "set-url") -> "Changing git remotes is not allowed"
            Commands.hasWords(command, "gh", "pr") || Commands.hasWords(command, "hub", "pull-request") -> "Opening pull requests is not allowed"
            Commands.hasWords(command, "gh", "api") || "api.github.com" in command.lowercase() -> "Calling the GitHub API is not allowed"
            else -> return ToolDecision.Allow
        }
        return ToolDecision.Deny("$reason. Work from this workshop stays on this machine: commit locally if you need to, but never push or open a pull request.")
    }
}
