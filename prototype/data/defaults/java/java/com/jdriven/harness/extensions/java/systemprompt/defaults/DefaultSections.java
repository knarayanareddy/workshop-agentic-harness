package com.jdriven.harness.extensions.java.systemprompt.defaults;

import com.jdriven.harness.api.SystemPromptSection;
import com.jdriven.harness.api.Workspace;

import java.util.List;

/** The default system prompt, in order. */
public final class DefaultSections {
    private DefaultSections() {
    }

    public static List<SystemPromptSection> all(Workspace workspace) {
        return List.of(
                Role.section(workspace),
                WorkingAgreements.section(),
                IterationBudget.section());
    }
}
