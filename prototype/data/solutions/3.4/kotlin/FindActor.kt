package com.jdriven.harness.extensions.kotlin.tools.exercise

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import com.jdriven.harness.extensions.kotlin.helpers.ModRules

/** From the names players use to the IDs the rules use. */
object FindActor : Tool {
    override val name = "find_actor"
    override val description =
        "Find Red Alert actor IDs by their in-game name, like 'medium tank' for 2TNK or 'tesla' for TSLA. " +
            "Use this first whenever the user names a unit or building in their own words. Returns every match with its rules file."
    override val inputSchema = JsonSchema.obj().string("name", "All or part of the in-game name, like 'tank'").build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val query = input.string("name").trim().lowercase()
        val matches = ModRules.actors(ctx.workspace).filter { query in it.name.lowercase() }
        if (matches.isEmpty()) return ToolOutcome.Failure("No actor is called anything like '$query'. Try a shorter or more general word.")
        return ToolOutcome.Success(matches.joinToString("\n") { "${it.id}: ${it.name} (${it.file})" })
    }
}
