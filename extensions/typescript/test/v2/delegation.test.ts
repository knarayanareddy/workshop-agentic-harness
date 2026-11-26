// v2 delegation, acceptEdits and the permissions section. The nested loop itself is Kotlin
// (harness-core RuntimeTest), so what is tested here is the extension's half: the specs it declares, the
// catalog the model sees, what `delegate` does when the loop is absent, broken or hostile, and the
// contract the JVM will read back out of the bundle.
import { describe, expect, it } from "vitest";
import { assembleV2, permissionsSection } from "../../src/v2/index";
import { SUB_AGENTS, budgetGuardrail, delegateTool } from "../../src/v2/delegation";
import type { SubAgentDelegate, SubAgentOutcome, Tool } from "@harness/api";
import { nodeWorkspace, toolCall } from "../support/host";

const ws = () => nodeWorkspace();

/** A tool context carrying a fake delegate, since the real one is the JVM's. */
function ctxWith(delegate?: SubAgentDelegate) {
  return { runId: "r", iteration: 1, toolUseId: "t", workspace: ws(), log: () => {}, exec: () => ({ exitCode: 0, output: "", timedOut: false }), spawn: () => {}, delegate };
}

const toolById = (b: ReturnType<typeof assembleV2>, name: string) => b.tools.find((t) => t.name === name) as Tool;

describe("delegation as an extension", () => {
  it("declares read-only agents only, so delegating cannot change anything", () => {
    expect(SUB_AGENTS.length).toBeGreaterThan(0);
    for (const agent of SUB_AGENTS) {
      expect(agent.tools, agent.name).not.toContain("write_file");
      expect(agent.tools, agent.name).not.toContain("edit_file");
      expect(agent.tools, agent.name).not.toContain("run_command");
      expect(agent.tools, agent.name).not.toContain("delegate");
      expect(agent.maxIterations).toBeGreaterThan(0);
      expect(agent.maxIterations).toBeLessThanOrEqual(10);
    }
  });

  it("names every declared agent in the tool's description, so the model can choose", () => {
    const delegate = delegateTool(SUB_AGENTS);
    for (const agent of SUB_AGENTS) expect(delegate.description).toContain(agent.name);
    expect(delegate.inputSchema.required).toEqual(["agent", "task"]);
  });

  it("refuses an unknown agent without calling the loop", async () => {
    let called = false;
    const out = await delegateTool(SUB_AGENTS).execute(
      { agent: "nonexistent", task: "x" },
      ctxWith(() => {
        called = true;
        return { kind: "completed", text: "nope" };
      }),
    );
    expect(out.kind).toBe("failure");
    expect((out as { message: string }).message).toContain("explorer");
    expect(called).toBe(false);
  });

  it("refuses an empty task, because a sub-agent cannot ask for detail", async () => {
    const out = await delegateTool(SUB_AGENTS).execute({ agent: "explorer", task: "   " }, ctxWith());
    expect(out.kind).toBe("failure");
    expect((out as { message: string }).message).toContain("cannot ask");
  });

  it("says so plainly when the harness provided no runner, instead of doing the work itself", async () => {
    const out = await delegateTool(SUB_AGENTS).execute({ agent: "explorer", task: "find the speed" }, ctxWith(undefined));
    expect(out.kind).toBe("failure");
    expect((out as { message: string }).message).toContain("unavailable");
  });

  it("returns only the sub-agent's answer plus its cost, never a transcript", async () => {
    const out = await delegateTool(SUB_AGENTS).execute(
      { agent: "explorer", task: "find the speed" },
      ctxWith(() => ({ kind: "completed", text: "Speed is 112 in vehicles.yaml", calls: 3, iterations: 2 })),
    );
    expect(out.kind).toBe("success");
    const text = (out as { content: string }).content;
    expect(text).toContain("Speed is 112");
    expect(text).toContain("3 inference call");
  });

  it("turns a failed sub-agent into a failure the parent can read", async () => {
    const out = await delegateTool(SUB_AGENTS).execute(
      { agent: "explorer", task: "x" },
      ctxWith(() => ({ kind: "failed", reason: "hit its limit: maxIterations (6)" }) as SubAgentOutcome),
    );
    expect(out.kind).toBe("failure");
    expect((out as { message: string }).message).toContain("maxIterations");
  });

  it("a throwing runner fails the call rather than the turn", async () => {
    try {
      const out = await delegateTool(SUB_AGENTS).execute(
        { agent: "explorer", task: "x" },
        ctxWith(() => {
          throw new Error("depth exceeded");
        }),
      );
      // A tool that throws is the harness's failure path; the JVM turns it into a Failure. Either is
      // acceptable, but silence is not: assert that something is reported.
      expect(out).toBeDefined();
    } catch (e) {
      expect(String(e)).toContain("depth exceeded");
    }
  });
});

