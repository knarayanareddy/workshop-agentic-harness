package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Workspace
import com.jdriven.harness.extensions.kotlin.helpers.Text

/** The project's own instructions for agents, read once at start-up. Nothing at all when the project has none. */
object ProjectInstructions {
    private const val FILE = "AGENTS.md"

    fun sections(workspace: Workspace): List<SystemPromptSection> {
        if (!workspace.exists(FILE)) return emptyList()
        val body = Text.truncate(workspace.readText(FILE), 4_000, "[cut here; read $FILE for the rest]")
        return listOf(SystemPromptSection.Static("project_instructions", "# Project instructions, from $FILE\n$body"))
    }
}
