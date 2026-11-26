// The extension-point contract for TypeScript.
//
// Mirrors the Kotlin types in harness-api/src/main/kotlin. TypeScript extensions run INSIDE the
// Kotlin harness, in an embedded JavaScript engine (GraalJS):
//
//  - Methods may return a value or a Promise (`Awaitable<T>`); `async` is fine. But there is no
//    event loop: setTimeout, fetch and Node.js modules (fs, child_process, ...) do not exist.
//    Use `ctx.workspace` for files. Pure-JS npm packages can be bundled.
//  - Values cross into Kotlin as JSON, so return plain data — no class instances inside results.
//  - `console.log` prints to the harness console; `ctx.log` (tools) shows up in the trace.

// ---- §1 Core model ----------------------------------------------------------------------------

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: ContentBlock[];
}

export type ContentBlock =
  | { kind: "text"; text: string }
  // invalidInput: the raw arguments when the model sent no valid JSON object (input is then empty).
  | { kind: "tool_use"; id: string; name: string; input: Record<string, unknown>; invalidInput?: string }
  | { kind: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  // Opaque: bound to this exact conversation. Pass through unchanged; never construct or edit.
  | { kind: "thinking"; thinking: string; signature: string }
  | { kind: "redacted_thinking"; data: string };

export type StopReason = "EndTurn" | "ToolUse" | "MaxTokens" | "Refusal";

export type Awaitable<T> = T | Promise<T>;

/** The agent's working directory. Paths are relative to `root`; escaping it throws. */
export interface Workspace {
  readonly root: string;
  resolve(path: string): string;
  /** Whether `path` stays inside `root` (false where `resolve` throws); throws only for a string that is not a path here. */
  contains(path: string): boolean;
  /** An absolute path made relative to `root`, with forward slashes. */
  relativize(absolutePath: string): string;
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, content: string): void;
  /** Entries directly under `path` (default "."); directories end with "/". */
  list(path?: string): string[];
}

export interface TurnContext {
  readonly runId: string;
  /** 1-based index of the inference call within this run. */
  readonly iteration: number;
  readonly maxIterations: number;
  readonly iterationsRemaining: number;
  readonly messages: Message[];
  readonly workspace: Workspace;
}

/**
 * What `exec` returns: stdout and stderr combined, the last `shell.maxOutput` characters. A command
 * still running after `shell.timeoutSeconds` is killed (timedOut), and exitCode is then -1.
 */
export interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
  readonly timedOut: boolean;
}

/** Deliberately has no approval handler: gating is a guardrail concern. */
export interface ToolContext {
  readonly runId: string;
  readonly iteration: number;
  readonly toolUseId: string;
  readonly workspace: Workspace;
  /** Shows up in the trace as a log line. */
  log(...message: unknown[]): void;
  /**
   * Runs a shell command in the workspace root (`shell.name`) and waits for it. Tools and the
   * assembly get it; a guardrail doesn't: it gates commands, it never runs them.
   */
  exec(command: string): CommandResult;
  /**
   * Starts a shell command in the workspace root and returns at once, for work that takes minutes: a tool
   * call must not wait for it. Its output replaces what was in `log` (a workspace path); when it ends,
   * `exit code N` is added as the last line. No timeout. The JVM does the waiting: this engine has no threads.
   */
  spawn(command: string, log: string): void;
  /**
   * v2 — runs a delegated agent and waits for it. Present only when the harness provided a runner, so a
   * tool must handle its absence. The sub-agent gets its own context and budget: only `text` comes back.
   */
  readonly delegate?: SubAgentDelegate;
}

// ---- §3 SystemPromptSection -------------------------------------------------------------------

/**
 * v2 — a delegated agent and what one run of it returns. Declared by the extension, run by the loop: a
 * bundle cannot nest a loop, so it states the spec and the JVM does the rest.
 */
export interface SubAgentSpec {
  readonly name: string;
  readonly description: string;
  readonly tools: string[];
  readonly maxIterations: number;
}

export interface SubAgentOutcome {
  readonly kind: "completed" | "failed";
  readonly text?: string;
  readonly reason?: string;
  /** Inference calls the sub-agent made, in its own context. */
  readonly calls?: number;
  readonly iterations?: number;
}

export type SubAgentDelegate = (spec: SubAgentSpec, prompt: string) => SubAgentOutcome;

/**
 * v2 — what a bundle asks of the loop, returned from `Extension.runtime`. Everything is optional and
 * defaults to v1. None of it is a guardrail: a guardrail may only tighten a decision, and every member
 * here either loosens one (`approveEdits`) or needs a nested loop (`subAgents`).
 */
export interface AgentRuntimeSpec {
  readonly mode?: "default" | "plan" | "acceptEdits";
  readonly subAgents?: readonly SubAgentSpec[];
  /**
   * `acceptEdits` coverage. The loop consults this instead of asking the human, but only for calls the
   * guardrails already decided to ASK about, and only when `mode` is `acceptEdits`. A DENY always wins.
   */
  readonly approveEdits?: (tool: string, input: Record<string, unknown>) => boolean;
  /** Values checked between iterations: a token or call budget cannot be enforced inside one tool call. */
  readonly budget?: Readonly<Record<string, number>>;
}

/** `name`: any unique identifier you like; shows up in the trace and labels dynamic sections. */
/** Part of the frozen system prompt. Named so a helper can return one without the caller narrowing. */
export interface StaticSection {
  readonly kind: "static";
  readonly name: string;
  readonly text: string;
}

