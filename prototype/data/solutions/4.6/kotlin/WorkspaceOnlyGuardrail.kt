package com.jdriven.harness.extensions.kotlin.guardrails.exercise

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.extensions.kotlin.helpers.Commands

/**
 * Keeps run_command inside the workspace; the file tools are contained already. A check on the words of the
 * command line, not a sandbox: the command guardrail sends variables, globs and quotes to a human.
 */
class WorkspaceOnlyGuardrail : Guardrail {
    override val name = "workspace-only"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        val command = Commands.of(call) ?: return ToolDecision.Allow
        val outside = Commands.words(command).firstOrNull { Commands.isOutsideWorkspace(it, ctx.workspace) } ?: return ToolDecision.Allow
        return ToolDecision.Deny("'$outside' is outside the workspace. Everything you need is inside it: use paths relative to the workspace root.")
    }
}
