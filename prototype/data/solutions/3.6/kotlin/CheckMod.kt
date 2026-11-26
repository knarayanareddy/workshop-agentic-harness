package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.Text
import com.jdriven.harness.extensions.kotlin.helpers.Toolbox

/** Builds and lints the mod, and returns only what the model needs to act on. */
object CheckMod : Tool {
    override val name = "check_mod"
    override val description =
        "Build OpenRA and lint the Red Alert mod's rules and Lua scripts. Run it after every change, before you report the change done. " +
            "Returns 'passed', or the errors to fix. Needs the toolbox (start_toolbox)."
    override val inputSchema = JsonSchema.empty()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val result = Toolbox.exec(ctx, "openra-check")
            ?: return ToolOutcome.Failure("The toolbox is not running. Call start_toolbox first.")
        if (result.timedOut) {
            return ToolOutcome.Failure("The check took longer than ${ShellCommand.TIMEOUT_SECONDS} seconds, usually because OpenRA was compiling. Run check_mod again.")
        }
        if (result.exitCode == 0) return ToolOutcome.Success("The Red Alert mod passed all checks.")
        val errors = Text.nonBlankLines(result.output).filter { !it.startsWith("== ") }.takeLast(30)
        return ToolOutcome.Failure("The check failed. Fix these and run check_mod again:\n${errors.joinToString("\n")}")
    }
}
