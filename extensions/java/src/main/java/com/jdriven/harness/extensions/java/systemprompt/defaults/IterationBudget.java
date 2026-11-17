package com.jdriven.harness.extensions.java.systemprompt.defaults;

import com.jdriven.harness.api.SystemPromptSection;

/**
 * Warns the model when it is about to run out of inference calls, so it wraps up instead of being cut off.
 * The dynamic section example (§3): it returns nothing until the budget gets tight, and the harness
 * only appends it when the text changes. So it costs a few tokens on the last turns, not on every one.
 */
public final class IterationBudget {
    private static final int WARN_AT = 5;

    private IterationBudget() {
    }

    /**
     * The section to register. It is recomputed before every inference call and is not part of the
     * frozen system prompt: the harness appends it to the conversation.
     */
    public static SystemPromptSection section() {
        return new SystemPromptSection.Dynamic("iteration_budget", ctx ->
                ctx.getIterationsRemaining() <= WARN_AT
                        ? "Only " + ctx.getIterationsRemaining() + " inference calls remain in this turn. Wrap up and report what is left undone."
                        : null);
    }
}
