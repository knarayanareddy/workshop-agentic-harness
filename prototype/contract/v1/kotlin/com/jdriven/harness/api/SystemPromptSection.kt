package com.jdriven.harness.api

// §3 Extension point: SystemPromptSection

sealed interface SystemPromptSection {
    /** Any unique identifier you like; shows up in the trace and labels dynamic sections. */
    val name: String

    /** The common case: fixed text, part of the system prompt, written once at assembly. */
    data class Static(override val name: String, val text: String) : SystemPromptSection

    /**
     * The exception: recomputed before every inference call. Its output is NOT part of the system
     * prompt — the harness appends it to the conversation, and only when the value changed. See §3.
     */
    data class Dynamic(override val name: String, val render: SectionRenderer) : SystemPromptSection
}

/** Returns the section's text for this turn, or `null` to emit nothing. */
fun interface SectionRenderer {
    fun render(ctx: TurnContext): String?
}
