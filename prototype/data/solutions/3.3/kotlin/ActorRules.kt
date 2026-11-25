package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.Toolbox

/** An actor's final rules, inheritance resolved by OpenRA itself instead of by the model. */
object ActorRules : Tool {
    private val ACTOR_ID = Regex("[A-Za-z0-9._-]+")

    override val name = "actor_rules"
    override val description =
        "Show the final rules of one Red Alert actor (a unit, building or other object), with everything it inherits merged in. " +
            "Use this instead of reading the YAML files when you need an actor's actual values. Needs the toolbox (start_toolbox)."
    override val inputSchema = JsonSchema.obj().string("actor", "The actor ID, like 2TNK or TSLA").build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val actor = input.string("actor").trim().uppercase()
        if (!ACTOR_ID.matches(actor)) return ToolOutcome.Failure("'$actor' is not an actor ID. IDs look like 2TNK or TSLA.")
        val result = Toolbox.exec(ctx, "openra-rules $actor")
            ?: return ToolOutcome.Failure("The toolbox is not running. Call start_toolbox first.")
        return if (result.exitCode == 0) ToolOutcome.Success(result.output)
        else ToolOutcome.Failure("No rules found for $actor:\n${result.output.takeLast(2_000)}")
    }
}
