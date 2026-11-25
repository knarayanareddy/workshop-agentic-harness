package com.jdriven.harness.extensions.java.systemprompt.exercise;

import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Workspace;
import com.jdriven.harness.extensions.java.helpers.Text;

import java.util.List;

/** The project's own instructions for agents, read once at start-up. Nothing at all when the project has none. */
public final class ProjectInstructions {
    private static final String FILE = "AGENTS.md";

    private ProjectInstructions() {
    }

    public static List<SystemPromptSection> sections(Workspace workspace) {
        if (!workspace.exists(FILE)) return List.of();
        String body = Text.truncate(workspace.readText(FILE), 4_000, "[cut here; read " + FILE + " for the rest]");
        return List.of(new SystemPromptSection.Static("project_instructions", "# Project instructions, from " + FILE + "\n" + body));
    }
}
