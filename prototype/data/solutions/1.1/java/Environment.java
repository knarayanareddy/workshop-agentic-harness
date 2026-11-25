package com.jdriven.harness.extensions.java.systemprompt.exercise;

import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Workspace;
import com.jdriven.harness.extensions.java.helpers.Git;
import com.jdriven.harness.extensions.java.helpers.Host;

/** What the harness finds out about where it runs, once at start-up. Static: none of it changes during the session. */
public final class Environment {
    private Environment() {
    }

    public static SystemPromptSection section(Workspace workspace) {
        String git = Git.repositoryRoot(workspace)
                .map(root -> "the workspace is inside the git repository at " + root + ".")
                .orElse("the workspace is not in a git repository, so git cannot undo changes.");
        return new SystemPromptSection.Static("environment", """
                # Environment
                - The session started at %s.
                - The system is %s. Commands run in %s.
                - Git: %s""".formatted(Host.now(), Host.system(), Host.shell(), git));
    }
}
