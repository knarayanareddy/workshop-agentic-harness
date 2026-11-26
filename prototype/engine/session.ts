// Runs one scenario through the real loop and records everything the UI inspects: events, exact requests (wire JSON), billed usage,
// printed listener lines, guardrail verdicts, approvals, audit log, spans, cost attribution. Deterministic: scenario + seed + options.
import "../sim/shellGlobal";
import type { AgentEvent, AgentEventListener, ContentBlock, Message } from "@harness/api";
import { Agent, estimate, estimateTool, type ApprovalDecision, type ApprovalHandler, type ApprovalRequest, type AgentResult, type InferenceRequest } from "./agent";
import { assemble, V2_ALL, type Bundle, type V2Options } from "./bundles";
import { MockModel, type Plan } from "./mock";
import { costOf, PRICE_PRESETS, SimProvider, sumUsage, toWireRequest, ZERO_USAGE, type Prices } from "./provider";
import { installFrozenDate, SimWorld, type VfsWorkspace } from "../sim/world";
import { AuditLog, auditEntryFor } from "../v2/extensions";
import { approvalScope, denialText, describeBlastRadius, POLICY_LAYERS_RAW } from "../v2/policy";
import type { AuditEntry, BlastRadius, PermissionMode, PolicyVerdict, Span } from "../contract/v2/harness-v2";
import type { Usage } from "./agent";

export interface Assertion { name: string; test: (t: Trace) => boolean }
export interface Scenario {
  id: string; title: string; kind: "part" | "extra" | "v2lab"; assignment: string; core?: boolean;
  prompts: string[]; needs: string[];
  world: { openra: boolean; toolboxReady?: boolean; dockerUp?: boolean; files?: Record<string, string>; modify?: (ws: VfsWorkspace) => void };
  plan: Plan; subPlans?: Record<string, Plan>;
  /** the scripted human. n = 0-based index of the approval prompt in this run. Default: deny ("answer n"). */
  approver?: (req: ApprovalRequest, n: number) => ApprovalDecision;
  expect: Assertion[]; expectV2?: Assertion[];
  hook: string; cleanup?: string; designed?: string; v2note: string;
  /** which pieces are simulated / replayed / illustrative (keys of SIM_BOUNDARY) */
  sim: string[]; fidelity: "simulated" | "replayed" | "illustrative";
  v2defaults?: Partial<V2Options>;
}

export interface RunConfig {
  version: 1 | 2; seed: number; artefact: boolean; prices: Prices; priceKey: string;
  approvals: "scripted" | "interactive"; v2: Omit<V2Options, "policyLayers" | "mode"> & { mode: PermissionMode; projectPolicy: string };
  /** fork: same prefix, different decision at approval #k */
  overrides: Record<number, "approve" | "deny" | "approve_always">;
  freePrompt?: string;
}
export const defaultConfig = (version: 1 | 2): RunConfig => ({
  version, seed: 7, artefact: true, prices: PRICE_PRESETS.workshop.prices, priceKey: "workshop", approvals: "scripted", overrides: {},
  v2: { ...V2_ALL, mode: "default", projectPolicy: POLICY_LAYERS_RAW["10-project"] },
});

export interface TraceEvent { i: number; e: AgentEvent & Record<string, unknown> }
export interface InferenceRow {
  i: number; agent: string; runId: string; iteration: number; turn: number; est: { system: number; messages: number; tools: number }; usage: Usage; cost: number;
  prefixTokens: number; stopReason: string; toolNames: string[]; requestIndex: number;
}
export interface ApprovalRecord { n: number; eventIndex: number; tool: string; reasons: string[]; guardrails: string[]; scope: string; decision: string; auto: boolean; blast?: BlastRadius; input: unknown }
export interface Attribution { name: string; kind: string; origin: string; tokens: number; calls: number; tokenCalls: number; usd: number; note: string }
export interface Trace {
  config: RunConfig; scenario: Scenario; effectiveEnabled: string[]; bundle: Bundle; system: string;
  events: TraceEvent[]; requests: InferenceRequest[]; inferences: InferenceRow[]; printed: { i: number; listener: string; line: string }[];
  approvals: ApprovalRecord[]; results: AgentResult[]; messages: Message[]; audit: AuditEntry[]; auditHead: string; spans: Span[];
  verdicts: Record<string, PolicyVerdict>; attribution: Attribution[];
  totals: { usage: Usage; cost: number; perTurn: { turn: number; usage: Usage; cost: number }[]; calls: number; estSystem: number };
  world: { executed: string[]; pushAttempts: string[]; commits: string[]; network: string[]; changed: string[]; diff: Record<string, { before: string; after: string }>; reads: string[]; writes: string[] };
  delegations: { agent: string; subTokens: number; subCalls: number; peakContextTokens: number; inlineTokens: number; summaryTokens: number; subCost: number; inlineExtraCost: number; delegatedExtraCost: number; avoidedTokens: number; laterParentCalls: number; breakEvenCalls: number }[];
  assertions: { name: string; ok: boolean }[]; durationMs: number; billingFactor: number; registration: string[];
}

