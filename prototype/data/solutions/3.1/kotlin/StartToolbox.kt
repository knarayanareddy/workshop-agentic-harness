package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.Toolbox

/** Gets the OpenRA toolbox ready: the image, a long-running container, and a compiled OpenRA in it. */
object StartToolbox : Tool {
    override val name = "start_toolbox"
    override val description =
        "Start the OpenRA toolbox that the other OpenRA tools need: builds the Docker image if it is missing, starts the " +
            "container and compiles OpenRA in it. The first time this takes several minutes, so it runs in the background " +
            "and returns at once; check progress with toolbox_status. Restarts the toolbox if it is running."
    override val inputSchema = JsonSchema.empty()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        if (!Toolbox.isDockerRunning(ctx)) {
            return ToolOutcome.Failure("Docker is not running. Ask the user to start Docker, then call start_toolbox again.")
        }
        Toolbox.start(ctx)
        return ToolOutcome.Success("The toolbox is starting in the background. The first time takes several minutes: tell the user, and check with toolbox_status.")
    }
}
