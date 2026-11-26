// v2 contract: ONLY additions. Nothing here exists in the repo's harness-api (v1). Every type below is labelled v2 in the UI and docs.
// v1 types are re-exported unchanged; v2 never edits a v1 type (the optional `note` on ProceedWith is the one widening, see below).
export * from "@harness/api";
import type { Message, Tool, ToolCall, Workspace } from "@harness/api";

/** v2 — a named capability whose BODY is loaded only when the model asks for it (progressive disclosure; cf. Claude Code Skills). */
export interface Skill {
  readonly name: string;
  /** always in the catalog the model sees: this is the per-call disclosure cost */
  readonly description: string;
  /** loaded on demand by the `load_skill` tool: this is the on-demand disclosure cost */
  readonly body: string;
  /** hints for a router (and for the simulated model); the real model decides from `description` */
  readonly triggers: string[];
}

/** v2 — a delegate: its own restricted bundle, its own iteration and token budget, its own (empty) context. */
export interface SubAgentSpec {
  readonly name: string;
  readonly description: string;
  readonly tools: string[];
  readonly maxIterations: number;
  readonly tokenBudget: number;
}

export type Effect = "allow" | "deny" | "ask";
/** v2 — policy as data. All fields optional except id/effect/rationale/owner; absent matcher = matches anything. */
export interface PolicyRule {
  id: string;
  effect: Effect;
  rationale: string;
  owner: string;
  tool?: string[];
  /** path globs matched against the workspace-relative path of path-taking tools */
  path?: string[];
  path_not?: string[];
  except_path?: string[];
  /** structural match on a run_command argv (no regex over a shell string) */
  argv?: { program?: string[]; subcommand?: string[]; any_arg?: string; paths_inside_workspace?: boolean; any_path_outside_workspace?: boolean };
  suggest?: string;
  /** what "approve always" is scoped to when this rule asks: the rule + this key (default: rule+argv-prefix or rule+directory) */
  scope?: "rule" | "argv-prefix" | "directory";
  /** permission modes in which the rule is active (default: all) */
  modes?: PermissionMode[];
}
export type PermissionMode = "default" | "plan" | "acceptEdits";
export interface PolicyFile {
  policy: string;
  layer: string;
  version: number;
  owner: string;
  mode?: PermissionMode;
  defaults?: Record<string, Effect>;
  rules: PolicyRule[];
}

/** v2 — the verdict a policy evaluation produced, with the evidence for the audit log. */
export interface PolicyVerdict { effect: Effect; ruleId: string | null; layer: string | null; owner: string | null; rationale: string; suggest?: string; considered: { ruleId: string; effect: Effect }[] }

/** v2 — what the approval UI shows besides the tool name: the diff and the blast radius. */
export interface BlastRadius {
  summary: string;
  risk: "low" | "medium" | "high";
  paths: { path: string; inWorkspace: boolean; change: "create" | "modify" | "read"; tracked: boolean }[];
  network: boolean;
  reversible: string;
  diff?: string;
}

/** v2 — one line of the append-only, hash-chained audit log. */
export interface AuditEntry { n: number; t: number; actor: string; kind: string; summary: string; data: unknown; prev: string; hash: string }

/** v2 — an OpenTelemetry-GenAI-shaped span (names follow the semantic conventions; see docs/PROTOTYPE.md §D). */
export interface Span {
  id: string; parent: string | null; name: string; kind: "agent" | "inference" | "tool" | "guardrail" | "approval";
  start: number; end: number; attrs: Record<string, string | number | boolean>;
}

/** v2 widening of ProceedWith: a human-readable note recorded in the trace (compaction before/after). */
export type ProceedWithNote = { kind: "proceed_with"; messages: Message[]; note?: string };

export type { Tool, ToolCall, Workspace };
