package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * Lets the model create a new file or replace one completely.
 * For small changes it should prefer `edit_file`.
 */
object WriteFile : Tool {

    override val name = "write_file"

    override val description = "Create or overwrite a UTF-8 text file in the workspace with the given content. Parent directories are created."

    override val inputSchema = JsonSchema.obj()
        .string("path", "Path relative to the workspace root")
        .string("content", "The complete new file content")
        .build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val path = input.string("path")
        val content = input.string("content")
        ctx.workspace.writeText(path, content)
        return ToolOutcome.Success("Wrote ${content.length} characters to $path")
    }
}
