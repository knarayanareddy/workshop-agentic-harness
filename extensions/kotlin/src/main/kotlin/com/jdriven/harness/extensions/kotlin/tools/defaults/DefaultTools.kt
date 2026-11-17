package com.jdriven.harness.extensions.kotlin.tools.defaults

import com.jdriven.harness.api.Tool

/** The tools a coding agent needs at minimum. All paths are contained by the [com.jdriven.harness.api.Workspace]. */
object DefaultTools {
    /** All default tools, in the order the model sees them. */
    @JvmStatic fun all(): List<Tool> = listOf(ReadFile, WriteFile, EditFile, ListFiles, Glob, Grep, RunCommand, FileStats)
}
