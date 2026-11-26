import { describe, expect, it } from "vitest";
import {
  RUNNER_ALLOWLIST,
  describeBlastRadius,
  escapesWorkspace,
  evaluate,
  gitSubcommand,
  globToRegExp,
  matchesGlob,
  parsePolicy,
  policyGuardrail,
  runCommandArgv,
  type PolicyState,
} from "../../src/v2/policy";
import type { PolicyFile } from "../../src/v2/contract";
import { nodeWorkspace, toolCall, toolContext } from "../support/host";

const layer = (rules: PolicyFile["rules"], defaults?: PolicyFile["defaults"]): PolicyFile => ({
  policy: "test",
  layer: "test",
  defaults,
  rules,
});

// A compact version of the shipped base policy, so the tests state the INTENT, not the file.
const BASE = layer(
  [
    {
      id: "P-protected",
      effect: "deny",
      owner: "security",
      rationale: "may hold secrets",
      tool: ["read_file", "write_file", "edit_file", "grep", "glob", "list_files"],
      path: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/id_rsa*"],
      except_path: ["**/.env.example"],
    },
    {
      id: "P-build-files",
      effect: "deny",
      owner: "workshop-staff",
      rationale: "make the test pass, not the build",
      tool: ["write_file", "edit_file"],
      path: ["**/build.gradle.kts", "**/pom.xml", "**/package.json"],
      suggest: "Fix the code under test.",
    },
    {
      id: "P-no-upstream",
      effect: "deny",
      owner: "workshop-staff",
      rationale: "upstream is a destination nobody here may write to",
      tool: ["run_command"],
      argv: { program: ["git"], subcommand: ["push", "remote", "request-pull"] },
      suggest: "Commit locally.",
    },
    {
      id: "P-git-mutating",
      effect: "ask",
      owner: "workshop-staff",
      rationale: "changes the local checkout",
      tool: ["run_command"],
      argv: { program: ["git"], subcommand: ["add", "commit", "checkout", "reset", "clone"] },
    },
    { id: "P-readonly", effect: "allow", owner: "workshop-staff", rationale: "read-only", tool: ["run_command"], argv: { program: ["ls", "cat", "grep", "pwd"] } },
    { id: "P-read-file", effect: "allow", owner: "workshop-staff", rationale: "reading is free", tool: ["read_file"] },
  ],
  { run_command: "deny" },
);

const decide = (call: ReturnType<typeof toolCall>, files: PolicyFile[] = [BASE], mode: "default" | "plan" | "acceptEdits" = "default") =>
  evaluate(files, call, mode);

describe("glob matching", () => {
  it("matches .env at any depth, including the root", () => {
    expect(matchesGlob("**/.env", ".env")).toBe(true);
    expect(matchesGlob("**/.env", "OpenRA/.env")).toBe(true);
    expect(matchesGlob("**/.env", "a/b/.env")).toBe(true);
    expect(matchesGlob("**/.env", "a/.env.local")).toBe(false);
  });

  it("keeps * inside one segment and lets ** span directories", () => {
    expect(matchesGlob("OpenRA/mods/*.yaml", "OpenRA/mods/ra.yaml")).toBe(true);
    expect(matchesGlob("OpenRA/mods/*.yaml", "OpenRA/mods/ra/x.yaml")).toBe(false);
    expect(matchesGlob("OpenRA/mods/**", "OpenRA/mods/ra/rules/x.yaml")).toBe(true);
    expect(matchesGlob("**/*.pem", "a/b/c.pem")).toBe(true);
    expect(matchesGlob("**/*.pem", "c.pem")).toBe(true);
  });

  it("escapes regex metacharacters rather than treating them as a pattern", () => {
    expect(globToRegExp("a+b.txt").source).toContain("a\\+b");
    expect(matchesGlob("a+b.txt", "a+b.txt")).toBe(true);
    expect(matchesGlob("a+b.txt", "aab.txt")).toBe(false);
  });
});

