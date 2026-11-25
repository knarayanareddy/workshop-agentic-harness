package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.extensions.kotlin.helpers.Git

/** OpenRA's branch and uncommitted changes as the session starts, so leftovers from an earlier session are not a surprise. */
object OpenRaState {
    fun sections(workspace: Workspace): List<SystemPromptSection> {
        if (!workspace.exists("OpenRA")) return emptyList() // 1.2 clones it, and a fresh clone has nothing to report
        val branch = Git.branch(workspace, "OpenRA") ?: "a detached HEAD"
        val changes = Git.changes(workspace, "OpenRA")
        val text = if (changes.isEmpty()) {
            "OpenRA is on $branch with no uncommitted changes."
        } else {
            "OpenRA is on $branch and has ${changes.size} uncommitted changes from before this session:\n" +
                changes.take(20).joinToString("\n") +
                "\nThe user made these. Mention them before you change those files, and never revert them unless asked."
        }
        return listOf(SystemPromptSection.Static("openra_state", text))
    }
}
