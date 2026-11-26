import type { AgentEvent, AgentEventListener } from "@harness/api";

const WRITES = new Set(["write_file", "edit_file", "set_actor_value"]);

/** One line per turn on what the agent actually did, straight from the events rather than from its own summary. */
export const turnSummary = (): AgentEventListener => {
  const calls = new Map<string, number>();
  const changed = new Set<string>();
  let denied = 0;
  let pending: Record<string, any> | null = null;
  return (event: AgentEvent) => {
    const e = event as Record<string, any>;
    switch (event.type) {
      case "tool_call_proposed":
        pending = e;
        calls.set(e.toolName, (calls.get(e.toolName) ?? 0) + 1);
        break;
      case "guardrail_decision":
      case "approval_requested":
        if (String(e.decision).startsWith("Deny")) denied++;
        break;
      case "tool_call_completed":
        if (pending && pending.toolName === e.toolName && e.outcome.kind === "success" && WRITES.has(e.toolName)) {
          changed.add(pending.input.path ?? `${pending.input.actor} (${e.toolName})`);
        }
        break;
      case "turn_ended": {
        const tools = [...calls].map(([name, n]) => `${name} ${n}`).join(", ");
        const total = [...calls.values()].reduce((a, b) => a + b, 0);
        console.log(`[summary] ${total} tool calls (${tools}), ${denied} denied. Changed: ${changed.size ? [...changed].join(", ") : "nothing"}`);
        calls.clear();
        changed.clear();
        denied = 0;
      }
    }
  };
};
