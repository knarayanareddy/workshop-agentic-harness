package com.jdriven.harness.extensions.kotlin.guardrails.exercise

import com.jdriven.harness.api.Guardrail
import com.jdriven.harness.api.ToolCall
import com.jdriven.harness.api.ToolDecision
import com.jdriven.harness.api.TurnContext
import com.jdriven.harness.extensions.kotlin.helpers.Commands

/**
 * Denies running code straight from the internet: nobody has read it, and it runs with the user's permissions.
 * Any command that both downloads and runs is denied, piped or not: downloading and running are two steps.
 */
class PipeToShellGuardrail : Guardrail {
    override val name = "pipe-to-shell"

    override fun beforeToolUse(call: ToolCall, ctx: TurnContext): ToolDecision {
        val command = Commands.of(call) ?: return ToolDecision.Allow
        val names = Commands.names(command)
        val downloadsAndRuns = names.any { it in DOWNLOADERS } && names.any { RUNNERS.matches(it) }
        if (!downloadsAndRuns && !command.contains("DownloadString", ignoreCase = true)) return ToolDecision.Allow
        return ToolDecision.Deny("Running a script straight from the internet is never allowed. Download it to a file, show it to the user, and let them decide.")
    }

    private companion object {
        val DOWNLOADERS = setOf("curl", "wget", "iwr", "irm", "invoke-webrequest", "invoke-restmethod")
        val RUNNERS = Regex("(ba|z|da|k|fi)?sh|python[0-9.]*|perl|ruby|node|php|iex|invoke-expression")
    }
}
