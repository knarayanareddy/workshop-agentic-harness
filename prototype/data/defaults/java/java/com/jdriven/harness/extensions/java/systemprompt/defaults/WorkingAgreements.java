package com.jdriven.harness.extensions.java.systemprompt.defaults;

import com.jdriven.harness.api.SystemPromptSection;

/** House rules for how the model works. */
public final class WorkingAgreements {
    private WorkingAgreements() {
    }

    public static SystemPromptSection section() {
        return new SystemPromptSection.Static("working_agreements", """
                # Working agreements
                - Read a file before you change it.
                - When a test fails, fix the code under test, not the test or the build.
                - Finish by summarising what you changed and how you verified it.
                - If OpenRA/ is not checked out in the workspace, tell the user you cannot help them with OpenRA until it is, and do nothing else.""");
    }
}
