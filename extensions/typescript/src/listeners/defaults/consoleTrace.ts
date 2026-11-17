import type { AgentEvent, AgentEventListener } from "@harness/api";

const DIM = "\u001B[2m";
const DARK = "\u001B[90m";
const RESET = "\u001B[0m";

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
};

const line = (tag: string, text: string) => console.log(`${DIM}[${tag.padEnd(7)}]${RESET} ${text}`);

/**
 * Lets the human watch the loop: every inference call, tool call and guardrail decision that was not
 * a default, rendered as one line each. ASCII only, because Windows consoles mangle anything else.
 * Makes the context economy visible rather than theoretical.
 */
export const consoleTrace = (): AgentEventListener => (event: AgentEvent) => {
  const e = event as Record<string, any>;
  switch (event.type) {
    case "turn_started":
      return line("turn", `run ${event.runId}`);
    case "inference_requested":
      return line("infer", `#${e.iteration} ~ system ${e.systemTokens} + messages ${e.messageTokens} + tools ${e.toolTokens} tokens [${e.toolNames.join(", ")}]`);
    case "inference_completed": {
      const u = e.usage;
      line("usage", `#${e.iteration} ${e.stopReason}: in ${u.inputTokens} (cache read ${u.cacheReadInputTokens}, write ${u.cacheCreationInputTokens}), out ${u.outputTokens}`);
      for (const block of e.content) {
        if (block.kind === "thinking" && block.thinking.trim() !== "") line("think", `${DARK}${oneLine(block.thinking, 240)}${RESET}`);
      }
      return;
    }
    case "dynamic_section_emitted":
      return line("section", `${e.section} = ${oneLine(e.text, 120)}`);
    case "tool_call_proposed":
      return line("tool", `${e.toolName} ${oneLine(JSON.stringify(e.input), 160)}`);
    case "guardrail_decision":
      if (!e.isDefault) line("guard", `${e.guardrail}.${e.hook} -> ${e.decision}`);
      return;
    case "approval_requested":
      return line("approve", `${e.toolName}: ${e.decision}`);
    case "tool_call_completed": {
      const ok = e.outcome.kind === "success";
      return line("result", `${e.toolName} ${ok ? "ok" : "error"} in ${e.durationMs} ms: ${oneLine(ok ? e.outcome.content : e.outcome.message, 160)}`);
    }
    case "turn_ended":
      return line("end", e.reason);
    case "warning":
      return line("warn", e.message);
    case "log":
      return line("log", `${e.source}: ${e.message}`);
  }
};
