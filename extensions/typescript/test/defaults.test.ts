// The TypeScript twin of DefaultsTest in extensions/java and extensions/kotlin: the same cases, so the
// three languages keep behaving alike. Run it with `npm test` here, or `./gradlew :extensions:typescript:test`.

import { basename } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { shell, type AssemblyContext, type Extension, type ToolDecision, type Workspace } from "@harness/api";
import extension from "../src/index";
import { buildFile } from "../src/guardrails/defaults/buildFile";
import { command } from "../src/guardrails/defaults/command";
import { protectedPaths } from "../src/guardrails/defaults/protectedPaths";
import { resultCap } from "../src/guardrails/defaults/resultCap";
import { iterationBudget } from "../src/systemprompt/defaults/iterationBudget";
import { role } from "../src/systemprompt/defaults/role";
import { workingAgreements } from "../src/systemprompt/defaults/workingAgreements";
import { fileStats } from "../src/tools/defaults/fileStats";
import { runCommand } from "../src/tools/defaults/runCommand";
import { nodeWorkspace, toolCall, toolContext, turnContext } from "./support/host";

let workspace: Workspace;
beforeEach(() => {
  workspace = nodeWorkspace();
});

const kind = (decision: unknown) => (decision as ToolDecision).kind;

// The workshop adds to the bundle and removes default sections from it, so this checks what must stay
// true of any bundle, and the tests below test the defaults directly instead of through the bundle.
describe("the bundle", () => {
  const build = (): Extension => {
    const ctx: AssemblyContext = { workspace, exec: () => ({ exitCode: 0, output: "", timedOut: false }) };
    return extension(ctx);
  };

  it("has the default tools and guardrails and no duplicate names", () => {
    const bundle = build();
    const tools = (bundle.tools ?? []).map((t) => t.name);
    expect(new Set(tools).size, `duplicate tool names: ${tools}`).toBe(tools.length);
    expect(tools).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "list_files", "glob", "grep", "run_command", "file_stats"]));
    const sections = (bundle.systemPrompt ?? []).map((s) => s.name);
    expect(new Set(sections).size, `duplicate section names: ${sections}`).toBe(sections.length);
    const guardrails = (bundle.guardrails ?? []).map((g) => g.name);
    expect(guardrails).toEqual(expect.arrayContaining([protectedPaths.name, command.name, buildFile.name, resultCap().name]));
    expect(bundle.listeners?.length).toBeGreaterThan(0);
  });
});

describe("default sections", () => {
  it("build the role", () => {
    expect(role(workspace)).toEqual({
      kind: "static",
      name: "role",
      text: `You are a coding agent working in the directory ${basename(workspace.root)}. Use the tools to inspect and change files; do not guess file contents.`,
    });
    expect(workingAgreements).toMatchObject({ kind: "static" });
    expect(workingAgreements.kind === "static" && workingAgreements.text.trim()).toBeTruthy();
  });

  it("iteration budget speaks only when tight", async () => {
    if (iterationBudget.kind !== "dynamic") throw new Error("iteration_budget should be a dynamic section");
    expect(await iterationBudget.render(turnContext(workspace, 1, 25))).toBeNull();
    expect(await iterationBudget.render(turnContext(workspace, 22, 25))).toContain("3 inference calls");
  });
});

describe("default tools", () => {
  it("file stats counts through the workspace", async () => {
    workspace.writeText("a.txt", "one two\nthree\n");
    const { ctx, logs } = toolContext(workspace);
    expect(await fileStats.execute({ path: "a.txt" }, ctx)).toEqual({ kind: "success", content: "a.txt: 3 lines, 3 words, 14 characters" });
    expect(logs).toEqual(["counting a.txt"]);
  });

  it("run_command reports the exit code, and a failing or timed-out command as a failure", async () => {
    const ok = toolContext(workspace, { exitCode: 0, output: "hi", timedOut: false });
    expect(await runCommand.execute({ command: "echo hi" }, ok.ctx)).toEqual({ kind: "success", content: "exit code 0\nhi" });
    expect(ok.commands).toEqual(["echo hi"]);
    const failed = toolContext(workspace, { exitCode: 2, output: "nope", timedOut: false });
    expect(await runCommand.execute({ command: "false" }, failed.ctx)).toEqual({ kind: "failure", message: "exit code 2\nnope" });
    const slow = toolContext(workspace, { exitCode: -1, output: "", timedOut: true });
    expect(await runCommand.execute({ command: "sleep 999" }, slow.ctx)).toMatchObject({ kind: "failure" });
  });
});

