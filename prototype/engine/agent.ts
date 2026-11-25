// The agent loop — a line-by-line port of harness-core/.../Agent.kt (see prototype/data/repo/Agent.kt).
// The ordering rules in the comments are the normative ones from the brief §0. One engine serves v1 and v2:
// v2 only passes extra *options* (approvalScope, onApprovalDetail); the loop itself is never forked.
import type {
  AgentEvent, AgentEventListener, CommandResult, ContentBlock, Guardrail, InferenceDecision, Message, ResultDecision,
  StopReason, SystemPromptSection, Tool, ToolCall, ToolContext, ToolDecision, ToolOutcome, TurnContext, TurnDecision, Workspace,
} from "@harness/api";

export interface Usage { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }
export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface InferenceRequest { system: string; messages: Message[]; tools: ToolDefinition[] }
export interface InferenceResponse { content: ContentBlock[]; stopReason: StopReason; usage: Usage; latencyMs?: number }
export interface ModelClient { infer(request: InferenceRequest): Promise<InferenceResponse> | InferenceResponse }

export interface ApprovalRequest { call: ToolCall; reasons: string[]; guardrails: string[]; workspace: Workspace; scope: string }
export type ApprovalDecision = { kind: "approve" } | { kind: "approve_always" } | { kind: "deny"; reason: string };
export interface ApprovalHandler { request(req: ApprovalRequest): Promise<ApprovalDecision> | ApprovalDecision }

export interface AgentConfig { maxIterations: number; maxTurnContinuations: number }
export const DEFAULT_CONFIG: AgentConfig = { maxIterations: 25, maxTurnContinuations: 3 };

export type AgentResult =
  | { kind: "completed"; text: string }
  | { kind: "aborted"; reason: string }
  | { kind: "limit_reached"; limit: string };

/** What the sim has to provide: a shell, and a virtual clock so traces are reproducible. */
export interface SimEnv {
  exec(command: string): CommandResult;
  spawn(command: string, log: string): void;
  /** virtual milliseconds the last tool call took (the sim decides; wall-clock time is never used) */
  takeDuration(): number;
  advance(ms: number): void;
  now(): number;
}

export interface AgentOptions {
  id?: string;
  model: ModelClient;
  systemPrompt: SystemPromptSection[];
  tools: Tool[];
  guardrails: Guardrail[];
  approvalHandler: ApprovalHandler;
  listeners: AgentEventListener[];
  workspace: Workspace;
  env: SimEnv;
  config?: Partial<AgentConfig>;
  /** v1: the tool name (the over-grant the brief calls out). v2 passes a rule-scoped key. */
  approvalScope?: (call: ToolCall, reasons: string[], guardrails: string[]) => string;
  /** v2: extra view of what the model is told when a tool call is denied */
  denialText?: (guardrail: string, reason: string, call: ToolCall) => string;
  initialHistory?: Message[];
  runIdSeed?: string;
  /** v2 only: lets sub-agents forward events to the parent with provenance */
  eventTap?: (event: AgentEvent) => void;
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
export const estimate = (text: string): number => Math.floor((text.length + 3) / 4);
export const estimateBlock = (b: ContentBlock): number => {
  switch (b.kind) {
    case "text": return estimate(b.text);
    case "tool_use": return estimate(b.name) + estimate(JSON.stringify(b.input));
    case "tool_result": return estimate(b.content);
    case "thinking": return estimate(b.thinking);
    case "redacted_thinking": return Math.floor(estimate(b.data) / 4);
  }
};
export const estimateMessage = (m: Message): number => m.content.reduce((s, b) => s + estimateBlock(b), 0);
export const estimateTool = (t: ToolDefinition): number => estimate(t.name) + estimate(t.description) + estimate(JSON.stringify(t.inputSchema));
export const messageText = (m: Message | undefined): string => (m ? m.content.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text).join("") : "");
const outcomeText = (o: ToolOutcome): string => (o.kind === "success" ? o.content : o.message);
const describeErr = (e: unknown): string => (e instanceof Error ? e.message || e.name : String(e)) || "Error";

