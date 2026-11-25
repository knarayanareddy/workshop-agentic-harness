package com.jdriven.harness.extensions.java.systemprompt.exercise;

import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Workspace;
import com.jdriven.harness.extensions.java.helpers.Git;

import java.util.List;

/** OpenRA's branch and uncommitted changes as the session starts, so leftovers from an earlier session are not a surprise. */
public final class OpenRaState {
    private OpenRaState() {
    }

    public static List<SystemPromptSection> sections(Workspace workspace) {
        if (!workspace.exists("OpenRA")) return List.of(); // 1.2 clones it, and a fresh clone has nothing to report
        String branch = Git.branch(workspace, "OpenRA").orElse("a detached HEAD");
        List<String> changes = Git.changes(workspace, "OpenRA");
        String text = changes.isEmpty()
                ? "OpenRA is on " + branch + " with no uncommitted changes."
                : "OpenRA is on " + branch + " and has " + changes.size() + " uncommitted changes from before this session:\n"
                        + String.join("\n", changes.subList(0, Math.min(20, changes.size())))
                        + "\nThe user made these. Mention them before you change those files, and never revert them unless asked.";
        return List.of(new SystemPromptSection.Static("openra_state", text));
    }
}
