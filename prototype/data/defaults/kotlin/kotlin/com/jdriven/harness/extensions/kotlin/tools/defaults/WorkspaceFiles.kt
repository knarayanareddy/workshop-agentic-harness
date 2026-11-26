package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.ToolContext
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.isRegularFile

private val IGNORED = listOf(".git/", "node_modules/", "build/", "dist/", ".gradle/")

/** Regular files under [dir], sorted, as workspace-relative paths; skips VCS and build output. */
internal fun filesUnder(ctx: ToolContext, dir: String): List<Pair<String, Path>> =
    Files.walk(ctx.workspace.resolve(dir)).use { walk ->
        walk.filter { it.isRegularFile() }
            .map { ctx.workspace.relativize(it) to it }
            .filter { (rel, _) -> IGNORED.none { "/$it" in "/$rel" } }
            .sorted(compareBy { it.first })
            .toList()
    }
