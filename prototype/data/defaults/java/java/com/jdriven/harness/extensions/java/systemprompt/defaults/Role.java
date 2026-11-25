package com.jdriven.harness.extensions.java.systemprompt.defaults;

import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Workspace;

/** Tells the model what it is and to use its tools instead of guessing. */
public final class Role {
    private Role() {
    }

    public static SystemPromptSection section(Workspace workspace) {
        return new SystemPromptSection.Static("role",
                "You are a coding agent working in the directory " + workspace.getRoot().getFileName() + ". "
                        + "Use the tools to inspect and change files; do not guess file contents.");
    }
}
