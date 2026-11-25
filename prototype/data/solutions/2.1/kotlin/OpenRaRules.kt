package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection

/** Keeps the agent's work on this machine. Advisory: assignment 4 makes it enforced. */
object OpenRaRules {
    fun section() = SystemPromptSection.Static(
        name = "openra_rules",
        text = """
            # OpenRA rules
            - OpenRA/ is a clone of someone else's public project. Never commit, push or open a pull request on it, even when the user asks.
            - Leave your changes uncommitted. When you are done, list the files you changed, so the user can review and commit them.
        """.trimIndent(),
    )
}