describe("guardrails", () => {
  it("command guardrail denies destructive and asks for chained commands", async () => {
    const decide = async (c: string) => kind(await command.beforeToolUse!(toolCall("run_command", { command: c }), turnContext(workspace)));
    for (const c of ["rm -rf x", "rm -fr x", "rm -r -f x", "git push origin main"]) expect(await decide(c), c).toBe("deny");
    for (const c of ["ls -la", "git status"]) expect(await decide(c), c).toBe("allow");
    for (const c of ["ls; touch x", "cat a > b", "ls && touch x", "cat $(touch x)", "ls\ntouch x", "npm install"]) expect(await decide(c), c).toBe("ask");
    // the shell turns these into other paths than the guardrails see
    for (const c of ["cat .en*", "cat .gi?/config", "cat '.e'nv", "cat .e\\nv", "cat $OLDPWD/x", "type %USERPROFILE%\\x"]) expect(await decide(c), c).toBe("ask");
    for (const c of ["git diff --output=build.gradle.kts", "git log --output=src/A.kt"]) expect(await decide(c), c).toBe("ask");
  });

  it("protected paths are denied for tools and commands", async () => {
    const file = async (p: string) => kind(await protectedPaths.beforeToolUse!(toolCall("read_file", { path: p }), turnContext(workspace)));
    const cmd = async (c: string) => kind(await protectedPaths.beforeToolUse!(toolCall("run_command", { command: c }), turnContext(workspace)));
    for (const p of [".env", "app/.env.local", "a/../.env", ".git/config", "certs/server.pem", "id_rsa", "../outside.txt"]) expect(await file(p), p).toBe("deny");
    expect(await file(".env.example")).toBe("allow");
    expect(await file("src/Main.kt")).toBe("allow");
    for (const c of ["cat .env", 'cat ".env"', "cp x .git/config"]) expect(await cmd(c), c).toBe("deny");
    // leaving the workspace is not this guardrail's job for run_command
    for (const c of ["cat /etc/passwd", "ls ~", "ls ..", "ls $HOME", "cd / && ls"]) expect(await cmd(c), c).toBe("allow");
    const inside = workspace.resolve("src/A.kt");
    for (const c of ["ls -la", "cat .env.example", "./gradlew test", `cat ${inside}`, "ls 2>/dev/null"]) expect(await cmd(c), c).toBe("allow");
    if (shell.name === "cmd.exe") for (const c of ["dir /b", "findstr /i foo src", "dir /a:d"]) expect(await cmd(c), c).toBe("allow");
  });

  it("build files are denied and writes outside src are gated", async () => {
    const write = async (p: string) => kind(await buildFile.beforeToolUse!(toolCall("write_file", { path: p }), turnContext(workspace)));
    expect(await write("pom.xml")).toBe("deny");
    expect(await write("src/../pom.xml")).toBe("deny");
    expect(await write("notes.md")).toBe("ask");
    expect(await write("src/A.kt")).toBe("allow");
  });

  it("oversized results are capped", async () => {
    const cap = resultCap(10);
    const after = (outcome: Parameters<NonNullable<typeof cap.afterToolUse>>[1]) =>
      cap.afterToolUse!(toolCall("read_file"), outcome, turnContext(workspace));
    expect(await after({ kind: "success", content: "short" })).toEqual({ kind: "accept" });
    expect(await after({ kind: "failure", message: "x".repeat(50) })).toEqual({ kind: "accept" });
    const cut = await after({ kind: "success", content: "x".repeat(50) });
    expect(cut.kind === "replace" && cut.outcome.kind === "success" && cut.outcome.content).toMatch(/^x{10}\n\n\[truncated/);
  });
});
