// v2 — progressive disclosure (skills), context compaction, and the audit log.
//
// Ahead of the workshop's v2 questions:
//   * a skill costs its DESCRIPTION on every call and its BODY only when loaded. The catalog is a
//     static section; the body arrives through a tool. That is the whole cost lesson, so the test
//     asserts the catalog is stable and the body is absent until `load_skill` runs.
//   * compaction is `ProceedWith` from a guardrail: the v1 API can already replace history, and the
//     loop warns that the prompt cache restarts. v2 adds the policy ("when, and how much"), not a
//     new extension point.

import { proceedWith, success, failure, type Message, type SystemPromptSection, type Tool, type TurnContext } from "@harness/api";
import type { Skill } from "./contract";

export const SKILLS: readonly Skill[] = [
  {
    name: "openra-rules",
    description: "How OpenRA rule inheritance works and where a value really comes from (read a parent before you edit).",
    body: [
      "# OpenRA rules: inheritance",
      "A unit's value is the FIRST match walking up its parent chain, so a value you cannot find in",
      "vehicles.yaml may come from defaults.yaml. Before editing a value, read the parent chain.",
      "Prefer the narrowest file: an override in mods/ra/rules/vehicles.yaml beats a change to a base.",
    ].join("\n"),
  },
  {
    name: "toolbox",
    description: "What the OpenRA toolbox can do (check, rules dump, build, package) and which one answers which question.",
    body: [
      "# The toolbox",
      "openra-check   validates mod YAML and prints errors with file:line.",
      "openra-rules   prints resolved rules, i.e. what the game will actually use after inheritance.",
      "openra-build   compiles the engine (minutes; run it in the background).",
      "Use openra-rules to confirm an edit took effect; use openra-check to find why it did not.",
    ].join("\n"),
  },
];

/** The catalog: names and descriptions only. Static, so it is stable across calls and cache-friendly. */
export function skillsCatalogSection(skills: readonly Skill[] = SKILLS): SystemPromptSection {
  const lines = ["# Skills", "Load one with load_skill when it applies. Each costs tokens only once loaded."];
  for (const s of skills) lines.push(`- ${s.name}: ${s.description}`);
  return { kind: "static", name: "skills_catalog", text: lines.join("\n") };
}

/** `load_skill`: returns the body, which is the only moment it is paid for. */
export function loadSkillTool(skills: readonly Skill[] = SKILLS): Tool {
  return {
    name: "load_skill",
    description:
      "Load the full text of a skill by name. The catalog lists the names and what each is for; the body " +
      "is long, so load only the skill you need. Returns an error listing the available names if you guess.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "exact skill name from the catalog" } },
      required: ["name"],
      additionalProperties: false,
    },
    execute(input) {
      const name = (input as { name?: unknown }).name;
      if (typeof name !== "string") return failure("'name' must be a string");
      const found = skills.find((s) => s.name === name);
      if (!found) return failure(`unknown skill '${name}'. Available: ${skills.map((s) => s.name).join(", ")}`);
      return success(found.body);
    },
  };
}

// ---- compaction ----------------------------------------------------------------------------------

export interface CompactionOptions {
  /** Start compacting once the transcript is estimated above this many tokens. */
  readonly thresholdTokens: number;
  /** How many of the most recent messages to keep verbatim. */
  readonly keepLast: number;
  /** Approximate tokens per character, matching Tokens.kt (chars / 4). */
  readonly charsPerToken?: number;
}

export const estimateTokens = (messages: readonly Message[], charsPerToken = 4): number =>
  Math.ceil(messages.reduce((n, m) => n + m.content.reduce((k, b) => k + (b.kind === "text" ? b.text.length : JSON.stringify(b).length), 0), 0) / charsPerToken);

const STUB = "[earlier tool result dropped by compaction; re-read the file if you still need it]";

/**
 * Replaces the text of OLD tool results with a stub, keeping every message and every tool_use id.
 *
 * Why stubs rather than dropping messages: the transcript must stay a valid wire format (a tool_use
 * without its tool_result is rejected), and ids are how the API pairs them. So this is a lossy
 * rewrite of content, not a truncation of structure — which is also why the loop's cache warning
 * fires.
 */
export function compactMessages(messages: readonly Message[], keepLast: number): { messages: Message[]; dropped: number; note: string } {
  if (messages.length <= keepLast) return { messages: [...messages], dropped: 0, note: "nothing to compact" };
  const cutoff = messages.length - keepLast;
  let dropped = 0;
  const out = messages.map((m, i) => {
    if (i >= cutoff) return m;
    const content = m.content.map((b) => {
      // thinking/redacted_thinking must pass through untouched: they are bound to this conversation.
      if (b.kind !== "tool_result") return b;
      if (b.content.length <= STUB.length) return b;
      dropped += 1;
      return { ...b, content: STUB };
    });
    return { ...m, content };
  });
  const note = dropped === 0 ? "above threshold but no old tool results to drop" : `compacted ${dropped} tool result(s), kept the last ${keepLast} message(s)`;
  return { messages: out, dropped, note };
}

