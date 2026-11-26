package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.JsonSchema
import com.jdriven.harness.api.Tool
import com.jdriven.harness.api.ToolContext
import com.jdriven.harness.api.ToolInput
import com.jdriven.harness.api.ToolOutcome
import java.nio.file.FileSystems
import java.nio.file.Path

/**
 * Lets the model find files by name or path pattern, e.g. all test files.
 * Used when it does not know where something lives.
 */
object Glob : Tool {

    private const val MAX_RESULTS = 200

    override val name = "glob"

    override val description =
        "Find workspace files whose path matches a glob pattern such as '**/*.kt' or 'src/*/Main.java'. " +
            "Returns at most $MAX_RESULTS paths; .git, build and node_modules are skipped."

    override val inputSchema = JsonSchema.obj()
        .string("pattern", "Glob pattern, matched against the path relative to the workspace root")
        .string("path", "Directory to search, relative to the workspace root (default '.')", required = false)
        .build()

    override fun execute(input: ToolInput, ctx: ToolContext): ToolOutcome {
        val matcher = FileSystems.getDefault().getPathMatcher("glob:${input.string("pattern")}")
        val hits = filesUnder(ctx, input.stringOrNull("path") ?: ".").map { it.first }.filter { matcher.matches(Path.of(it)) }
        if (hits.isEmpty()) return ToolOutcome.Success("No files match.")
        val shown = hits.take(MAX_RESULTS).joinToString("\n")
        return ToolOutcome.Success(if (hits.size > MAX_RESULTS) "$shown\n\n[${hits.size - MAX_RESULTS} more not shown; narrow the pattern]" else shown)
    }
}
