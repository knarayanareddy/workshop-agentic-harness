package com.jdriven.harness.extensions.kotlin.systemprompt.defaults

import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Workspace

/** The default system prompt, in order. */
object DefaultSections {
    fun all(workspace: Workspace): List<SystemPromptSection> = listOf(
        Role.section(workspace),
        WorkingAgreements.section(),
        IterationBudget.section(),
    )
}