/**
 * The guardrail. Returns `ProceedWith` (a v1 decision) so the loop reports the cache restart itself.
 * The `note` is carried in the message it inserts, because InferenceDecision.ProceedWith has no
 * field for it and v1 types are not widened here.
 */
export function compaction(o: CompactionOptions) {
  const charsPerToken = o.charsPerToken ?? 4;
  const seen = { last: -1 };
  return {
    name: "compaction",
    beforeInference(ctx: TurnContext) {
      const tokens = estimateTokens(ctx.messages, charsPerToken);
      if (tokens < o.thresholdTokens) return { kind: "proceed" as const };
      if (ctx.messages.length <= o.keepLast) return { kind: "proceed" as const };
      // once per distinct length: never rewrite twice without new material
      if (ctx.messages.length === seen.last) return { kind: "proceed" as const };
      const { messages, dropped, note } = compactMessages(ctx.messages, o.keepLast);
      if (dropped === 0) return { kind: "proceed" as const };
      seen.last = ctx.messages.length;
      return proceedWith([...messages, { role: "user" as const, content: [{ kind: "text" as const, text: `<compaction>${note}</compaction>` }] }]);
    },
  };
}

// ---- audit ---------------------------------------------------------------------------------------

/**
 * cyrb53: a fast, non-cryptographic 53-bit hash. Used to CHAIN entries so a modified or reordered
 * entry is detectable. It is deliberately not presented as tamper-PROOF: anyone who can rewrite the
 * whole chain can recompute it. That distinction is the honest one.
 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export interface AuditRecord {
  readonly n: number;
  readonly kind: string;
  readonly summary: string;
  readonly prev: string;
  readonly hash: string;
}

export class AuditLog {
  private readonly entries: AuditRecord[] = [];
  /** Highest sequence number ever issued. Detects entries removed from the END, which a chain cannot. */
  private issued = 0;

  constructor(private readonly seed = "genesis") {}

  add(kind: string, summary: string): AuditRecord {
    const prev = this.entries.length ? this.entries[this.entries.length - 1]!.hash : this.seed;
    const n = ++this.issued;
    const hash = cyrb53(`${n}|${kind}|${summary}|${prev}`);
    const entry = { n, kind, summary, prev, hash };
    this.entries.push(entry);
    return entry;
  }

  get all(): readonly AuditRecord[] {
    return [...this.entries];
  }

  /** Verifies the chain: numbering, and that each entry's hash binds its content and its predecessor. */
  verify(): { ok: boolean; at?: number; reason?: string } {
    let prev = this.seed;
    for (const [i, e] of this.entries.entries()) {
      // Contiguous 1..n: catches an entry removed from the middle (its successor still says #3).
      if (e.n !== i + 1) return { ok: false, at: e.n, reason: `entry ${e.n} is out of sequence: entry #${i + 1} is missing` };
      if (e.prev !== prev) return { ok: false, at: e.n, reason: `entry ${e.n} does not link to its predecessor` };
      const expected = cyrb53(`${e.n}|${e.kind}|${e.summary}|${e.prev}`);
      if (e.hash !== expected) return { ok: false, at: e.n, reason: `entry ${e.n} was modified after it was written` };
      prev = e.hash;
    }
    // Catches an entry removed from the END: the chain itself cannot, so the counter must.
    if (this.issued !== this.entries.length) {
      return { ok: false, at: this.entries.length + 1, reason: `${this.issued - this.entries.length} entry/entries were removed from the end of the log` };
    }
    return { ok: true };
  }

  get head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1]!.hash : this.seed;
  }
}

/** Turns an event into an audit line, or null for the noisy ones (every guardrail allow, etc.). */
export function auditEntryFor(e: Record<string, unknown>): { kind: string; summary: string } | null {
  const type = String(e.type);
  const s = (k: string) => (typeof e[k] === "string" ? (e[k] as string) : "");
  switch (type) {
    case "tool_call_proposed":
      return { kind: "tool_proposed", summary: `${s("toolName")} ${JSON.stringify(e.input ?? {}).slice(0, 200)}` };
    case "approval_requested":
      return { kind: "approval", summary: `${s("toolName")}: ${s("decision")}` };
    case "tool_call_completed":
      return { kind: "tool_completed", summary: String((e.outcome as { text?: string })?.text ?? "").slice(0, 160) };
    case "guardrail_decision": {
      const decision = s("decision");
      if (e.isDefault === true || /^Allow|Accept|Proceed|AllowEnd/.test(decision)) return null;
      return { kind: "guardrail", summary: `${s("guardrail")}.${s("hook")}: ${decision.slice(0, 160)}` };
    }
    case "dynamic_section_emitted":
      return { kind: "section", summary: `${s("section")}: ${s("text").slice(0, 120)}` };
    case "turn_started":
      return { kind: "turn", summary: `user: ${s("userMessage").slice(0, 160)}` };
    case "turn_ended":
      return { kind: "turn_end", summary: s("reason") };
    case "warning":
      return { kind: "warning", summary: s("message").slice(0, 160) };
    default:
      return null;
  }
}
