import { describe, expect, it } from "vitest";
import {
  AuditLog,
  SKILLS,
  auditEntryFor,
  compactMessages,
  compaction,
  cyrb53,
  estimateTokens,
  loadSkillTool,
  skillsCatalogSection,
} from "../../src/v2/extensions";
import type { Message } from "@harness/api";
import { turnContext } from "../support/host";

const text = (t: string): Message => ({ role: "user", content: [{ kind: "text", text: t }] });
const result = (id: string, t: string): Message => ({ role: "user", content: [{ kind: "tool_result", toolUseId: id, content: t }] });
const big = (n: number) => "x".repeat(n);

describe("skills: progressive disclosure", () => {
  it("puts only names and descriptions in the catalog", () => {
    const s = skillsCatalogSection();
    expect(s.kind).toBe("static");
    if (s.kind !== "static") throw new Error("unreachable");
    for (const skill of SKILLS) {
      expect(s.text).toContain(skill.name);
      expect(s.text).toContain(skill.description);
      // the body is NOT in the catalog: that is the whole cost lesson
      expect(s.text).not.toContain(skill.body);
    }
  });

  it("the catalog is stable, so it does not restart the prompt cache", () => {
    const a = skillsCatalogSection(), b = skillsCatalogSection();
    expect(a.kind === "static" && b.kind === "static" && a.text === b.text).toBe(true);
  });

  it("load_skill returns the body, and only for a real name", () => {
    const tool = loadSkillTool();
    const ok = tool.execute({ name: SKILLS[0]!.name }, {} as never);
    // execute is sync here but typed Awaitable
    return Promise.resolve(ok).then((out) => {
      expect(out.kind).toBe("success");
      if (out.kind !== "success") throw new Error("unreachable");
      expect(out.content).toBe(SKILLS[0]!.body);
    });
  });

  it("a wrong name lists the available ones instead of guessing", async () => {
    const out = await loadSkillTool().execute({ name: "nope" }, {} as never);
    expect(out.kind).toBe("failure");
    if (out.kind !== "failure") throw new Error("unreachable");
    for (const s of SKILLS) expect(out.message).toContain(s.name);
  });

  it("rejects a non-string name", async () => {
    expect((await loadSkillTool().execute({} as never, {} as never)).kind).toBe("failure");
  });
});

describe("compaction", () => {
  it("estimates tokens at chars/4, like Tokens.kt", () => {
    expect(estimateTokens([text(big(400))])).toBe(100);
    expect(estimateTokens([text(big(400)), text(big(4))])).toBe(101);
  });

  it("stubs old tool results but keeps every message and every tool_use id", () => {
    const msgs = [text("start"), result("t1", big(500)), result("t2", big(500)), text("recent"), text("newest")];
    const { messages, dropped } = compactMessages(msgs, 2);
    expect(dropped).toBe(2);
    expect(messages).toHaveLength(msgs.length); // structure preserved: a valid wire format
    const ids = messages.flatMap((m) => m.content.filter((b) => b.kind === "tool_result").map((b) => (b as { toolUseId: string }).toolUseId));
    expect(ids).toEqual(["t1", "t2"]); // ids survive, so the API can still pair them
    expect(JSON.stringify(messages[1]!.content)).toContain("dropped by compaction");
    expect(JSON.stringify(messages[3]!.content)).toContain("recent"); // last N untouched
  });

  it("never compacts below the keep window", () => {
    const r = compactMessages([result("t1", big(500))], 5);
    expect(r.dropped).toBe(0);
    expect(r.messages).toHaveLength(1);
  });

  it("says so when it is above threshold but there is nothing to drop", () => {
    const r = compactMessages([text("a"), text("b"), text("c")], 1);
    expect(r.dropped).toBe(0);
    expect(r.note).toMatch(/no old tool results/);
  });

  it("the guardrail does nothing below the threshold", () => {
    const g = compaction({ thresholdTokens: 1000, keepLast: 2 });
    expect(g.beforeInference(turnContext({} as never)).kind).toBe("proceed");
  });

  it("above the threshold it returns proceed_with and a note, and does not fire twice for the same length", () => {
    const g = compaction({ thresholdTokens: 10, keepLast: 2 });
    const msgs = [result("t1", big(500)), result("t2", big(500)), text("recent"), text("newest")];
    const ctx = { ...turnContext({} as never), messages: msgs };
    const first = g.beforeInference(ctx);
    expect(first.kind).toBe("proceed_with");
    if (first.kind !== "proceed_with") throw new Error("unreachable");
    expect(first.messages.length).toBeGreaterThan(msgs.length); // the note is appended
    // same transcript length again: no second rewrite, or it would loop
    expect(g.beforeInference(ctx).kind).toBe("proceed");
  });
});

