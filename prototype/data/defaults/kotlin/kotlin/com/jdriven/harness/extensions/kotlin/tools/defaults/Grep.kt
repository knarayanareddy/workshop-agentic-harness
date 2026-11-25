package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import java.io.IOException
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path

/**
 * Lets the model find where something is used or defined by searching file contents.
 * Saves it from reading every file.
 */
object Grep : Tool {

    private const val MAX_MATCHES = 100

    override val name = "grep"

    override val description =
        "Search workspace files for lines matching a regular expression. Returns at most $MAX_MATCHES matches as path:line: text; " +
            ".git, build and node_modules are skipped. Use 'include' to restrict to a glob such as '**/*.kt'."

    override val inputSchema = JsonSchema.obj()
        .string("pattern", "Java regular expression")
        .string("path", "Directory to search, relative to the workspace root (default '.')", required = false)
        .string("include", "Only search files whose path matches this glob", required = false)
        .build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val regex = Regex(input.string("pattern"))
        val include = input.stringOrNull("include")?.let { FileSystems.getDefault().getPathMatcher("glob:$it") }
        val matches = mutableListOf<String>()
        var total = 0
        for ((rel, file) in filesUnder(ctx, input.stringOrNull("path") ?: ".")) {
            if (include != null && !include.matches(Path.of(rel))) continue
            val lines = try { Files.readAllLines(file) } catch (_: IOException) { continue } // binary or unreadable
            lines.forEachIndexed { i, line ->
                if (regex.containsMatchIn(line) && total++ < MAX_MATCHES) matches += "$rel:${i + 1}: ${line.trim().take(300)}"
            }
        }
        if (total == 0) return ToolOutcome.Success("No matches.")
        val shown = matches.joinToString("\n")
        return ToolOutcome.Success(if (total > MAX_MATCHES) "$shown\n\n[$total matches, showing the first $MAX_MATCHES; narrow the pattern or path]" else shown)
    }
}
