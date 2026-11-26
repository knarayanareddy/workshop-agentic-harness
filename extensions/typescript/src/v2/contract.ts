// v2 contract — additive to @harness/api. Nothing here changes a v1 type.
//
// v2 is built out of the SAME four extension points as v1 (§3–§6): a skill is a section plus a tool,
// a policy is a guardrail, compaction is `ProceedWith`, provenance is a section plus an `Ask`. The two
// things that genuinely need the loop are approval SCOPE (v1 remembers "approve always" per tool name,
// which over-grants) and delegation (a nested loop). Those are `ApprovalScope` in the core API and
// `SubAgentRunner` below; everything else in this file is expressible as an extension.

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
 * What a sub-agent gets to call: tools by name, from its own restricted set. The runner never sees the
 * parent's transcript — it is handed a prompt and returns an answer, which is the whole isolation claim.
 */
export interface SubAgentRunner {
  run(spec: SubAgentSpec, prompt: string, available: Tool[]): Promise<SubAgentResult>;
}

export interface SubAgentResult {
  readonly text: string;
  /** For the cost comparison the workshop teaches: calls the sub-agent made, in its own context. */
  readonly calls: number;
  readonly iterations: number;
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
