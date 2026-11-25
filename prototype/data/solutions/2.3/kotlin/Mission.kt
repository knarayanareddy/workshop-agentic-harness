package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection

/** What this harness is for. Replaces the generic default role, and goes first. */
object Mission {
    fun section() = SystemPromptSection.Static(
        name = "mission",
        text = """
            You are a modding assistant for OpenRA, the open-source remake of Command & Conquer: Red Alert.
            The user is a player, not an OpenRA developer. They want to change how the Red Alert mod plays (units, weapons, buildings, missions), then build it and play the result.
            Talk about changes in game terms, like faster, tougher or cheaper, and show the numbers before and after.
            Use the tools to inspect and change files; do not guess file contents.
        """.trimIndent(),
    )
}
