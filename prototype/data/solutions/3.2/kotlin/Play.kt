package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.Toolbox

/** Packages the checkout and opens the game on the user's machine: the whole "let me try it" job in one call. */
object Play : Tool {
    override val name = "play"
    override val description =
        "Package the current OpenRA checkout, with all changes, and open the game on the user's machine so they can try it. " +
            "Needs the toolbox (start_toolbox). Packaging takes a minute or two: this returns at once, and the game window opens by itself."
    override val inputSchema = JsonSchema.empty()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        if (!Toolbox.isRunning(ctx)) return ToolOutcome.Failure("The toolbox is not running. Call start_toolbox first.")
        Toolbox.packageAndPlay(ctx)
        return ToolOutcome.Success("Packaging started. The game opens by itself in a minute or two; tell the user. If it does not, read ${Toolbox.PLAY_LOG}.")
    }
}
