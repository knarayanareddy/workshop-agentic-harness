import type { AgentEvent, AgentEventListener } from "@harness/api";

/**
 * Rings the terminal bell when the agent needs the human: a guardrail asks for approval, or the turn is over.
 * Not on approval_requested: that event fires after the human has answered.
 */
export const bell = (): AgentEventListener => (event: AgentEvent) => {
  const asks = event.type === "guardrail_decision" && String(event.decision).startsWith("Ask");
  if (asks || event.type === "turn_ended") console.log("\u0007");
};
