package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.Toolbox;

/** Gets the OpenRA toolbox ready: the image, a long-running container, and a compiled OpenRA in it. */
public final class StartToolbox implements Tool {

    @Override
    public String getName() {
        return "start_toolbox";
    }

    @Override
    public String getDescription() {
        return "Start the OpenRA toolbox that the other OpenRA tools need: builds the Docker image if it is missing, starts the "
                + "container and compiles OpenRA in it. The first time this takes several minutes, so it runs in the background "
                + "and returns at once; check progress with toolbox_status. Restarts the toolbox if it is running.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.empty();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        if (!Toolbox.isDockerRunning(ctx)) {
            return ToolOutcome.failure("Docker is not running. Ask the user to start Docker, then call start_toolbox again.");
        }
        Toolbox.start(ctx);
        return ToolOutcome.success("The toolbox is starting in the background. The first time takes several minutes: tell the user, and check with toolbox_status.");
    }
}
