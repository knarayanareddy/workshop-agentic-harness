// The deterministic replay driver: a ScriptedModelClient (prototype/data/repo/ScriptedModelClient.kt) whose "script" is a
// function of the transcript, so a scenario survives a different branch (denial → alternative) and can be forked mid-run.
// SIMULATION BOUNDARY: this is not an LLM. It encodes what the worksheet *predicts* a model does, per scenario.
import type { ContentBlock, Message } from "@harness/api";
import type { InferenceRequest, InferenceResponse, ModelClient } from "./agent";
import { rng, type SimProvider } from "./provider";

export interface PlannedCall { name: string; input: Record<string, unknown> }
export interface Step { text?: string; think?: string; calls?: PlannedCall[] }
export interface ToolRound { name: string; text: string; isError: boolean; denied: boolean; deniedByUser: boolean }

export interface ModelView {
  request: InferenceRequest;
  /** inference index inside the current user turn (0-based): replay-safe, derived from the transcript */
  step: number;
  /** 0-based index of the current user turn in the session */
  turn: number;
  userText: string;
  seed: number;
  /** deterministic draw: same scenario + seed → same branch */
  rand: () => number;
  pick: <T>(...options: T[]) => T;
  version: 1 | 2;
  /** v2 runs `run_command` with argv instead of a shell string */
  argvMode: boolean;
  tools: string[];
  hasTool: (name: string) => boolean;
  sys: string;
  sysHas: (s: string | RegExp) => boolean;
  /** text of every <context section=…> block seen so far in this turn */
  contexts: string[];
  contextHas: (s: string | RegExp) => boolean;
  last: ToolRound[];
  lastText: string;
  /** every tool round of this user turn, oldest first */
  rounds: ToolRound[][];
  /** how many calls to `name` happened in this turn */
  callCount: (name: string) => number;
  sh: (command: string) => PlannedCall;
}
export type Plan = (v: ModelView) => Step;

export const say = (text: string, think?: string): Step => ({ text, think });
export const call = (name: string, input: Record<string, unknown> = {}, text?: string, think?: string): Step => ({ text, think, calls: [{ name, input }] });
export const calls = (...c: PlannedCall[]): Step => ({ calls: c });
export const c = (name: string, input: Record<string, unknown> = {}): PlannedCall => ({ name, input });

/** Steps are consumed in order; a function step may branch on the view, or return null to fall through to the next step. */
export function script(...steps: (Step | ((v: ModelView) => Step | null))[]): Plan {
  return (v) => {
    for (let i = v.step; i < steps.length; i++) {
      const s = steps[i];
      const r = typeof s === "function" ? s(v) : s;
      if (r) return r;
    }
    return say("Done.");
  };
}

export function splitArgv(command: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const isContext = (b: ContentBlock) => b.kind === "text" && b.text.startsWith("<context section=");
const isRealUser = (m: Message) => m.role === "user" && m.content.some((b) => b.kind === "text" && !isContext(b));

export class MockModel implements ModelClient {
  readonly requests: InferenceRequest[] = [];
  private counter = 0;
  private readonly rand: () => number;
  constructor(private readonly plan: Plan, private readonly provider: SimProvider, private readonly o: { seed: number; version: 1 | 2; argvMode: boolean }) {
    this.rand = rng(o.seed);
  }

  infer(request: InferenceRequest): InferenceResponse {
    this.requests.push(request);
    const msgs = request.messages;
    let lastUser = -1;
    let turn = -1;
    msgs.forEach((m, i) => { if (isRealUser(m)) { lastUser = i; turn++; } });
    const inTurn = msgs.slice(lastUser + 1);
    const step = inTurn.filter((m) => m.role === "assistant").length;
    const rounds: ToolRound[][] = [];
    const toolNames = new Map<string, string>();
    const contexts: string[] = [];
    for (const m of msgs.slice(lastUser)) {
      if (m.role === "user") for (const b of m.content) if (isContext(b)) contexts.push((b as { text: string }).text);
      if (m.role === "assistant") for (const b of m.content) if (b.kind === "tool_use") toolNames.set(b.id, b.name);
    }
    for (const m of inTurn) {
      if (m.role !== "user") continue;
      const r = m.content.filter((b) => b.kind === "tool_result").map((b) => {
        const t = b as { toolUseId: string; content: string; isError?: boolean };
        return { name: toolNames.get(t.toolUseId) ?? "?", text: t.content, isError: !!t.isError, denied: /^Denied by /.test(t.content), deniedByUser: /^Denied by the user/.test(t.content) };
      });
      if (r.length) rounds.push(r);
    }
    const userMsg = msgs[lastUser];
    const userText = userMsg ? userMsg.content.filter((b) => b.kind === "text" && !isContext(b)).map((b) => (b as { text: string }).text).join("\n") : "";
    const toolList = request.tools.map((t) => t.name);
    const last = rounds[rounds.length - 1] ?? [];
    const sh = (command: string): PlannedCall => ({ name: "run_command", input: this.o.argvMode ? { argv: splitArgv(command) } : { command } });
    const view: ModelView = {
      request, step, turn: Math.max(turn, 0), userText, seed: this.o.seed, rand: this.rand,
      pick: (...opts) => opts[Math.floor(this.rand() * opts.length)], version: this.o.version, argvMode: this.o.argvMode,
      tools: toolList, hasTool: (n) => toolList.includes(n), sys: request.system,
      sysHas: (s) => (typeof s === "string" ? request.system.includes(s) : s.test(request.system)),
      contexts, contextHas: (s) => contexts.some((x) => (typeof s === "string" ? x.includes(s) : s.test(x))),
      last, lastText: last.map((r) => r.text).join("\n"), rounds,
      callCount: (n) => rounds.reduce((s, r) => s + r.filter((x) => x.name === n).length, 0), sh,
    };
    const s = this.plan(view);
    const content: ContentBlock[] = [];
    if (s.think) content.push({ kind: "thinking", thinking: s.think, signature: "reasoning_content" });
    if (s.text) content.push({ kind: "text", text: s.text });
    for (const pc of s.calls ?? []) content.push({ kind: "tool_use", id: `toolu_${pc.name}_${this.counter++}`, name: pc.name, input: pc.input });
    const hasCalls = (s.calls ?? []).length > 0;
    const billed = this.provider.bill(request, { content });
    return { content, stopReason: hasCalls ? "ToolUse" : "EndTurn", usage: billed.usage, latencyMs: billed.latencyMs };
  }
}
