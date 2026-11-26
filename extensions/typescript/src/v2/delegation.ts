// v2 — delegation, written as an extension. The nested loop itself is NOT here: a TypeScript bundle
// cannot run one, so `delegate` asks the JVM through `ctx.delegate`. What lives here is the half the
// extension owns: which agents exist, what the model is told, and what the parent sees back.

import { failure, success, type Tool } from "@harness/api";
import type { SubAgentSpec } from "./contract";

/**
 * The delegates this bundle declares. Small on purpose: a sub-agent is a context-management tool, not a
 * second agent with its own agenda. `explorer` is read-only, so delegating to it cannot change anything.
 */
export const SUB_AGENTS: readonly SubAgentSpec[] = [
  {
    name: "explorer",
    description:
      "read-only investigator: reads files and reports what is there. Cannot write, run commands, or ask you anything",
    tools: ["read_file", "list_files", "glob", "grep", "file_stats", "load_skill"],
    maxIterations: 6,
  },
];

/** A `SubAgentOutcome` for the failure path, so the tool never has to invent one. */
const failed = (reason: string) => ({ kind: "failed" as const, reason });

/**
 * `delegate` — the tool the model calls. It hands the task to a sub-agent and returns ONLY the
 * sub-agent's answer: the files it read never enter the parent's context, which is the whole point.
 *
 * The description states the cost trade-off, because that is the lesson: the summary is paid for, and so
 * was everything the sub-agent read, in a context that no longer exists.
 */
export function delegateTool(agents: readonly SubAgentSpec[] = SUB_AGENTS): Tool {
  const catalog = agents
    .map((a) => `${a.name} (${a.description}; max ${a.maxIterations} inference calls)`)
    .join("; ");
  return {
    name: "delegate",
    description:
      "Hand a self-contained investigation to a sub-agent that has its OWN context and iteration budget. " +
      "It returns a short answer only: what it read never enters this conversation, which is why this is " +
      "cheaper than reading many files yourself. It cannot ask you anything, so the task must be complete. " +
      "Agents: " +
      catalog +
      ".",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: agents.map((a) => a.name), description: "which sub-agent to use" },
        task: {
          type: "string",
          description: "What to find out, and the shape of the answer you want (e.g. 'list the file and line for each').",
        },
      },
      required: ["agent", "task"],
      additionalProperties: false,
    },
    execute(input, ctx) {
      const agent = String((input as { agent?: unknown }).agent ?? "");
      const task = String((input as { task?: unknown }).task ?? "").trim();
      const spec = agents.find((a) => a.name === agent);
      if (!spec) {
        return failure(`Unknown agent '${agent}'. Available: ${agents.map((a) => a.name).join(", ") || "none"}`);
      }
      if (!task) return failure("'task' must say what to find out; a sub-agent cannot ask you for detail.");
      if (!ctx.delegate) {
        // Honest failure: the JVM did not provide a runner, which means this bundle is running somewhere
        // that cannot nest a loop. Saying so beats silently doing the work in the parent's context.
        return failure("Delegation is unavailable in this session: the harness did not provide a sub-agent runner.");
      }
      const outcome = ctx.delegate(spec, task);
      if (outcome.kind === "failed") return failure(outcome.reason ?? "the sub-agent failed without saying why");
      const note = outcome.calls !== undefined ? `\n\n[${spec.name} used ${outcome.calls} inference call(s) in its own context]` : "";
      return success((outcome.text ?? "") + note);
    },
  };
}

/**
 * Keeps a sub-agent inside its own budget. It is a guardrail on the CHILD, not the parent, because that
 * is where the counter belongs: the loop checks it between iterations with a fresh `TurnContext`.
 *
 * Costs are estimated with the same chars/4 rule the harness uses, so the number is comparable with the
 * parent's — the comparison is the whole exercise.
 */
export function budgetGuardrail(limit: number, estimate: (text: string) => number) {
  let spent = 0;
  return {
    name: "sub-agent-budget",
    beforeInference(ctx: { messages: { content: { text?: string; thinking?: string }[] }[] }) {
      // Charge the transcript the child is ABOUT to send, then decide: checking the previous turn's cost
      // would always let one over-budget turn through, which is exactly the turn worth stopping.
      // The peak context is what costs, not the sum of every message ever sent.
      spent = Math.max(spent, ctx.messages.reduce((n, m) => n + m.content.reduce((k, b) => k + estimate(b.text ?? b.thinking ?? ""), 0), 0));
      if (spent > limit) return { kind: "abort", reason: `sub-agent budget of ${limit} tokens is spent (${spent} used)` };
      return { kind: "proceed" };
    },
  };
}
