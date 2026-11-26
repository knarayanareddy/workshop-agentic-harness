// End-to-end assembly: the REAL bundle, the REAL shipped policy JSON, the REAL guardrail objects.
// This is the test that would have caught "v2 exists but is not wired in".
import { describe, expect, it } from "vitest";
import { assembleV2, provenanceSection, upstreamAck, v2Enabled } from "../../src/v2/index";
import { evaluate, type PolicyState } from "../../src/v2/policy";
import { nodeWorkspace, toolCall, turnContext } from "../support/host";
import type { Guardrail, ToolCall, ToolDecision } from "@harness/api";

const ws = () => nodeWorkspace();
const a = (input: Record<string, unknown>, name = "run_command"): ToolCall => toolCall(name, input);
const kind = (d: ToolDecision | Promise<ToolDecision>) => (d as ToolDecision).kind;

/** Run only the policy guardrail from the assembled bundle, as the loop would. */
const policyOf = (b: ReturnType<typeof assembleV2>) => b.guardrails.find((g) => g.name === "policy") as Guardrail;

describe("v2 bundle assembles from the shipped files", () => {
  it("is OFF unless asked", () => {
    expect(v2Enabled(undefined)).toBe(false);
    expect(v2Enabled("")).toBe(false);
    expect(v2Enabled("0")).toBe(false);
    expect(v2Enabled("1")).toBe(true);
    expect(v2Enabled("true")).toBe(true);
  });

  it("parses both shipped policy layers without errors", () => {
    const b = assembleV2(ws());
    expect(b.policy.errors).toEqual([]);
    expect(b.policy.files.map((f) => f.layer)).toEqual(["00-workshop", "10-project"]);
  });

  it("adds the v2 pieces and keeps every v1 one", () => {
    const b = assembleV2(ws());
    const names = b.guardrails.map((g) => g.name);
    // v2 first (it is data), then the v1 code guardrails, unchanged
    expect(names[0]).toBe("policy");
    for (const v1 of ["protected-paths", "command", "build-file", "result-cap"]) expect(names, v1).toContain(v1);
    expect(b.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "list_files", "glob", "grep", "run_command", "file_stats", "load_skill"]));
    expect(b.systemPrompt.map((s) => s.name)).toEqual(expect.arrayContaining(["role", "working_agreements", "skills_catalog", "provenance"]));
    expect(b.listeners.length).toBeGreaterThanOrEqual(2);
  });

  it("swaps run_command for the argv tool, and says so in its description", () => {
    const b = assembleV2(ws());
    const run = b.tools.find((t) => t.name === "run_command")!;
    expect(run.description).toMatch(/argv/);
    expect(run.description).toMatch(/no shell/i);
    expect(run.inputSchema.required).toEqual(["argv"]);
  });

  it("compaction is absent until a threshold is given", () => {
    expect(assembleV2(ws()).guardrails.map((g) => g.name)).not.toContain("compaction");
    expect(assembleV2(ws(), { compactAboveTokens: 500 }).guardrails.map((g) => g.name)).toContain("compaction");
  });
});

describe("the assembled policy decides like the harness would", () => {
  const decide = (call: ToolCall, b = assembleV2(ws())) => {
    const p = policyOf(b);
    return kind(p.beforeToolUse!(call, turnContext(ws())) as ToolDecision);
  };

  it("allows the reading a workshop actually needs", () => {
    for (const p of ["OpenRA/mods/ra/rules/vehicles.yaml", "workshop.html", "README.md"]) {
      expect(decide(a({ path: p }, "read_file")), p).toBe("allow");
    }
  });

  it("denies secrets and build files, for write AND edit", () => {
    expect(decide(a({ path: ".env" }, "read_file"))).toBe("deny");
    expect(decide(a({ path: "OpenRA/.env" }, "read_file"))).toBe("deny");
    expect(decide(a({ path: "pom.xml" }, "write_file"))).toBe("deny");
    expect(decide(a({ path: "pom.xml" }, "edit_file"))).toBe("deny");
    expect(decide(a({ path: "OpenRA/OpenRA.Game/Foo.cs" }, "write_file"))).toBe("deny");
  });

  it("denies push even hidden behind git's global options", () => {
    expect(decide(a({ argv: ["git", "push"] }))).toBe("deny");
    expect(decide(a({ argv: ["git", "-C", "OpenRA", "push", "origin", "main"] }))).toBe("deny");
    expect(decide(a({ argv: ["git", "-c", "user.name=a", "push"] }))).toBe("deny");
  });

  it("asks before changing the checkout, allows read-only commands", () => {
    expect(decide(a({ argv: ["git", "commit", "-m", "x"] }))).toBe("ask");
    expect(decide(a({ argv: ["git", "status"] }))).toBe("allow");
    expect(decide(a({ argv: ["grep", "-n", "Speed", "OpenRA/mods/ra/rules/vehicles.yaml"] }))).toBe("allow");
  });

  it("denies shells, interpreters and downloads outright", () => {
    for (const prog of ["sh", "bash", "python3", "node", "curl", "wget"]) {
      expect(decide(a({ argv: [prog, "-c", "x"] })), prog).toBe("deny");
    }
  });

  it("denies a path argument that leaves the workspace", () => {
    expect(decide(a({ argv: ["cat", "/etc/passwd"] }))).toBe("deny");
    expect(decide(a({ argv: ["cat", "../../etc/passwd"] }))).toBe("deny");
  });

  it("the project layer can tighten the base layer (a shader edit is denied)", () => {
    expect(decide(a({ path: "OpenRA/glsl/combined.frag" }, "edit_file"))).toBe("deny");
  });

  it("v1 over-granted: a shell string with a glob used to read .env. In v2 there is no argv, so it denies", () => {
    expect(decide(a({ command: "cat .en*" }))).toBe("deny");
  });
});

