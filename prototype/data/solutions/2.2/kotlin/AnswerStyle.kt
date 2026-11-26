package com.jdriven.harness.extensions.kotlin.systemprompt.exercise

import com.jdriven.harness.api.SystemPromptSection

/** Short answers: cheaper output tokens, and less for the user to read. */
object AnswerStyle {
    fun section() = SystemPromptSection.Static(
        name = "answer_style",
        text = """
            # How to answer
            - Lead with the answer. No preamble, and do not repeat the question.
            - At most three sentences or a short list, unless the user asks for more.
            - After a change, list each file you changed with one line on what changed and how you checked it.
            Example. User: How fast is the light tank? You: 1TNK has Speed 113 (mods/ra/rules/vehicles.yaml).
        """.trimIndent(),
    )
}
