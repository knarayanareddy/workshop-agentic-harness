package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome

/**
 * The small example tool: shows how a tool reads through the workspace, which keeps every path inside
 * it, and logs what it is doing so the trace shows it. Lets the model size up a file without reading it.
 */
object FileStats : Tool {

    override val name = "file_stats"

    override val description = "Count the lines, words and characters of a text file in the workspace."

    override val inputSchema = JsonSchema.obj().string("path", "Path relative to the workspace root").build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val path = input.string("path")
        val text = ctx.workspace.readText(path)
        ctx.log("counting $path")
        val lines = if (text.isEmpty()) 0 else text.split("\n").size
        val words = text.split(Regex("\\s+")).count { it.isNotEmpty() }
        return ToolOutcome.Success("$path: $lines lines, $words words, ${text.length} characters")
    }
}