async function runScenarioInner(sc: Scenario, cfg: RunConfig, askHuman?: (req: ApprovalRequest, detail: BlastRadius | undefined) => Promise<ApprovalDecision>): Promise<Trace> {
  const world = new SimWorld(sc.world);
  sc.world.modify?.(world.ws); // pre-session user edits (1.4, 4.3): applied AFTER the baseline commit, so git sees them as uncommitted
  const restoreDate = installFrozenDate(() => world.frozenNow());
  const printed: Trace["printed"] = [];
  const realLog = console.log;
  let current = "?";
  let eventCount = 0;
  console.log = (...a: unknown[]) => { printed.push({ i: eventCount, listener: current, line: a.map(String).join(" ") }); };
  try {
    const enabled = sc.needs.filter((p) => cfg.artefact || p !== sc.id);
    const provider = new SimProvider(cfg.seed);
    const argvMode = cfg.version === 2 && cfg.v2.argv;
    const model = new MockModel(sc.plan, provider, { seed: cfg.seed, version: cfg.version, argvMode });
    const events: TraceEvent[] = [];
    let agentRef: Agent | null = null;
    const forwardHolder: { fn: (e: AgentEvent) => void } = { fn: () => {} };
    const v2opts: V2Options | undefined = cfg.version === 2
      ? { ...cfg.v2, policyLayers: { ...POLICY_LAYERS_RAW, "10-project": cfg.v2.projectPolicy }, mode: cfg.v2.mode, ...(sc.v2defaults ?? {}) } : undefined;
    const bundle = assemble({ enabled, ws: world.ws, env: world, v2: v2opts, delegate: { plans: sc.subPlans ?? {}, seed: cfg.seed, forward: (e) => forwardHolder.fn(e), counter: { n: 0 } } });

    const audit = new AuditLog();
    const record: AgentEventListener = (e) => {
      const ev = e as AgentEvent & Record<string, unknown>;
      events.push({ i: events.length, e: ev });
      eventCount = events.length;
      if (cfg.version === 2) { const a = auditEntryFor(ev); if (a) audit.append(world.now(), a.actor, a.kind, a.summary, ev.type === "guardrail_decision" || ev.type === "approval_requested" ? { guardrail: ev.guardrail, hook: ev.hook, scope: ev.scope, reason: ev.reason } : null); }
    };
    forwardHolder.fn = (e) => record(e);
    const wrapped = bundle.listeners.map((l) => ((e: AgentEvent) => { if ((e as { agent?: string }).agent && (e as { agent?: string }).agent !== "main") return; current = l.name; try { l.fn(e); } finally { current = "?"; } }) as AgentEventListener);

    const approvals: ApprovalRecord[] = [];
    let approvalN = 0;
    const handler: ApprovalHandler = {
      async request(req) {
        const n = approvalN++;
        const detail = cfg.version === 2 ? describeBlastRadius(req.call, req.workspace) : undefined;
        let d: ApprovalDecision;
        const ov = cfg.overrides[n];
        const only = (names: string[]) => req.guardrails.every((g) => names.includes(g));
        const scripted = cfg.approvals === "scripted" || !askHuman;
        if (ov) d = ov === "deny" ? { kind: "deny", reason: "forked: denied instead" } : { kind: ov };
        else if (scripted && cfg.version === 2 && only(["upstream-ack"])) d = { kind: "approve_always" }; // v2-only gate: acknowledged once per session
        else if (scripted && cfg.version === 2 && only(["policy", "upstream-ack"]) && ["edit_file", "write_file"].includes(req.call.tool.name)) d = { kind: "approve" }; // v2-only edit prompt: the human reviewed the diff
        else if (cfg.approvals === "interactive" && askHuman) d = await askHuman(req, detail);
        else d = sc.approver ? sc.approver(req, n) : { kind: "deny", reason: "the user declined" };
        approvals.push({ n, eventIndex: events.length, tool: req.call.tool.name, reasons: req.reasons, guardrails: req.guardrails, scope: req.scope, decision: d.kind === "deny" ? `deny(${d.reason})` : d.kind, auto: false, blast: detail, input: req.call.input });
        return d;
      },
    };
    const agent = new Agent({
      model, systemPrompt: bundle.sections, tools: bundle.tools, guardrails: bundle.guardrails, approvalHandler: handler,
      listeners: [record, ...wrapped], workspace: world.ws, env: world, runIdSeed: "r",
      approvalScope: cfg.version === 2 && cfg.v2.scopedApprovals ? (call, reasons) => approvalScope(call, reasons) : undefined,
      denialText: cfg.version === 2 && cfg.v2.policy ? (g, reason) => denialText(g, reason) : undefined,
    });
    agentRef = agent;
    void agentRef;

    const prompts = cfg.freePrompt ? [cfg.freePrompt] : sc.prompts;
    const results: AgentResult[] = [];
    for (const p of prompts) results.push(await agent.run(p));

    // ---- derived data -------------------------------------------------------------------------------------------------
    const main = events.filter((x) => (x.e.agent ?? "main") === "main");
    void main;
    const inferences: InferenceRow[] = [];
    const reqIdx = new Map<string, number>();
    const pendingReq = new Map<string, TraceEvent>();
    let turn = -1;
    for (const x of events) {
      const e = x.e;
      const ag = (e.agent as string) ?? "main";
      if (e.type === "turn_started" && ag === "main") turn++;
      if (e.type === "inference_requested") pendingReq.set(ag, x);
      if (e.type === "inference_completed") {
        const rq = pendingReq.get(ag)!.e as Record<string, number>;
        const u = e.usage as Usage;
        inferences.push({
          i: x.i, agent: ag, runId: String(e.runId), iteration: Number(e.iteration), turn: ag === "main" ? turn : -1,
          est: { system: rq.systemTokens, messages: rq.messageTokens, tools: rq.toolTokens }, usage: u, cost: costOf(u, cfg.prices), prefixTokens: 0, stopReason: String(e.stopReason),
          toolNames: ((e.content as ContentBlock[]) ?? []).filter((b) => b.kind === "tool_use").map((b) => (b as { name: string }).name), requestIndex: -1,
        });
      }
    }
    // pair rows with model requests (main agent only; sub-agents have their own MockModel) in order
    let mi = 0;
    for (const r of inferences) if (r.agent === "main") { r.requestIndex = mi++; }
    const mainRows = inferences.filter((r) => r.agent === "main");
    const perTurn = [...new Set(mainRows.map((r) => r.turn))].map((t) => { const u = sumUsage(mainRows.filter((r) => r.turn === t).map((r) => r.usage)); return { turn: t, usage: u, cost: costOf(u, cfg.prices) }; });
    // sub-agent cost counts toward the session (separately visible)
    const subRows = inferences.filter((r) => r.agent !== "main");
    const usage = sumUsage(inferences.map((r) => r.usage));
    const totals = { usage, cost: costOf(usage, cfg.prices), perTurn, calls: mainRows.length, estSystem: estimate(agent.systemText) };
    void reqIdx; void subRows; void ZERO_USAGE;

    // delegation economics
    const delegations: Trace["delegations"] = [];
    for (const x of events) {
      const m = x.e.type === "log" && typeof x.e.message === "string" && (x.e.message as string).startsWith("delegate:") ? JSON.parse((x.e.message as string).slice(9)) : null;
      if (!m) continue;
      const later = mainRows.filter((r) => r.i > x.i).length;
      const p = cfg.prices;
      const subU = sumUsage(inferences.filter((r) => r.agent === m.agent).map((r) => r.usage));
      const subCost = costOf(subU, p);
      // analytic counterfactual: had the sub-agent's tool results been read inline, the parent would pay a cache write once and a cache read on every later call
      const inlineExtraCost = (m.inlineTokens * p.cacheWrite + later * m.inlineTokens * p.cacheRead) / 1e6;
      const delegatedExtraCost = subCost + (m.summaryTokens * p.cacheWrite + later * m.summaryTokens * p.cacheRead) / 1e6;
      const avoided = Math.max(0, m.inlineTokens - m.summaryTokens);
      const be = avoided * p.cacheRead === 0 ? Infinity : Math.max(0, Math.ceil((subCost * 1e6 - avoided * p.cacheWrite) / (avoided * p.cacheRead)));
      delegations.push({ ...m, subCost, inlineExtraCost, delegatedExtraCost, avoidedTokens: avoided, laterParentCalls: later, breakEvenCalls: be });
    }

    // cost attribution per extension point (main agent)
    const calls = mainRows.length;
    const price = cfg.prices;
    const perTokenCalls = (tokens: number, fromCall: number) => { const n = Math.max(0, calls - fromCall); return { tokenCalls: tokens * n, usd: n === 0 ? 0 : (tokens * price.cacheWrite + tokens * (n - 1) * price.cacheRead) / 1e6 }; };
    const attribution: Attribution[] = [];
    for (const it of bundle.items) {
      if (it.kind === "section" && it.sectionKind === "static") { const tokens = estimate((it.value as { text: string }).text); attribution.push({ name: it.name, kind: "static section", origin: it.origin, tokens, calls, ...perTokenCalls(tokens, 0), note: "in the system prompt: paid on every call (cache read after the first)" }); }
      if (it.kind === "tool") { const def = bundle.tools.find((t) => t.name === it.name)!; const tokens = estimateTool({ name: def.name, description: def.description, inputSchema: def.inputSchema as Record<string, unknown> }); attribution.push({ name: it.name, kind: "tool definition", origin: it.origin, tokens, calls, ...perTokenCalls(tokens, 0), note: "tool name + description + schema: paid on every call" }); }
    }
    for (const x of events) if (x.e.type === "dynamic_section_emitted") {
      const tokens = estimate(String(x.e.text)) + 12; const from = mainRows.filter((r) => r.i < x.i).length;
      attribution.push({ name: String(x.e.section), kind: "dynamic section (emitted)", origin: "-", tokens, calls: Math.max(0, calls - from), ...perTokenCalls(tokens, from), note: `emitted once before call #${from + 1}; stays in history afterwards` });
    }
    for (const x of events) if (x.e.type === "tool_call_completed" && x.e.toolName === "load_skill") {
      const out = x.e.outcome as { content?: string }; const tokens = estimate(out.content ?? ""); const from = mainRows.filter((r) => r.i < x.i).length;
      attribution.push({ name: "skill body", kind: "skill (loaded on demand)", origin: "v2", tokens, calls: Math.max(0, calls - from), ...perTokenCalls(tokens, from), note: `paid only because it was loaded before call #${from + 1}` });
    }

    // touched summary
    const ws = world.ws;
    const diff: Trace["world"]["diff"] = {};
    for (const f of ws.changedFiles()) diff[f] = { before: ws.baseline.get(f) ?? "", after: ws.files.get(f) ?? "" };
    const worldOut: Trace["world"] = {
      executed: world.executed, pushAttempts: world.pushAttempts, commits: world.commits, network: world.network, changed: ws.changedFiles(), diff,
      reads: [...new Set(ws.journal.filter((j) => j.op === "read").map((j) => j.path))], writes: [...new Set(ws.journal.filter((j) => j.op === "write").map((j) => j.path))],
    };
    const verdicts: Record<string, PolicyVerdict> = {};
    bundle.policy?.verdicts.forEach((v, k) => { verdicts[k] = v; });

    const trace: Trace = {
      config: cfg, scenario: sc, effectiveEnabled: enabled, bundle, system: agent.systemText, events, requests: model.requests, inferences, printed, approvals, results,
      messages: agent.messages, audit: audit.entries, auditHead: audit.head, spans: [], verdicts, attribution, totals, world: worldOut, delegations, assertions: [],
      durationMs: world.now(), billingFactor: provider.factor, registration: bundle.registration,
    };
    trace.spans = buildSpans(trace);
    const checks = cfg.version === 2 && sc.expectV2 ? sc.expectV2 : sc.expect;
    trace.assertions = !cfg.artefact && sc.kind === "part" ? [] : checks.map((a) => { let ok = false; try { ok = a.test(trace); } catch { ok = false; } return { name: a.name, ok }; });
    return trace;
  } finally {
    console.log = realLog;
    restoreDate();
  }
}

