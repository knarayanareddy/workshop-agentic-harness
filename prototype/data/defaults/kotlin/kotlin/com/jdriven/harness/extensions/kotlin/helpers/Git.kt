package com.jdriven.harness.extensions.kotlin.helpers

import com.jdriven.harness.api.ShellCommand
import com.jdriven.harness.api.Workspace

/**
 * Asks git about the workspace. Runs git directly, not through `run_command`, so no guardrail sees it:
 * guardrails check the model's tool calls, not your own code.
 */
object Git {
    /** The root of the git repository the workspace is in, or `null` when it is in none (or git is not installed). */
    fun repositoryRoot(workspace: Workspace): String? {
        val result = ShellCommand.run(workspace.root, "git rev-parse --show-toplevel")
        return if (result.exitCode == 0) result.output.trim() else null
    }

    /** The branch checked out in [dir] (relative to the workspace), or `null` for a detached HEAD or no repository. */
    fun branch(workspace: Workspace, dir: String): String? {
        val result = ShellCommand.run(workspace.root, "git -C \"$dir\" branch --show-current")
        return if (result.exitCode == 0) result.output.trim().ifEmpty { null } else null
    }

    /** Uncommitted changes in [dir], one per file as `git status --porcelain` prints them, like ` M mods/ra/rules/vehicles.yaml`. */
    fun changes(workspace: Workspace, dir: String): List<String> {
        val result = ShellCommand.run(workspace.root, "git -C \"$dir\" status --porcelain")
        return if (result.exitCode == 0) Text.nonBlankLines(result.output) else emptyList()
    }
}