describe("structural argv parsing", () => {
  it("finds the subcommand behind git's global options", () => {
    expect(gitSubcommand(["git", "push"])).toBe("push");
    // the regex-bypass case this exists for:
    expect(gitSubcommand(["git", "-C", "OpenRA", "push"])).toBe("push");
    expect(gitSubcommand(["git", "-c", "user.name=x", "commit", "-m", "m"])).toBe("commit");
    expect(gitSubcommand(["git", "--git-dir=.git", "status"])).toBe("status");
    expect(gitSubcommand(["/usr/bin/git", "remote", "add", "o", "u"])).toBe("remote");
    expect(gitSubcommand(["ls"])).toBe(null);
  });

  it("detects arguments that leave the workspace", () => {
    expect(escapesWorkspace("/etc/passwd", "/ws")).toBe(true);
    expect(escapesWorkspace("../outside", "/ws")).toBe(true);
    expect(escapesWorkspace("~/secrets", "/ws")).toBe(true);
    expect(escapesWorkspace("a/b/c", "/ws")).toBe(false);
    expect(escapesWorkspace("a/../b", "/ws")).toBe(false); // stays inside
    expect(escapesWorkspace("C:\\Windows", "/ws")).toBe(true);
  });
});

describe("policy parsing fails closed", () => {
  it("drops an invalid layer and reports why, keeping the valid ones", () => {
    const r = parsePolicy({ "00-base": JSON.stringify({ policy: "b", layer: "00-base", rules: [] }), "10-mine": "{ not json" });
    expect(r.files).toHaveLength(1);
    expect(r.errors[0]).toMatch(/not valid JSON/);
  });

  it("rejects a rule missing a required field, and an unknown effect", () => {
    const missing = parsePolicy({ x: JSON.stringify({ rules: [{ id: "a", effect: "deny", rationale: "r" }] }) });
    expect(missing.files).toHaveLength(0);
    expect(missing.errors[0]).toMatch(/missing id\/effect\/rationale\/owner/);

    const badEffect = parsePolicy({
      x: JSON.stringify({ rules: [{ id: "a", effect: "permit", rationale: "r", owner: "o" }] }),
    });
    expect(badEffect.files).toHaveLength(0);
    expect(badEffect.errors[0]).toMatch(/effect 'permit'/);
  });

  it("a typo in YOUR layer cannot loosen the base layer", () => {
    const parsed = parsePolicy({ "00-base": JSON.stringify(BASE), "10-mine": "{ typo" });
    const verdict = evaluate(parsed.files, toolCall("read_file", { path: ".env" }));
    expect(verdict.effect).toBe("deny");
    expect(parsed.errors).toHaveLength(1);
  });
});

