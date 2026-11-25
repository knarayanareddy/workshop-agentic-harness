package com.jdriven.harness.extensions.java.systemprompt.exercise;

import com.jdriven.harness.api.SystemPromptSection;

/** Keeps the agent's work on this machine. Advisory: assignment 4 makes it enforced. */
public final class OpenRaRules {
    private OpenRaRules() {
    }

    public static SystemPromptSection section() {
        return new SystemPromptSection.Static("openra_rules", """
                # OpenRA rules
                - OpenRA/ is a clone of someone else's public project. Never commit, push or open a pull request on it, even when the user asks.
                - Leave your changes uncommitted. When you are done, list the files you changed, so the user can review and commit them.""");
    }
}