/** Kotlin `toString()` of the sealed decision types — what `GuardrailDecision.decision` carries (Bell checks startsWith("Ask")). */
export function decisionString(d: { kind: string; [k: string]: unknown }): string {
  switch (d.kind) {
    case "proceed": return "Proceed";
    case "proceed_with": return `ProceedWith(messages=${(d.messages as Message[]).length}${d.note ? `, note=${d.note}` : ""})`;
    case "abort": return `Abort(reason=${d.reason})`;
    case "allow": return "Allow";
    case "deny": return `Deny(reason=${d.reason})`;
    case "ask": return `Ask(reason=${d.reason})`;
    case "accept": return "Accept";
    case "replace": return `Replace(outcome=${(d.outcome as ToolOutcome).kind === "success" ? "Success" : "Failure"}(${(d.outcome as ToolOutcome).kind === "success" ? "content" : "message"}=${outcomeText(d.outcome as ToolOutcome).slice(0, 60).replace(/\n/g, "\\n")}…))`;
    case "reject": return `Reject(feedback=${d.feedback})`;
    case "allow_end": return "AllowEnd";
    case "continue": return `Continue(message=${d.message})`;
    default: return d.kind;
  }
}
const DEFAULT_KINDS = new Set(["proceed", "allow", "accept", "allow_end"]);

export class Agent {
  readonly id: string;
  private history: Message[];
  private readonly system: string;
  private readonly dynamicSections: Extract<SystemPromptSection, { kind: "dynamic" }>[];
  private readonly lastDynamicValue = new Map<string, string>();
  private readonly approvedAlways = new Set<string>();
  private readonly cfg: AgentConfig;
  private seq = 0;
  private runCounter = 0;

