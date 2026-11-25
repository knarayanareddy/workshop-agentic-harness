package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.ModRules
import com.jdriven.harness.extensions.kotlin.helpers.SetValueResult

/** Changes one value an actor defines itself. Narrow on purpose: it cannot break the YAML around it. */
object SetActorValue : Tool {
    override val name = "set_actor_value"
    override val description =
        "Change one value in a Red Alert actor's own rules, like actor 2TNK, trait Mobile, key Speed, value 80, and return the old " +
            "and new value. Safer than edit_file for rule values. Only changes a key the actor defines itself; for an inherited value it fails and says what to do."
    override val inputSchema = JsonSchema.obj()
        .string("actor", "The actor ID, like 2TNK")
        .string("trait", "The trait as written in the rules, like Mobile or Armament@PRIMARY")
        .string("key", "The key inside the trait, like Speed")
        .string("value", "The new value, like 80")
        .build()

    override fun BROKEN_TYPE_ERROR(execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val actor = input.string("actor").trim()
        val trait = input.string("trait").trim()
        val key = input.string("key").trim()
        val value = input.string("value").trim()
        return when (val result = ModRules.setValue(ctx.workspace, actor, trait, key, value)) {
            is SetValueResult.Changed -> ToolOutcome.Success("$actor $trait.$key: ${result.oldValue} -> $value in ${result.file}")
            is SetValueResult.NoSuchActor -> ToolOutcome.Failure("There is no actor $actor in ${ModRules.RULES}. Use find_actor to look up the ID.")
            is SetValueResult.NoSuchTrait -> ToolOutcome.Failure(
                "$actor has no $trait of its own in ${result.file}, so it may inherit it. Check with actor_rules, then add an override with edit_file.",
            )
            is SetValueResult.NoSuchKey -> ToolOutcome.Failure(
                "$actor's $trait has no $key of its own in ${result.file}, so it may inherit it. Check with actor_rules, then add it with edit_file.",
            )
        }
    }
}
