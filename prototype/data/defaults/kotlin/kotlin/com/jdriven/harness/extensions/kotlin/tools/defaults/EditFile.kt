package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * Lets the model make a small, targeted change without resending the whole file.
 * Fails on a missing or ambiguous match, so the model must be precise.
 */
object EditFile : Tool {

    override val name = "edit_file"

    override val description =
        "Replace one exact piece of text in a workspace file. 'old_text' must occur exactly once (include surrounding lines to make it unique), " +
            "unless 'replace_all' is true. Prefer this over write_file for changing an existing file."

    override val inputSchema = JsonSchema.obj()
        .string("path", "Path relative to the workspace root")
        .string("old_text", "The exact text to replace, including whitespace")
        .string("new_text", "The replacement text")
        .bool("replace_all", "Replace every occurrence instead of requiring a single one (default false)", required = false)
        .build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val path = input.string("path")
        val old = input.string("old_text")
        val new = input.string("new_text")
        if (old.isEmpty()) return ToolOutcome.Failure("'old_text' must not be empty; use write_file to create a file.")
        val text = ctx.workspace.readText(path)
        val count = generateSequence(text.indexOf(old).takeIf { it >= 0 }) { text.indexOf(old, it + old.length).takeIf { i -> i >= 0 } }.count()
        return when {
            count == 0 -> ToolOutcome.Failure("'old_text' not found in $path. Read the file again and copy the text exactly.")
            count > 1 && !input.boolean("replace_all", false) ->
                ToolOutcome.Failure("'old_text' occurs $count times in $path. Add surrounding context to make it unique, or set replace_all.")
            else -> {
                ctx.workspace.writeText(path, text.replace(old, new))
                ToolOutcome.Success("Replaced $count occurrence${if (count == 1) "" else "s"} in $path")
            }
        }
    }
}
