package com.jdriven.harness.extensions.kotlin.systemprompt.defaults

import com.jdriven.harness.api.SystemPromptSection
import com.jdriven.harness.api.Workspace

/** Tells the model what it is and to use its tools instead of guessing. */
object Role {
    fun section(workspace: Workspace) = SystemPromptSection.Static(
        "role",
        "You are a coding agent working in the directory ${workspace.root.fileName}. " +
            "Use the tools to inspect and change files; do not guess file contents.",
    )
}
