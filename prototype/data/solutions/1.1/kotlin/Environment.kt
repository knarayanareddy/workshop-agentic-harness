package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.extensions.kotlin.helpers.Git
import com.jdriven.harness.extensions.kotlin.helpers.Host

/** What the harness finds out about where it runs, once at start-up. Static: none of it changes during the session. */
object Environment {
    fun section(workspace: Workspace): SystemPromptSection {
        val repository = Git.repositoryRoot(workspace)
        val git = if (repository != null) "the workspace is inside the git repository at $repository."
        else "the workspace is not in a git repository, so git cannot undo changes."
        return SystemPromptSection.Static(
            "environment",
            """
                # Environment
                - The session started at ${Host.now()}.
                - The system is ${Host.system()}. Commands run in ${Host.shell()}.
                - Git: $git
            """.trimIndent(),
        )
    }
}
