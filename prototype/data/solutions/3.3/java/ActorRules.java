package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.CommandResult;
import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.Toolbox;

import java.util.Optional;
import java.util.regex.Pattern;

/** An actor's final rules, inheritance resolved by OpenRA itself instead of by the model. */
public final class ActorRules implements Tool {
    private static final Pattern ACTOR_ID = Pattern.compile("[A-Za-z0-9._-]+");

    @Override
    public String getName() {
        return "actor_rules";
    }

    @Override
    public String getDescription() {
        return "Show the final rules of one Red Alert actor (a unit, building or other object), with everything it inherits merged in. "
                + "Use this instead of reading the YAML files when you need an actor's actual values. Needs the toolbox (start_toolbox).";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj().string("actor", "The actor ID, like 2TNK or TSLA").build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String actor = input.string("actor").strip().toUpperCase();
        if (!ACTOR_ID.matcher(actor).matches()) return ToolOutcome.failure("'" + actor + "' is not an actor ID. IDs look like 2TNK or TSLA.");
        Optional<CommandResult> result = Toolbox.exec(ctx, "openra-rules " + actor);
        if (result.isEmpty()) return ToolOutcome.failure("The toolbox is not running. Call start_toolbox first.");
        String output = result.get().getOutput();
        return result.get().getExitCode() == 0
                ? ToolOutcome.success(output)
                : ToolOutcome.failure("No rules found for " + actor + ":\n" + output.substring(Math.max(0, output.length() - 2_000)));
    }
}
