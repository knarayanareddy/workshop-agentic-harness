package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.Toolbox;

/** Tells the model how far start_toolbox has got, and what to do about it. */
public final class ToolboxStatus implements Tool {

    @Override
    public String getName() {
        return "toolbox_status";
    }

    @Override
    public String getDescription() {
        return "Report whether the OpenRA toolbox from start_toolbox is ready, still starting or failed, with the last lines of its log.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.empty();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        Toolbox.Status status = Toolbox.status(ctx);
        return switch (status.state()) {
            case NOT_STARTED -> ToolOutcome.failure("The toolbox has not been started. Call start_toolbox.");
            case READY -> ToolOutcome.success("The toolbox is ready.");
            case FAILED -> ToolOutcome.failure("Starting the toolbox failed:\n" + status.log());
            case STARTING -> ToolOutcome.success("Still starting. Do not wait for it: tell the user, and check again later.\n" + status.log());
        };
    }
}
