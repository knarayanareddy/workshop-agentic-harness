package com.jdriven.harness.extensions.kotlin.systemprompt.defaults

import com.jdriven.harness.api.SystemPromptSection

/** House rules for how the model works. */
object WorkingAgreements {
    fun section() = SystemPromptSection.Static(
        name = "working_agreements",
        text = """
            # Working agreements
            - Read a file before you change it.
            - When a test fails, fix the code under test, not the test or the build.
            - Finish by summarising what you changed and how you verified it.
            - If OpenRA/ is not checked out in the workspace, tell the user you cannot help them with OpenRA until it is, and do nothing else.
        """.trimIndent(),
    )
}