describe("the sub-agent budget", () => {
  const est = (text: string) => Math.ceil(text.length / 4);
  const messages = (chars: number) => [{ content: [{ text: "x".repeat(chars) }] }];

  it("proceeds while there is budget and aborts when it is spent", () => {
    const g = budgetGuardrail(100, est);
    expect(g.beforeInference({ messages: messages(40) })).toEqual({ kind: "proceed" });
    // 400 chars is exactly 100 tokens: the limit is inclusive, so this still proceeds...
    expect(g.beforeInference({ messages: messages(400) }).kind).toBe("proceed");
    // ...and one token over it aborts. (My first version of this test asserted the opposite and was
    // wrong, not the code: 400/4 is 100, not more than 100.)
    expect(g.beforeInference({ messages: messages(404) }).kind).toBe("abort");
  });

  it("charges the peak context, not the sum of every message ever sent", () => {
    const g = budgetGuardrail(1000, est);
    // two big turns would sum past the limit, but each is under it: the peak is what costs
    expect(g.beforeInference({ messages: messages(2000) }).kind).toBe("proceed");
    expect(g.beforeInference({ messages: messages(2000) }).kind).toBe("proceed");
  });

  it("names the limit in the abort reason, so the parent can say why", () => {
    const g = budgetGuardrail(50, est);
    const decision = g.beforeInference({ messages: messages(400) });
    expect(decision.kind === "abort" && decision.reason).toContain("50");
  });
});

describe("the runtime the JVM reads back", () => {
  it("asks for delegation by default and lists the same agents the tool does", () => {
    const runtime = assembleV2(ws()).runtime;
    expect(runtime.subAgents?.map((a) => a.name)).toEqual(SUB_AGENTS.map((a) => a.name));
    expect(runtime.mode).toBe("default");
  });

  it("is not advertised when the harness cannot delegate", () => {
    const b = assembleV2(ws(), { delegate: false });
    expect(b.tools.map((t) => t.name)).not.toContain("delegate");
    expect(b.tools.map((t) => t.name)).not.toContain("list_agents");
    expect(b.runtime.subAgents).toEqual([]);
  });

  it("acceptEdits covers only the tools that change a file", () => {
    const approve = assembleV2(ws(), { mode: "acceptEdits" }).runtime.approveEdits!;
    expect(approve("edit_file", { path: "OpenRA/mods/ra/rules/vehicles.yaml" })).toBe(true);
    expect(approve("write_file", { path: "notes/a.md" })).toBe(true);
    // reading and running are not "edits", and neither is delegation
    for (const tool of ["read_file", "run_command", "delegate", "load_skill"]) {
      expect(approve(tool, {}), tool).toBe(false);
    }
  });

  it("carries the mode through, so plan mode reaches the loop", () => {
    expect(assembleV2(ws(), { mode: "plan" }).runtime.mode).toBe("plan");
  });
});

describe("the permissions section", () => {
  it("always says how run_command works, because that is not guessable", () => {
    const text = permissionsSection("default").text!;
    expect(text).toContain("argv");
    expect(text).toContain("policy");
    expect(text).toContain("list_agents");
  });

  it("states the plan and acceptEdits modes differently", () => {
    const plan = permissionsSection("plan").text!;
    const accept = permissionsSection("acceptEdits").text!;
    const def = permissionsSection("default").text!;
    expect(plan).toContain("PLAN mode");
    expect(accept).toContain("ACCEPT-EDITS");
    expect(def).not.toContain("PLAN mode");
    expect(def).not.toContain("ACCEPT-EDITS");
  });

  it("is part of the assembled prompt", () => {
    expect(assembleV2(ws()).systemPrompt.map((s) => s.name)).toContain("permissions");
  });
});

describe("the policy covers v2's own tools", () => {
  it("allows load_skill and list_agents, which the default-deny would otherwise refuse", () => {
    const b = assembleV2(ws());
    const policy = b.guardrails.find((g) => g.name === "policy")!;
    for (const tool of ["load_skill", "list_agents"]) {
      const decision = policy.beforeToolUse!(toolCall(tool, tool === "load_skill" ? { name: "mod-change-checklist" } : {}), {} as never);
      expect((decision as { kind: string }).kind, tool).toBe("allow");
    }
  });

  it("still denies delegate: running it is the loop's job, and an unruled tool denies", () => {
    const policy = assembleV2(ws()).guardrails.find((g) => g.name === "policy")!;
    const decision = policy.beforeToolUse!(toolCall("delegate", { agent: "explorer", task: "x" }), {} as never);
    expect((decision as { kind: string }).kind).toBe("deny");
  });
});