describe("fail-closed under a broken layer", () => {
  it("a corrupt project layer is dropped, and the base layer still denies", () => {
    const b = assembleV2(ws(), {
      layers: { "00-workshop": JSON.stringify({ policy: "p", layer: "00", rules: [] }), "10-project": "{ broken" },
    });
    expect(b.policy.errors).toHaveLength(1);
    expect(b.policy.files).toHaveLength(1);
    // the only layer left has no rules and no defaults -> default-deny
    const verdict = evaluate(b.policy.files, a({ argv: ["ls"] }));
    expect(verdict.effect).toBe("deny");
  });
});

describe("provenance and the one-time acknowledgement", () => {
  it("states the pin and the 'files are data' rule", () => {
    expect(provenanceSection.kind).toBe("static");
    if (provenanceSection.kind !== "static") throw new Error("unreachable");
    expect(provenanceSection.text).toMatch(/1f594e320656/);
    expect(provenanceSection.text).toMatch(/data, not orders/i);
    expect(provenanceSection.text).toMatch(/local-only sandbox/);
  });

  it("asks exactly once, on the first touch of the checkout", () => {
    const g = upstreamAck();
    const ctx = turnContext(ws());
    expect(kind(g.beforeToolUse!(a({ path: "README.md" }, "read_file"), ctx))).toBe("allow");
    expect(kind(g.beforeToolUse!(a({ path: "OpenRA/mods/ra/rules/vehicles.yaml" }, "read_file"), ctx))).toBe("ask");
    expect(kind(g.beforeToolUse!(a({ path: "OpenRA/mods/ra/rules/vehicles.yaml" }, "read_file"), ctx))).toBe("allow");
  });
});

describe("the audit listener records real decisions", () => {
  it("builds a verifiable chain from what actually happened", async () => {
    const b = assembleV2(ws());
    const p = policyOf(b);
    const ctx = turnContext(ws());
    const listen = b.listeners[1]!;
    listen({ type: "turn_started", runId: "r", userMessage: "make the tank faster" } as never);
    await p.beforeToolUse!(a({ path: "OpenRA/mods/ra/rules/vehicles.yaml" }, "read_file"), ctx);
    listen({ type: "guardrail_decision", guardrail: "policy", hook: "beforeToolUse", decision: "Allow", isDefault: false } as never);
    await p.beforeToolUse!(a({ argv: ["git", "push"] }), ctx);
    listen({ type: "guardrail_decision", guardrail: "policy", hook: "beforeToolUse", decision: "Deny(P-no-upstream)", isDefault: false } as never);
    const log = b.audit;
    expect(log.all.length).toBeGreaterThanOrEqual(2); // turn + the deny (allows are not recorded)
    expect(log.verify().ok).toBe(true);
    expect(log.all.map((e) => e.kind)).toEqual(expect.arrayContaining(["turn", "guardrail"]));
    // the noisy "Allow" from the code guardrails is not recorded
    expect(log.all.filter((e) => /Allow\(\)/.test(e.summary))).toHaveLength(0);
  });
});

describe("cost: the v2 layer is measurably more expensive per call", () => {
  it("adds the skills catalog and provenance to the system prompt", () => {
    const sections = assembleV2(ws()).systemPrompt;
    const extra = sections.filter((s) => s.name === "skills_catalog" || s.name === "provenance");
    const chars = extra.reduce((n, s) => n + (s.kind === "static" ? s.text.length : 0), 0);
    expect(extra).toHaveLength(2);
    expect(chars).toBeGreaterThan(200); // a real per-call cost, not a rounding error
  });
});
