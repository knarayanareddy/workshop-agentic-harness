package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * Lets the model look around one directory to learn the project layout.
 * Not recursive; see `glob` for that.
 */
object ListFiles : Tool {

    override val name = "list_files"

    override val description = "List the entries of a workspace directory (not recursive). Directories end with '/'."

    override val inputSchema = JsonSchema.obj()
        .string("path", "Directory relative to the workspace root; '.' for the root", required = false)
        .build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val entries = ctx.workspace.list(input.stringOrNull("path") ?: ".")
        return ToolOutcome.Success(entries.joinToString("\n").ifEmpty { "(empty directory)" })
    }
}
