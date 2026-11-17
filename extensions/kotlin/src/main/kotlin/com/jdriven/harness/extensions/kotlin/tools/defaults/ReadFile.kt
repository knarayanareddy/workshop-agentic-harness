package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * Lets the model inspect a file before changing it.
 * Large files are truncated, not rejected.
 */
object ReadFile : Tool {

    private const val MAX_CHARS = 50_000

    override val name = "read_file"

    override val description =
        "Read a UTF-8 text file from the workspace. Returns at most $MAX_CHARS characters; longer files are truncated with a note."

    override val inputSchema = JsonSchema.obj().string("path", "Path relative to the workspace root").build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val text = ctx.workspace.readText(input.string("path"))
        return ToolOutcome.Success(
            if (text.length <= MAX_CHARS) text
            else text.take(MAX_CHARS) + "\n\n[truncated: file has ${text.length} characters, showing the first $MAX_CHARS]",
        )
    }
}
