import type { AgentEvent, AgentEventListener } from "@harness/api";

// Dollars per million tokens. Set these to your model's prices.
const PRICE = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };

/** Adds up what each turn and the whole session cost, from what the API billed. */
export const costMeter = (): AgentEventListener => {
  let turn = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let session = 0;
  return (event: AgentEvent) => {
    const e = event as Record<string, any>;
    if (event.type === "inference_completed") {
      turn.input += e.usage.inputTokens;
      turn.output += e.usage.outputTokens;
      turn.cacheRead += e.usage.cacheReadInputTokens;
      turn.cacheWrite += e.usage.cacheCreationInputTokens;
    } else if (event.type === "turn_ended") {
      const cost = (turn.input * PRICE.input + turn.output * PRICE.output + turn.cacheRead * PRICE.cacheRead + turn.cacheWrite * PRICE.cacheWrite) / 1_000_000;
      session += cost;
      console.log(`[cost   ] this turn: in ${turn.input} (cache read ${turn.cacheRead}, write ${turn.cacheWrite}), out ${turn.output} = $${cost.toFixed(4)}; session $${session.toFixed(4)}`);
      turn = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    }
  };
};
