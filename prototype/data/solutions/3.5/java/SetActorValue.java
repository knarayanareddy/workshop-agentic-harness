package com.jdriven.harness.extensions.java.tools.exercise;

import com.jdriven.harness.api.JsonSchema;
import com.jdriven.harness.api.Tool;
import com.jdriven.harness.api.ToolContext;
import com.jdriven.harness.api.ToolInput;
import com.jdriven.harness.api.ToolOutcome;
import com.jdriven.harness.extensions.java.helpers.ModRules;
import com.jdriven.harness.extensions.java.helpers.SetValueResult;

/** Changes one value an actor defines itself. Narrow on purpose: it cannot break the YAML around it. */
public final class SetActorValue implements Tool {

    @Override
    public String getName() {
        return "set_actor_value";
    }

    @Override
    public String getDescription() {
        return "Change one value in a Red Alert actor's own rules, like actor 2TNK, trait Mobile, key Speed, value 80, and return the old "
                + "and new value. Safer than edit_file for rule values. Only changes a key the actor defines itself; for an inherited value it fails and says what to do.";
    }

    @Override
    public JsonSchema getInputSchema() {
        return JsonSchema.obj()
                .string("actor", "The actor ID, like 2TNK")
                .string("trait", "The trait as written in the rules, like Mobile or Armament@PRIMARY")
                .string("key", "The key inside the trait, like Speed")
                .string("value", "The new value, like 80")
                .build();
    }

    @Override
    public ToolOutcome execute(ToolInput input, ToolContext ctx) {
        String actor = input.string("actor").strip();
        String trait = input.string("trait").strip();
        String key = input.string("key").strip();
        String value = input.string("value").strip();
        return switch (ModRules.setValue(ctx.getWorkspace(), actor, trait, key, value)) {
            case SetValueResult.Changed changed ->
                    ToolOutcome.success(actor + " " + trait + "." + key + ": " + changed.oldValue() + " -> " + value + " in " + changed.file());
            case SetValueResult.NoSuchActor none ->
                    ToolOutcome.failure("There is no actor " + actor + " in " + ModRules.RULES + ". Use find_actor to look up the ID.");
            case SetValueResult.NoSuchTrait noTrait -> ToolOutcome.failure(actor + " has no " + trait + " of its own in " + noTrait.file()
                    + ", so it may inherit it. Check with actor_rules, then add an override with edit_file.");
            case SetValueResult.NoSuchKey noKey -> ToolOutcome.failure(actor + "'s " + trait + " has no " + key + " of its own in " + noKey.file()
                    + ", so it may inherit it. Check with actor_rules, then add it with edit_file.");
        };
    }
}