export type SystemPromptSection =
  | StaticSection
  /** Recomputed before every inference call; appended to the conversation only when it changes. */
  | { kind: "dynamic"; name: string; render: (ctx: TurnContext) => Awaitable<string | null> };

// ---- §4 Tool --------------------------------------------------------------------------------

export interface JSONSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [keyword: string]: unknown;
}

export interface Tool {
  /** snake_case, unique */
  readonly name: string;
  /** The model reads ONLY this — it is the API doc. */
  readonly description: string;
  readonly inputSchema: JSONSchema;
  /** A thrown error becomes a failure outcome; it never crashes the loop. */
  execute(input: Record<string, unknown>, ctx: ToolContext): Awaitable<ToolOutcome>;
}

export type ToolOutcome =
  | { kind: "success"; content: string }
  | { kind: "failure"; message: string };

// ---- §5 Guardrail ---------------------------------------------------------------------------

export interface ToolCall {
  readonly id: string;
  readonly tool: { readonly name: string; readonly description: string };
  readonly input: Record<string, unknown>;
}

/** All hooks are optional: implement only what you care about. */
export interface Guardrail {
  readonly name: string;
  beforeInference?(ctx: TurnContext): Awaitable<InferenceDecision>;
  beforeToolUse?(call: ToolCall, ctx: TurnContext): Awaitable<ToolDecision>;
  afterToolUse?(call: ToolCall, result: ToolOutcome, ctx: TurnContext): Awaitable<ResultDecision>;
  beforeEndTurn?(ctx: TurnContext): Awaitable<TurnDecision>;
}

export type InferenceDecision =
  | { kind: "proceed" }
  | { kind: "proceed_with"; messages: Message[] }
  | { kind: "abort"; reason: string };

export type ToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }   // PREVENT
  | { kind: "ask"; reason: string };   // GATE

export type ResultDecision =
  | { kind: "accept" }
  | { kind: "replace"; outcome: ToolOutcome }
  | { kind: "reject"; feedback: string };  // ENFORCE

export type TurnDecision =
  | { kind: "allow_end" }
  | { kind: "continue"; message: string };  // ENFORCE

// ---- §6 Observability -----------------------------------------------------------------------

/** `type` is the Kotlin event name in snake_case, e.g. "tool_call_completed". */
export interface AgentEvent {
  readonly type:
    | "turn_started" | "inference_requested" | "inference_completed" | "dynamic_section_emitted"
    | "tool_call_proposed" | "guardrail_decision" | "approval_requested"
    | "tool_call_completed" | "turn_ended" | "warning" | "log";
  readonly runId: string | null;
  readonly [field: string]: unknown;
}

export type AgentEventListener = (event: AgentEvent) => void;

// ---- The bundle -----------------------------------------------------------------------------

export interface Extension {
  systemPrompt?: SystemPromptSection[];
  tools?: Tool[];
  guardrails?: Guardrail[];
  listeners?: AgentEventListener[];
  /** v2 — what this bundle needs from the loop (delegation, acceptEdits, a budget). Defaults to v1. */
  runtime?: AgentRuntimeSpec;
}

/** What the app hands the extension at assembly: what the role section is made of. */
export interface AssemblyContext {
  readonly workspace: Workspace;
  /**
   * Runs a shell command in the workspace root, like `ToolContext.exec`, for sections that look
   * around before the first turn (`git status`). Not checked by guardrails: they check the model's
   * tool calls, not your own code.
   */
  exec(command: string): CommandResult;
}

/** Identity function that gives the default export its type: a function that builds the extension at assembly. */
export function defineExtension(extension: (ctx: AssemblyContext) => Extension): (ctx: AssemblyContext) => Extension {
  return extension;
}

/** The shell `ctx.exec` runs commands in ("sh", or "cmd.exe" on Windows) and its limits; the harness provides it. */
export const shell = (globalThis as unknown as { __harnessShell: { readonly name: string; readonly timeoutSeconds: number; readonly maxOutput: number } })
  .__harnessShell;

// ---- Helpers, so decisions read like the Kotlin and Java versions ------------------------------

export const success = (content: string): ToolOutcome => ({ kind: "success", content });
export const failure = (message: string): ToolOutcome => ({ kind: "failure", message });

export const allow = (): ToolDecision => ({ kind: "allow" });
export const deny = (reason: string): ToolDecision => ({ kind: "deny", reason });
export const ask = (reason: string): ToolDecision => ({ kind: "ask", reason });

export const accept = (): ResultDecision => ({ kind: "accept" });
export const replace = (outcome: ToolOutcome): ResultDecision => ({ kind: "replace", outcome });
export const reject = (feedback: string): ResultDecision => ({ kind: "reject", feedback });

export const allowEnd = (): TurnDecision => ({ kind: "allow_end" });
export const continueWith = (message: string): TurnDecision => ({ kind: "continue", message });

export const proceed = (): InferenceDecision => ({ kind: "proceed" });
export const proceedWith = (messages: Message[]): InferenceDecision => ({ kind: "proceed_with", messages });
export const abort = (reason: string): InferenceDecision => ({ kind: "abort", reason });

export const staticSection = (name: string, text: string): SystemPromptSection => ({ kind: "static", name, text });
export const dynamicSection = (name: string, render: (ctx: TurnContext) => Awaitable<string | null>): SystemPromptSection =>
  ({ kind: "dynamic", name, render });