describe("audit log", () => {
  it("chains entries and verifies", () => {
    const log = new AuditLog();
    log.add("turn", "user: hi");
    log.add("tool_proposed", "read_file {}");
    log.add("approval", "read_file: Approve");
    expect(log.all).toHaveLength(3);
    expect(log.all[1]!.prev).toBe(log.all[0]!.hash);
    expect(log.verify().ok).toBe(true);
    expect(log.head).toBe(log.all[2]!.hash);
  });

  it("detects a modified entry", () => {
    const log = new AuditLog();
    log.add("turn", "a");
    log.add("turn", "b");
    // tamper: rewrite a summary, keep the hash
    const entries = (log as unknown as { entries: { summary: string }[] }).entries;
    entries[0]!.summary = "rewritten";
    const r = log.verify();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/modified/);
  });

  it("detects an entry removed from the middle", () => {
    const log = new AuditLog();
    log.add("turn", "a");
    log.add("turn", "b");
    log.add("turn", "c");
    // `all` returns a copy (good), so tamper with the internal array to simulate an attacker.
    const entries = (log as unknown as { entries: { n: number }[] }).entries;
    entries.splice(1, 1); // drop the middle one: #1, #3
    const r = log.verify();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/out of sequence|missing/);
  });

  it("detects an entry removed from the END (which the hash chain alone cannot)", () => {
    const log = new AuditLog();
    log.add("turn", "a");
    log.add("turn", "b");
    (log as unknown as { entries: unknown[] }).entries.pop();
    const r = log.verify();
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/removed from the end/);
  });

  it("an empty log verifies and returns the seed as head", () => {
    const log = new AuditLog("seed-1");
    expect(log.verify().ok).toBe(true);
    expect(log.head).toBe("seed-1");
  });

  it("returns a defensive copy, so a caller cannot rewrite history by accident", () => {
    const log = new AuditLog();
    log.add("turn", "a");
    const copy = log.all as unknown as unknown[];
    copy.push({ n: 2, kind: "x", summary: "forged", prev: "p", hash: "h" });
    expect(log.verify().ok).toBe(true);
    expect(log.all).toHaveLength(1);
  });

  it("hashes deterministically, and different content hashes differently", () => {
    expect(cyrb53("a")).toBe(cyrb53("a"));
    expect(cyrb53("a")).not.toBe(cyrb53("b"));
    expect(cyrb53("a", 7)).not.toBe(cyrb53("a"));
  });

  /**
   * The limit, pinned as a test rather than a sentence in a doc. If someone later "fixes" the audit log by
   * swapping in SHA-256, this test still passes, because the weakness is not the hash function: the hash
   * is public and keyless, so anyone who rewrites an entry recomputes every later one. The point of this
   * test is that `verify()` is an integrity check against ACCIDENT, not evidence against a forger.
   */
  it("a rewritten chain verifies clean: the log is not evidence against a forger", () => {
    const log = new AuditLog();
    log.add("approval", "run_command: git push -> denied");
    log.add("tool_call", "write_file OpenRA/mods/ra/rules/x.yaml");
    log.add("approval", "run_command: git commit -> approved");
    expect(log.verify().ok).toBe(true);

    // Delete the write, then recompute the remaining entries with the SAME public function.
    const kept = [log.all[0]!, log.all[2]!].map((e, i) => ({ ...e, n: i + 1 }));
    let prev = "genesis";
    for (const e of kept) {
      e.prev = prev;
      e.hash = cyrb53(`${e.n}|${e.kind}|${e.summary}|${e.prev}`);
      prev = e.hash;
    }
    const forged = Object.assign(Object.create(AuditLog.prototype), { entries: kept, issued: kept.length, seed: "genesis" }) as AuditLog;

    // This is the finding, not a bug to fix: nothing inside the log can tell the difference.
    expect(forged.verify().ok).toBe(true);
    expect(forged.all.map((e) => e.summary)).toEqual([
      "run_command: git push -> denied",
      "run_command: git commit -> approved",
    ]);
  });

  it("records what matters and skips the noisy defaults", () => {
    expect(auditEntryFor({ type: "tool_call_proposed", toolName: "read_file" })!.kind).toBe("tool_proposed");
    expect(auditEntryFor({ type: "turn_started", userMessage: "hi" })!.summary).toContain("hi");
    expect(auditEntryFor({ type: "guardrail_decision", guardrail: "x", hook: "beforeToolUse", decision: "Allow" })).toBe(null);
    expect(auditEntryFor({ type: "approval_requested", toolName: "git", decision: "Approve" })!.summary).toContain("Approve");
    const denied = auditEntryFor({ type: "guardrail_decision", guardrail: "policy", hook: "beforeToolUse", decision: "Deny(P-no-upstream)" });
    expect(denied!.summary).toContain("P-no-upstream");
    expect(auditEntryFor({ type: "inference_requested" })).toBe(null);
  });
});
