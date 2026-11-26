// v2 contract — additive to @harness/api. Nothing here changes a v1 type.
//
// v2 is built out of the SAME four extension points as v1 (§3–§6): a skill is a section plus a tool,
// a policy is a guardrail, compaction is `ProceedWith`, provenance is a section plus an `Ask`. The
// three things that genuinely need the loop are approval SCOPE (v1 remembers "approve always" per tool
// name, which over-grants), delegation (a nested loop inside a tool) and acceptEdits (which loosens a
// decision, and a guardrail may only tighten one). Those are `ApprovalScope` and `AgentRuntime` in the
// core API, requested through `AgentRuntimeSpec` below; everything else here is an extension.

import type { Message, Tool, ToolCall, Workspace } from "@harness/api";

export type Effect = "allow" | "deny" | "ask";

/** v2 — a named capability whose BODY is loaded only when the model asks for it (progressively disclosed). */
export interface Skill {
  readonly name: string;
  /** Always visible in the catalog, so it is paid for on every call: that is the point of the lesson. */
  readonly description: string;
  /** Loaded on demand by `load_skill`: paid for only when used. */
  readonly body: string;
}

/** v2 — a delegate: its own restricted tool list, its own context, its own iteration budget. */
export interface SubAgentSpec {
  readonly name: string;
  readonly description: string;
  readonly tools: string[];
  readonly maxIterations: number;
}

/**
 * What a delegated run returned. The child's transcript never crosses this boundary: only a summary
 * does, which is the isolation claim the cost lesson is about.
 */
export interface SubAgentOutcome {
  readonly kind: "completed" | "failed";
  readonly text?: string;
  readonly reason?: string;
  /** Inference calls the sub-agent made, in its own context. */
  readonly calls?: number;
  readonly iterations?: number;
}

/** What the JVM hands a tool that delegates (ctx.delegate). */
export type SubAgentDelegate = (spec: SubAgentSpec, prompt: string) => SubAgentOutcome;

/**
 * v2 — what a bundle asks of the loop. Declared once at assembly and returned from the extension's
 * `runtime` member; the JVM applies it. All of it defaults to v1, and none of it is a guardrail: a
 * guardrail may only tighten a decision, and every member here either loosens one (acceptEdits) or
 * needs a nested loop (delegation).
 */
export interface AgentRuntimeSpec {
  readonly mode?: PermissionMode;
  /** The agents this bundle declares. Each must also be reachable from a tool. */
  readonly subAgents?: readonly SubAgentSpec[];
  /**
   * `acceptEdits` coverage: the loop consults this INSTEAD of asking the human, but only for calls the
   * guardrails already decided to ask about, and only when `mode` is `acceptEdits`. Returning true for
   * an unknown tool would be a bug; the policy guardrail has already run and a DENY wins regardless.
   */
  readonly approveEdits?: (tool: string, input: Record<string, unknown>) => boolean;
}

/** v2 — policy as data. Absent matcher matches anything; deny > ask > allow; layers merge in order. */
export interface PolicyRule {
  readonly id: string;
  readonly effect: Effect;
  readonly rationale: string;
  readonly owner: string;
  readonly tool?: string[];
  /** Workspace-relative globs, for tools that take a path. */
  readonly path?: string[];
  /** Matches when the path does NOT match any of these. */
  readonly path_not?: string[];
  // Exemptions: `.env.example` is allowed even though `**/.env.*` is denied.
  readonly except_path?: string[];
  /** Structural match on run_command's argv — no regex over a shell string by design. */
  readonly argv?: {
    readonly program?: string[];
    readonly subcommand?: string[];
    readonly any_path_outside_workspace?: boolean;
  };
  readonly suggest?: string;
  readonly modes?: readonly PermissionMode[];
}

export type PermissionMode = "default" | "plan" | "acceptEdits";

export interface PolicyFile {
  readonly policy: string;
  readonly layer: string;
  readonly defaults?: Readonly<Record<string, Effect>>;
  readonly rules: PolicyRule[];
}

export interface PolicyVerdict {
  readonly effect: Effect;
  readonly ruleId: string | null;
  readonly layer: string | null;
  readonly owner: string | null;
  readonly rationale: string;
  readonly suggest?: string;
  /** Every rule that looked at this call, in evaluation order, and what it said. */
  readonly considered: ReadonlyArray<{ ruleId: string; effect: Effect }>;
}

/** v2 — what an approval prompt shows: what would change and how far the change reaches. */
export interface BlastRadius {
  readonly kind: "write" | "edit" | "delete" | "command" | "other";
  readonly target: string;
  readonly summary: string;
  /** Directory a scoped approval would cover, when one applies. */
  readonly scope?: string;
}

export interface AuditEntry {
  readonly n: number;
  readonly kind: string;
  readonly summary: string;
  readonly prev: string;
  readonly hash: string;
}

export interface ParseResult {
  readonly files: PolicyFile[];
  /** Malformed layers are dropped and reported: a typo loses your layer, it never loosens the base. */
  readonly errors: string[];
}

export type { Message, Tool, ToolCall, Workspace };
