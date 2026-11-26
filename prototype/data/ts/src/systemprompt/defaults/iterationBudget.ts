import { dynamicSection } from "@harness/api";

const WARN_AT = 5;

/**
 * Warns the model when it is about to run out of inference calls, so it wraps up instead of being cut off.
 * The dynamic section example (§3): it returns null (emit nothing) until the budget gets tight, and the
 * harness only appends it when the text changes. So it costs a few tokens on the last turns, not on every one.
 */
export const iterationBudget = dynamicSection("iteration_budget", (ctx) =>
  ctx.iterationsRemaining <= WARN_AT
    ? `Only ${ctx.iterationsRemaining} inference calls remain in this turn. Wrap up and report what is left undone.`
    : null,
);
