package com.jdriven.harness.extensions.kotlin.systemprompt.defaults

import com.jdriven.harness.api.SystemPromptSection

/**
 * Warns the model when it is about to run out of inference calls, so it wraps up instead of being cut off.
 * The dynamic section example (§3): it returns nothing until the budget gets tight, and the harness
 * only appends it when the text changes. So it costs a few tokens on the last turns, not on every one.
 */
object IterationBudget {
    private const val WARN_AT = 5

    /**
     * The section to register. It is recomputed before every inference call and is not part of the
     * frozen system prompt: the harness appends it to the conversation.
     */
    fun section() = SystemPromptSection.Dynamic("iteration_budget") { ctx ->
        if (ctx.iterationsRemaining <= WARN_AT) {
            "Only ${ctx.iterationsRemaining} inference calls remain in this turn. Wrap up and report what is left undone."
        } else {
            null
        }
    }
}