  constructor(private readonly o: AgentOptions) {
    this.id = o.id ?? "main";
    this.cfg = { ...DEFAULT_CONFIG, ...o.config };
    this.history = [...(o.initialHistory ?? [])];
    // Static sections form the system prompt, frozen for the whole session; dynamic ones go into the conversation (§3).
    this.system = o.systemPrompt.filter((s) => s.kind === "static").map((s) => (s as { text: string }).text).join("\n\n");
    this.dynamicSections = o.systemPrompt.filter((s): s is Extract<SystemPromptSection, { kind: "dynamic" }> => s.kind === "dynamic");
    const names = o.tools.map((t) => t.name);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) throw new Error(`duplicate tool names: ${dup}`);
    for (const n of names) if (!SNAKE_CASE.test(n)) throw new Error(`'${n}' is not snake_case — tool names must match ${SNAKE_CASE.source}`);
    const sn = o.systemPrompt.map((s) => s.name);
    const sdup = sn.filter((n, i) => sn.indexOf(n) !== i);
    if (sdup.length) throw new Error(`duplicate system prompt section names: ${sdup}`);
  }

  get messages(): Message[] { return this.history.slice(); }
  get systemText(): string { return this.system; }
  get approvedScopes(): string[] { return [...this.approvedAlways]; }

  private emit(event: Record<string, unknown> & { type: AgentEvent["type"]; runId: string | null }): void {
    const full = { ...event, seq: ++this.seq, t: this.o.env.now(), agent: this.id } as unknown as AgentEvent;
    this.o.eventTap?.(full);
    for (const l of this.o.listeners) l(full);
  }

  async run(userMessage: string): Promise<AgentResult> {
    const runId = `${this.o.runIdSeed ?? "r"}${(++this.runCounter).toString(16).padStart(3, "0")}`;
    this.emit({ type: "turn_started", runId, userMessage });
    this.appendUser([...this.answerDanglingToolUses(), { kind: "text", text: userMessage }]);

    let continuations = 0;
    for (let iteration = 1; iteration <= this.cfg.maxIterations; iteration++) {
      const mkCtx = (): TurnContext => ({
        runId, iteration, maxIterations: this.cfg.maxIterations, iterationsRemaining: this.cfg.maxIterations - iteration,
        messages: this.history.slice(), workspace: this.o.workspace,
      });
      let ctx = mkCtx();

      // [ExtensionPoint] Guardrail.beforeInference — each sees the previous one's rewrite.
      const rewrittenBy: string[] = [];
      for (const g of this.o.guardrails) {
        const decision = await this.guarded<InferenceDecision>(runId, g, "beforeInference",
          (e) => ({ kind: "abort", reason: `guardrail '${g.name}' failed: ${describeErr(e)}` }), async () => (g.beforeInference ? g.beforeInference(ctx) : { kind: "proceed" }));
        if (decision.kind === "proceed_with") {
          this.history = decision.messages.slice();
          ctx = mkCtx();
          rewrittenBy.push(g.name);
        } else if (decision.kind === "abort") {
          return this.end(runId, `aborted: ${decision.reason}`, { kind: "aborted", reason: decision.reason });
        }
      }
      if (rewrittenBy.length) {
        this.emit({ type: "warning", runId, message: `history rewritten by ${rewrittenBy.join(", ")}: the prompt cache restarts, and thinking blocks bound to the old history will be dropped by the API` });
      }

      // [ExtensionPoint] SystemPromptSection.Dynamic — appended to the outgoing user message.
      await this.renderDynamicSections(ctx);

      const request: InferenceRequest = {
        system: this.system,
        messages: this.history.slice(),
        tools: this.o.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> })),
      };
      this.emit({
        type: "inference_requested", runId, iteration,
        systemTokens: estimate(request.system),
        messageTokens: request.messages.reduce((s, m) => s + estimateMessage(m), 0),
        toolTokens: request.tools.reduce((s, t) => s + estimateTool(t), 0),
        toolNames: request.tools.map((t) => t.name),
      });

      const response = await this.o.model.infer(request);
      this.o.env.advance(response.latencyMs ?? 0);
      this.emit({ type: "inference_completed", runId, iteration, stopReason: response.stopReason, usage: response.usage, content: response.content });
      this.history.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use");
      if (response.stopReason === "ToolUse" && toolUses.length > 0) {
        const toolCtx: TurnContext = { ...mkCtx(), messages: this.history.slice() };
        // Invariant: every ToolResult goes into ONE user message, in ToolUse order.
        const results: ContentBlock[] = [];
        for (const use of toolUses) results.push(await this.executeToolUse(use, toolCtx));
        this.history.push({ role: "user", content: results });
      } else if (response.stopReason === "ToolUse" || response.stopReason === "EndTurn") {
        const endCtx: TurnContext = { ...mkCtx(), messages: this.history.slice() };
        const continueWith: string[] = [];
        for (const g of this.o.guardrails) {
          const d = await this.guarded<TurnDecision>(runId, g, "beforeEndTurn", () => ({ kind: "allow_end" }), async () => (g.beforeEndTurn ? g.beforeEndTurn(endCtx) : { kind: "allow_end" }));
          if (d.kind === "continue") continueWith.push(d.message);
        }
        if (continueWith.length === 0) return this.end(runId, "end_turn", { kind: "completed", text: messageText(this.history[this.history.length - 1]) });
        if (continuations >= this.cfg.maxTurnContinuations) {
          this.emit({ type: "warning", runId, message: `maxTurnContinuations (${this.cfg.maxTurnContinuations}) exhausted; ending the turn although guardrails asked to continue` });
          return this.end(runId, "end_turn (continuations exhausted)", { kind: "completed", text: messageText(this.history[this.history.length - 1]) });
        }
        continuations++;
        this.history.push({ role: "user", content: continueWith.map((text) => ({ kind: "text" as const, text })) });
      } else if (response.stopReason === "MaxTokens") {
        return this.end(runId, "max_tokens", { kind: "limit_reached", limit: "max_tokens" });
      } else {
        return this.end(runId, "refusal", { kind: "aborted", reason: "the model declined to continue (stop_reason: refusal)" });
      }
    }
    return this.end(runId, "max_iterations", { kind: "limit_reached", limit: `maxIterations (${this.cfg.maxIterations})` });
  }

  private async renderDynamicSections(ctx: TurnContext): Promise<void> {
    const blocks: ContentBlock[] = [];
    for (const section of this.dynamicSections) {
      let text: string | null;
      try {
        text = await section.render(ctx);
      } catch (e) {
        this.emit({ type: "warning", runId: ctx.runId, message: `dynamic section '${section.name}' failed and was skipped: ${describeErr(e)}` });
        continue;
      }
      if (text === null || text === undefined) { this.lastDynamicValue.delete(section.name); continue; }
      if (this.lastDynamicValue.get(section.name) === text) continue;
      this.lastDynamicValue.set(section.name, text);
      this.emit({ type: "dynamic_section_emitted", runId: ctx.runId, section: section.name, text });
      blocks.push({ kind: "text", text: `<context section="${section.name}">\n${text}\n</context>` });
    }
    if (blocks.length) this.appendUser(blocks);
  }

  private async executeToolUse(use: Extract<ContentBlock, { kind: "tool_use" }>, ctx: TurnContext): Promise<ContentBlock> {
    const runId = ctx.runId;
    this.emit({ type: "tool_call_proposed", runId, toolUseId: use.id, toolName: use.name, input: use.input });
    const tool = this.o.tools.find((t) => t.name === use.name);
    if (!tool) return { kind: "tool_result", toolUseId: use.id, content: `Unknown tool '${use.name}'. Available tools: ${this.o.tools.map((t) => t.name).join(", ")}`, isError: true };
    if (use.invalidInput !== undefined) {
      return { kind: "tool_result", toolUseId: use.id, content: `Not executed: the arguments are not a valid JSON object: ${use.invalidInput}\nCall '${use.name}' again with arguments matching its input schema.`, isError: true };
    }
    const call: ToolCall = { id: use.id, tool: { name: tool.name, description: tool.description }, input: use.input };

    // [ExtensionPoint] Guardrail.beforeToolUse — first Deny wins; Asks are collected (§5.1).
    const asks: string[] = [];
    const askers: string[] = [];
    for (const g of this.o.guardrails) {
      const d = await this.guarded<ToolDecision>(runId, g, "beforeToolUse", (e) => ({ kind: "deny", reason: `guardrail '${g.name}' failed: ${describeErr(e)}` }),
        async () => (g.beforeToolUse ? g.beforeToolUse(call, ctx) : { kind: "allow" }), call);
      if (d.kind === "ask") { asks.push(d.reason); askers.push(g.name); }
      else if (d.kind === "deny") {
        const text = this.o.denialText ? this.o.denialText(g.name, d.reason, call) : `Denied by guardrail '${g.name}': ${d.reason}`;
        return { kind: "tool_result", toolUseId: use.id, content: text, isError: true };
      }
    }
    if (asks.length) {
      const reason = await this.denialByHuman(call, asks, askers, runId);
      if (reason !== null) return { kind: "tool_result", toolUseId: use.id, content: `Denied by the user: ${reason}`, isError: true };
    }

    this.o.env.takeDuration(); // reset the virtual stopwatch
    const logs: string[] = [];
    const toolCtx: ToolContext = {
      runId, iteration: ctx.iteration, toolUseId: use.id, workspace: this.o.workspace,
      log: (...m: unknown[]) => { const message = m.map(String).join(" "); logs.push(message); this.emit({ type: "log", runId, source: tool.name, message }); },
      exec: (command: string) => this.o.env.exec(command),
      spawn: (command: string, log: string) => this.o.env.spawn(command, log),
    };
    let outcome: ToolOutcome;
    try {
      outcome = await tool.execute(call.input, toolCtx);
    } catch (e) {
      outcome = { kind: "failure", message: describeErr(e) };
    }
    const durationMs = Math.max(1, this.o.env.takeDuration());
    this.o.env.advance(durationMs);

    // [ExtensionPoint] Guardrail.afterToolUse — each sees the previous rewrite; first Reject wins.
    for (const g of this.o.guardrails) {
      const current = outcome;
      const d = await this.guarded<ResultDecision>(runId, g, "afterToolUse", (e) => ({ kind: "reject", feedback: `guardrail '${g.name}' failed: ${describeErr(e)}` }),
        async () => (g.afterToolUse ? g.afterToolUse(call, current, ctx) : { kind: "accept" }), call);
      if (d.kind === "replace") outcome = d.outcome;
      else if (d.kind === "reject") {
        outcome = { kind: "failure", message: `${outcomeText(current)}\n\nRejected by guardrail '${g.name}': ${d.feedback}` };
        break;
      }
    }
    this.emit({ type: "tool_call_completed", runId, toolName: tool.name, toolUseId: use.id, outcome, durationMs });
    return { kind: "tool_result", toolUseId: use.id, content: outcomeText(outcome), isError: outcome.kind === "failure" };
  }

  /** Consults the ApprovalHandler once with all reasons; returns the denial reason, or null if approved. */
  private async denialByHuman(call: ToolCall, reasons: string[], guardrails: string[], runId: string): Promise<string | null> {
    const scope = this.o.approvalScope ? this.o.approvalScope(call, reasons, guardrails) : call.tool.name;
    if (this.approvedAlways.has(scope)) {
      this.emit({ type: "approval_requested", runId, toolName: call.tool.name, reasons, decision: "approved (always, for this session)", scope, auto: true });
      return null;
    }
    let decision: ApprovalDecision;
    try {
      decision = await this.o.approvalHandler.request({ call, reasons, guardrails, workspace: this.o.workspace, scope });
    } catch (e) {
      decision = { kind: "deny", reason: `approval handler failed: ${describeErr(e)}` };
    }
    const label = decision.kind === "approve" ? "Approve" : decision.kind === "approve_always" ? "ApproveAlways" : `Deny(reason=${decision.reason})`;
    this.emit({ type: "approval_requested", runId, toolName: call.tool.name, reasons, decision: label, scope, auto: false });
    if (decision.kind === "approve") return null;
    if (decision.kind === "approve_always") { this.approvedAlways.add(scope); return null; }
    return decision.reason;
  }

  /** Runs one guardrail hook; a hook that throws gets onError's decision (fail closed). */
  private async guarded<D extends { kind: string }>(runId: string, g: Guardrail, hook: string, onError: (e: unknown) => D, body: () => Promise<D>, call?: ToolCall): Promise<D> {
    let decision: D;
    let failed = false;
    try { decision = await body(); } catch (e) { failed = true; decision = onError(e); }
    this.emit({
      type: "guardrail_decision", runId, guardrail: g.name, hook, decision: decisionString(decision), isDefault: DEFAULT_KINDS.has(decision.kind),
      kind: decision.kind, failedClosed: failed, toolUseId: call?.id,
      reason: (decision as unknown as { note?: string }).note ?? (decision as unknown as { reason?: string; feedback?: string; message?: string }).reason ?? (decision as unknown as { feedback?: string }).feedback ?? (decision as unknown as { message?: string }).message,
    });
    return decision;
  }

  /** A run that stopped on max_tokens can leave ToolUse blocks without results; answer them so the transcript stays valid. */
  private answerDanglingToolUses(): ContentBlock[] {
    const last = this.history[this.history.length - 1];
    if (!last || last.role !== "assistant") return [];
    return last.content.filter((b) => b.kind === "tool_use").map((b) => ({
      kind: "tool_result" as const, toolUseId: (b as { id: string }).id, content: "Not executed: the previous response was cut off before this call could run.", isError: true,
    }));
  }

  /** Appends to a trailing user message (one that was never answered) or starts a new one. */
  private appendUser(blocks: ContentBlock[]): void {
    const last = this.history[this.history.length - 1];
    if (last?.role === "user") this.history[this.history.length - 1] = { role: "user", content: [...last.content, ...blocks] };
    else this.history.push({ role: "user", content: blocks });
  }

  private end(runId: string, reason: string, result: AgentResult): AgentResult {
    this.emit({ type: "turn_ended", runId, reason });
    return result;
  }
}
