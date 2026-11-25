package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.Toolbox

/** Tells the model how far start_toolbox has got, and what to do about it. */
object ToolboxStatus : Tool {
    override val name = "toolbox_status"
    override val description = "Report whether the OpenRA toolbox from start_toolbox is ready, still starting or failed, with the last lines of its log."
    override val inputSchema = JsonSchema.empty()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val status = Toolbox.status(ctx)
        return when (status.state) {
            Toolbox.State.NOT_STARTED -> ToolOutcome.Failure("The toolbox has not been started. Call start_toolbox.")
            Toolbox.State.READY -> ToolOutcome.Success("The toolbox is ready.")
            Toolbox.State.FAILED -> ToolOutcome.Failure("Starting the toolbox failed:\n${status.log}")
            Toolbox.State.STARTING -> ToolOutcome.Success("Still starting. Do not wait for it: tell the user, and check again later.\n${status.log}")
        }
    }
}