// ---- helpers for assertions / UI ----------------------------------------------------------------------------------
export const wireOf = (r: InferenceRequest) => toWireRequest(r);
export const evs = (t: Trace, type: string, pred: (e: Record<string, unknown>) => boolean = () => true) => t.events.map((x) => x.e as Record<string, unknown>).filter((e) => e.type === type && pred(e));
export const mainEvents = (t: Trace) => t.events.filter((x) => (x.e.agent ?? "main") === "main");
export const toolCalls = (t: Trace, name?: string) => evs(t, "tool_call_proposed", (e) => (e.agent ?? "main") === "main" && (!name || e.toolName === name));
export const guardDecisions = (t: Trace, guardrail: string, kind?: string) => evs(t, "guardrail_decision", (e) => e.guardrail === guardrail && (!kind || e.kind === kind));
export const finalText = (t: Trace) => (t.results.length ? (t.results[t.results.length - 1] as { text?: string }).text ?? "" : "");

// ---- spans (OpenTelemetry GenAI semantic-convention names; durations are virtual) ----------------------------------------
export function buildSpans(t: Trace): Span[] {
  const spans: Span[] = [];
  let n = 0;
  const id = () => `s${++n}`;
  const stack = new Map<string, string>(); // agent -> current agent span
  const toolSpan = new Map<string, string>();
  const open = new Map<string, Span>();
  const lastReq = new Map<string, TraceEvent>();
  for (const x of t.events) {
    const e = x.e as Record<string, unknown>;
    const ag = (e.agent as string) ?? "main";
    const T = Number(e.t ?? 0);
    switch (e.type) {
      case "turn_started": { const s: Span = { id: id(), parent: null, name: `invoke_agent ${ag}`, kind: "agent", start: T, end: T, attrs: { "gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": ag, "gen_ai.conversation.id": String(e.runId) } }; spans.push(s); stack.set(ag, s.id); open.set(ag, s); break; }
      case "turn_ended": { const s = open.get(ag); if (s) { s.end = T; s.attrs["harness.end_reason"] = String(e.reason); } break; }
      case "inference_requested": lastReq.set(ag, x); break;
      case "inference_completed": {
        const rq = lastReq.get(ag)!; const u = e.usage as Usage;
        const parent = ag === "main" ? stack.get("main") ?? null : (stack.get(ag) ?? null);
        spans.push({ id: id(), parent, name: `chat ${"workshop-model"}`, kind: "inference", start: Number(rq.e.t), end: T, attrs: { "gen_ai.operation.name": "chat", "gen_ai.agent.name": ag, "gen_ai.usage.input_tokens": u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, "gen_ai.usage.output_tokens": u.outputTokens, "gen_ai.usage.cache_read.input_tokens": u.cacheReadInputTokens, "gen_ai.usage.cache_creation.input_tokens": u.cacheCreationInputTokens, "gen_ai.response.finish_reasons": String(e.stopReason) } });
        break;
      }
      case "tool_call_proposed": {
        const parent = stack.get(ag) ?? null;
        const s: Span = { id: id(), parent, name: `execute_tool ${e.toolName}`, kind: "tool", start: T, end: T, attrs: { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": String(e.toolName), "gen_ai.tool.call.id": String(e.toolUseId), "gen_ai.agent.name": ag } };
        spans.push(s); toolSpan.set(String(e.toolUseId), s.id); open.set(`tool:${e.toolUseId}`, s);
        if (ag === "main") stack.set("tool", s.id);
        break;
      }
      case "guardrail_decision": {
        if (e.isDefault) break;
        const parent: string | null = (e.toolUseId ? toolSpan.get(String(e.toolUseId)) : undefined) ?? stack.get(ag) ?? null;
        spans.push({ id: id(), parent, name: `guardrail ${e.guardrail}.${e.hook}`, kind: "guardrail", start: T, end: T, attrs: { "harness.guardrail": String(e.guardrail), "harness.hook": String(e.hook), "harness.decision": String(e.kind), "harness.failed_closed": !!e.failedClosed } });
        const s = e.toolUseId ? open.get(`tool:${e.toolUseId}`) : undefined;
        if (s && e.kind === "deny") { s.attrs["error.type"] = "denied_by_guardrail"; }
        break;
      }
      case "approval_requested": spans.push({ id: id(), parent: stack.get(ag) ?? null, name: "await_human_approval", kind: "approval", start: T, end: T, attrs: { "harness.decision": String(e.decision), "harness.scope": String(e.scope), "harness.auto": !!e.auto } }); break;
      case "tool_call_completed": { const s = open.get(`tool:${e.toolUseId}`); if (s) { s.end = T; s.start = T - Number(e.durationMs); if ((e.outcome as { kind: string }).kind === "failure") s.attrs["error.type"] = "tool_failure"; } break; }
    }
  }
  return spans;
}

// ---- v1 vs v2 diff -----------------------------------------------------------------------------------------------------
export interface Divergence { index1: number; index2: number; sig1: string; sig2: string; why: string }
const sig = (x: TraceEvent): string | null => {
  const e = x.e as Record<string, unknown>;
  if ((e.agent ?? "main") !== "main") return null;
  switch (e.type) {
    case "dynamic_section_emitted": return `section:${e.section}`;
    case "inference_completed": return `infer:${(e.content as ContentBlock[]).filter((b) => b.kind === "tool_use").map((b) => (b as { name: string }).name).join("+") || "text"}`;
    case "tool_call_proposed": return `call:${e.toolName}`;
    case "guardrail_decision": return e.isDefault ? null : `guard:${e.guardrail}.${e.hook}:${e.kind}`;
    case "approval_requested": return `approval:${e.decision}`;
    case "tool_call_completed": return `done:${e.toolName}:${(e.outcome as { kind: string }).kind}`;
    default: return null;
  }
};
/** behavioural = ignore v2-only infrastructure signatures (extra dynamic sections, the once-per-session upstream-ack, auto approvals) */
export function firstDivergence(a: Trace, b: Trace, behavioural = false): Divergence | null {
  const keep = (s: string | null) => !!s && (!behavioural || !(s.startsWith("section:") || s.startsWith("guard:upstream-ack") || s.startsWith("approval:ApproveAlways") || s.startsWith("approval:Approve")));
  const sa = a.events.map((x) => ({ x, s: sig(x) })).filter((y) => keep(y.s));
  const sb = b.events.map((x) => ({ x, s: sig(x) })).filter((y) => keep(y.s));
  const norm = (s: string) => s.replace(/^call:run_command$/, "call:run_command");
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const p = sa[i], q = sb[i];
    if (p && q && norm(p.s!) === norm(q.s!)) continue;
    const s1 = p?.s ?? "(end of trace)", s2 = q?.s ?? "(end of trace)";
    return { index1: p?.x.i ?? -1, index2: q?.x.i ?? -1, sig1: s1, sig2: s2, why: explain(s1, s2, a, b) };
  }
  return null;
}
function explain(s1: string, s2: string, a: Trace, b: Trace): string {
  const note = b.scenario.v2note;
  if (s2.startsWith("guard:policy")) return `v2: a policy rule (data) fires where v1 had ${s1.startsWith("guard:") ? "the code guardrail " + s1.slice(6).split(".")[0] : "no verdict at all"}. ${note}`;
  if (s2.startsWith("section:") && !s1.startsWith("section:")) return `v2 adds dynamic section '${s2.slice(8)}' before the first inference (v1 has none). ${note}`;
  if (s2.startsWith("guard:upstream-ack")) return `v2: upstream-ack asks once (OpenRA's AGENTS.md forbids agentic use) before the first touch of OpenRA/ — v1 never asks. ${note}`;
  if (s2.startsWith("section:") && s1.startsWith("section:")) return `v2 emits section '${s2.slice(8)}' where v1 emitted '${s1.slice(8)}' (pinned clone / provenance). ${note}`;
  if (s2.startsWith("call:load_skill") || s2.startsWith("call:delegate")) return `v2 exposes ${s2.slice(5)}: the model reaches for it instead of reading files inline. ${note}`;
  return `${note} (v1: ${s1}; v2: ${s2}; ${a.inferences.length} vs ${b.inferences.length} inference rows)`;
}
export const summary = (t: Trace) => ({
  inferences: t.totals.calls, toolCalls: toolCalls(t).length, denied: evs(t, "guardrail_decision", (e) => e.kind === "deny" && e.hook === "beforeToolUse").length,
  approvals: t.approvals.length, executedPushes: t.world.pushAttempts.length, tokens: t.totals.usage.inputTokens + t.totals.usage.outputTokens + t.totals.usage.cacheReadInputTokens + t.totals.usage.cacheCreationInputTokens,
  cost: t.totals.cost, cacheRead: t.totals.usage.cacheReadInputTokens, systemTokens: t.totals.estSystem, passed: t.assertions.every((x) => x.ok),
});

/** The sim patches globals (console.log, Date) for the duration of a run, so runs are serialised. */
let chain: Promise<unknown> = Promise.resolve();
export const exclusive = <T,>(f: () => Promise<T>): Promise<T> => { const p = chain.then(f, f); chain = p.catch(() => undefined); return p; };
export const runScenario = (sc: Scenario, cfg: RunConfig, askHuman?: Parameters<typeof runScenarioInner>[2]): Promise<Trace> => exclusive(() => runScenarioInner(sc, cfg, askHuman));