describe("policy evaluation", () => {
  it("denies secrets, but still allows the documented example file", () => {
    for (const p of [".env", "OpenRA/.env", "a/.env.production", "x/id_rsa", "k.pem"]) {
      expect(decide(toolCall("read_file", { path: p })).effect, p).toBe("deny");
    }
    expect(decide(toolCall("read_file", { path: ".env.example" })).effect).toBe("allow");
  });

  it("covers edit_file as well as write_file (the v1 bypass)", () => {
    expect(decide(toolCall("write_file", { path: "pom.xml" })).effect).toBe("deny");
    expect(decide(toolCall("edit_file", { path: "pom.xml" })).effect).toBe("deny");
    expect(decide(toolCall("edit_file", { path: "build.gradle.kts" })).effect).toBe("deny");
  });

  it("denies git push even behind git's global options", () => {
    expect(decide(toolCall("run_command", { argv: ["git", "push"] })).effect).toBe("deny");
    expect(decide(toolCall("run_command", { argv: ["git", "-C", "OpenRA", "push", "origin", "HEAD"] })).effect).toBe("deny");
    expect(decide(toolCall("run_command", { argv: ["git", "-c", "a=b", "remote", "add", "o", "u"] })).effect).toBe("deny");
  });

  it("asks before mutating the checkout, allows read-only programs", () => {
    expect(decide(toolCall("run_command", { argv: ["git", "commit", "-m", "x"] })).effect).toBe("ask");
    expect(decide(toolCall("run_command", { argv: ["ls", "-la"] })).effect).toBe("allow");
    expect(decide(toolCall("run_command", { argv: ["cat", "x.yaml"] })).effect).toBe("allow");
  });

  it("denies an unlisted program (default-deny), rather than falling through", () => {
    const v = decide(toolCall("run_command", { argv: ["python3", "-c", "print(1)"] }));
    expect(v.effect).toBe("deny");
    expect(v.rationale).toMatch(/no rule matched|default-deny|defaults/);
  });

  it("denies a v1 shell string: a call with no argv matches no argv rule", () => {
    // The old shape { command: "git push" } must not slip through as an allow.
    expect(decide(toolCall("run_command", { command: "git push" })).effect).toBe("deny");
    expect(decide(toolCall("run_command", { command: "cat .en*" })).effect).toBe("deny");
  });

  it("takes the strictest verdict across layers", () => {
    const project = layer([{ id: "P-mine", effect: "ask", owner: "me", rationale: "I want to see it", tool: ["run_command"] }]);
    expect(decide(toolCall("run_command", { argv: ["ls"] }), [BASE, project]).effect).toBe("ask");
    expect(decide(toolCall("run_command", { argv: ["git", "push"] }), [BASE, project]).effect).toBe("deny");
  });

  it("a project layer can only tighten, never loosen a deny", () => {
    const permissive = layer([{ id: "P-allow-all", effect: "allow", owner: "me", rationale: "trust me", tool: ["read_file"] }]);
    expect(decide(toolCall("read_file", { path: ".env" }), [BASE, permissive]).effect).toBe("deny");
  });

  it("reports every rule it considered, so the UI can explain itself", () => {
    const v = decide(toolCall("run_command", { argv: ["git", "push"] }));
    expect(v.considered.map((c) => c.ruleId)).toContain("P-no-upstream");
    expect(v.ruleId).toBe("P-no-upstream");
    expect(v.owner).toBe("workshop-staff");
  });

  it("honours permission modes: plan denies writes, and only rules tagged with a mode apply", () => {
    const withPlan = layer([{ id: "P-plan", effect: "deny", owner: "o", rationale: "read-only", tool: ["write_file", "edit_file"], modes: ["plan"] }]);
    expect(decide(toolCall("write_file", { path: "src/A.kt" }), [BASE, withPlan], "plan").effect).toBe("deny");
    expect(decide(toolCall("write_file", { path: "src/A.kt" }), [BASE, withPlan], "default").effect).toBe("deny");
    // ^ build files are denied in every mode; a non-build file is only denied in plan
    const free = layer([{ id: "P-plan", effect: "deny", owner: "o", rationale: "read-only", tool: ["write_file", "edit_file"], modes: ["plan"] }]);
    expect(decide(toolCall("write_file", { path: "notes.md" }), [BASE, free], "default").effect).toBe("deny");
    expect(decide(toolCall("write_file", { path: "notes.md" }), [free], "plan").effect).toBe("deny");
    expect(decide(toolCall("write_file", { path: "notes.md" }), [{ ...free, rules: [] }], "plan").effect).toBe("deny");
  });
});

describe("the guardrail adapter", () => {
  it("records a verdict per tool-use id and maps effects to decisions", () => {
    const state: PolicyState = { files: [BASE], mode: "default", errors: [], verdicts: new Map() };
    const g = policyGuardrail(state);
    // distinct ids, as the loop supplies: one verdict is recorded per tool-use
    const call = (id: string, x: Record<string, unknown>) => ({ ...toolCall("run_command", x), id });
    expect(g.beforeToolUse({ ...toolCall("read_file", { path: ".env" }), id: "a" }).kind).toBe("deny");
    expect(g.beforeToolUse(call("b", { argv: ["ls"] })).kind).toBe("allow");
    expect(g.beforeToolUse(call("c", { argv: ["git", "commit", "-m", "x"] })).kind).toBe("ask");
    expect([...state.verdicts.keys()]).toEqual(["a", "b", "c"]);
    expect(state.verdicts.get("c")!.ruleId).toBe("P-git-mutating");
  });

  it("puts the owner and the alternative into the reason a human reads", () => {
    const d = policyGuardrail({ files: [BASE], mode: "default", errors: [], verdicts: new Map() }).beforeToolUse(
      toolCall("run_command", { argv: ["git", "push"] }),
    );
    expect(d.kind).toBe("deny");
    if (d.kind !== "deny") throw new Error("unreachable");
    expect(d.reason).toMatch(/P-no-upstream/);
    expect(d.reason).toMatch(/workshop-staff/);
    expect(d.reason).toMatch(/Commit locally/);
  });
});

