package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.ModRules;

import java.util.List;

/** From the names players use to the IDs the rules use. */
public final class FindActor implements Tool {

    @Override
    public String getName() {
        return "find_actor";
    }

    @Override
    public String getDescription() {
        return "Find Red Alert actor IDs by their in-game name, like 'medium tank' for 2TNK or 'tesla' for TSLA. "
                + "Use this first whenever the user names a unit or building in their own words. Returns every match with its rules file.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj().string("name", "All or part of the in-game name, like 'tank'").build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String query = input.string("name").strip().toLowerCase();
        List<String> matches = ModRules.actors(ctx.getWorkspace()).stream()
                .filter(actor -> actor.name().toLowerCase().contains(query))
                .map(actor -> actor.id() + ": " + actor.name() + " (" + actor.file() + ")")
                .toList();
        if (matches.isEmpty()) return ToolOutcome.failure("No actor is called anything like '" + query + "'. Try a shorter or more general word.");
        return ToolOutcome.success(String.join("\n", matches));
    }
}