describe("the argv runner", () => {
  const ws = () => nodeWorkspace();
  const ctxFor = (result = { exitCode: 0, output: "", timedOut: false }) => toolContext(ws(), result);

  it("refuses a program that is not on the allow-list without running it", async () => {
    const out = await runCommandArgv.execute({ argv: ["python3", "-c", "x"] }, ctxFor().ctx);
    expect(out.kind).toBe("failure");
    if (out.kind !== "failure") throw new Error("unreachable");
    expect(out.message).toMatch(/not on the runner's allow-list/);
  });

  it("never builds a shell string from the model's input unquoted", async () => {
    const h = ctxFor();
    await runCommandArgv.execute({ argv: ["echo", "a; rm -rf /"] }, h.ctx);
    // the metacharacter sequence must arrive as ONE quoted argument, not as two shell words
    expect(h.commands[0]).toBe("echo 'a; rm -rf /'");
  });

  it("rejects a malformed argv", async () => {
    expect((await runCommandArgv.execute({ argv: [] }, ctxFor().ctx)).kind).toBe("failure");
    expect((await runCommandArgv.execute({ argv: ["ls", 1] } as never, ctxFor().ctx)).kind).toBe("failure");
    expect((await runCommandArgv.execute({} as never, ctxFor().ctx)).kind).toBe("failure");
  });

  it("reports a timeout and a non-zero exit as failures", async () => {
    const timeout = await runCommandArgv.execute({ argv: ["ls"] }, ctxFor({ exitCode: -1, output: "partial", timedOut: true }).ctx);
    expect(timeout.kind).toBe("failure");
    const bad = await runCommandArgv.execute({ argv: ["ls"] }, ctxFor({ exitCode: 2, output: "nope", timedOut: false }).ctx);
    expect(bad.kind).toBe("failure");
  });

  it("allows every program it advertises", async () => {
    for (const p of RUNNER_ALLOWLIST) expect(RUNNER_ALLOWLIST.has(p), p).toBe(true);
    expect(RUNNER_ALLOWLIST.has("sh")).toBe(false);
    expect(RUNNER_ALLOWLIST.has("bash")).toBe(false);
    expect(RUNNER_ALLOWLIST.has("curl")).toBe(false);
  });
});

describe("blast radius (what the approval prompt shows)", () => {
  it("distinguishes a whole-file write from a reviewable edit, and names the scope", () => {
    const w = describeBlastRadius(toolCall("write_file", { path: "OpenRA/mods/ra/rules/x.yaml", content: "abc" }));
    expect(w.kind).toBe("write");
    expect(w.scope).toBe("OpenRA/mods/ra/rules");
    expect(w.summary).toMatch(/whole file/);
    const e = describeBlastRadius(toolCall("edit_file", { path: "OpenRA/mods/ra/rules/x.yaml", old_text: "a", new_text: "b" }));
    expect(e.kind).toBe("edit");
    expect(e.summary).toMatch(/reviewable diff/);
  });

  it("shows the command that would run", () => {
    const c = describeBlastRadius(toolCall("run_command", { argv: ["git", "-C", "OpenRA", "commit", "-m", "x"] }));
    expect(c.kind).toBe("command");
    expect(c.target).toBe("git -C OpenRA commit -m x");
  });
});
