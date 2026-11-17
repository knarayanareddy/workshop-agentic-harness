// The helpers the assignments build on. The same cases as HelpersTest in Java and Kotlin.

import { dirname } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, Workspace } from "@harness/api";
import { commands, git, host, modRules, text, toolbox } from "../src/helpers";
import { nodeWorkspace, toolCall, toolContext } from "./support/host";

let workspace: Workspace;
beforeEach(() => {
  workspace = nodeWorkspace();
});

describe("text", () => {
  it("truncates with a note and splits lines", () => {
    expect(text.truncate("short", 10)).toBe("short");
    expect(text.truncate("abcdef", 3)).toBe("abc\n[cut at 3 characters]");
    expect(text.truncate("abcdef", 3, "read the rest")).toBe("abc\nread the rest");
    expect(text.nonBlankLines("one\r\n\r\n  \ntwo\n")).toEqual(["one", "two"]);
  });
});

describe("host", () => {
  it("gives the time to the minute with an offset", () => {
    expect(host.now()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}$/);
    expect(host.system()).not.toBe("");
  });
});

describe("git", () => {
  const answering = (result: CommandResult) => ({ exec: () => result });

  it("reads the repository root, branch and changes from git's output", () => {
    expect(git.repositoryRoot(answering({ exitCode: 0, output: "/work\n", timedOut: false }))).toBe("/work");
    expect(git.repositoryRoot(answering({ exitCode: 128, output: "fatal: not a git repository", timedOut: false }))).toBeNull();
    expect(git.branch(answering({ exitCode: 0, output: "\n", timedOut: false }), "OpenRA")).toBeNull();
    expect(git.changes(answering({ exitCode: 0, output: " M a.yaml\n?? b.lua\n", timedOut: false }), "OpenRA")).toEqual([" M a.yaml", "?? b.lua"]);
  });
});

describe("commands", () => {
  it("reads the command line of run_command only", () => {
    expect(commands.of(toolCall("run_command", { command: "ls -la" }))).toBe("ls -la");
    expect(commands.of(toolCall("read_file", { command: "ls -la" }))).toBeNull();
    expect(commands.words('git -C OpenRA push "origin"')).toEqual(["git", "-C", "OpenRA", "push", "origin"]);
    expect(commands.names("C:\\Python\\python.exe x.py")).toEqual(["python", "x.py"]);
    expect(commands.names('sh -c "/usr/bin/python3 x.py"')).toEqual(["sh", "-c", "python3", "x.py"]);
    expect(commands.hasWords("cd OpenRA && GIT push", "git", "push")).toBe(true);
    expect(commands.hasWords("git status", "git", "push")).toBe(false);
    expect(commands.hasWords("git pushy", "git", "push")).toBe(false);
  });

  it("knows which words leave the workspace", () => {
    for (const word of ["..", "../x", "~/.ssh", "$HOME/x", "%USERPROFILE%", dirname(workspace.root)]) {
      expect(commands.isOutsideWorkspace(word, workspace), word).toBe(true);
    }
    for (const word of ["", "OpenRA", "./out/x", "-la", "/dev/null"]) {
      expect(commands.isOutsideWorkspace(word, workspace), word).toBe(false);
    }
  });
});

describe("toolbox", () => {
  it("reads the status from the log", () => {
    const { ctx } = toolContext(workspace);
    expect(toolbox.status(ctx).state).toBe("not_started");
    workspace.writeText(toolbox.START_LOG, "Step 1/9\nStep 2/9\n");
    expect(toolbox.status(ctx)).toEqual({ state: "starting", log: "Step 1/9\nStep 2/9" });
    workspace.writeText(toolbox.START_LOG, "Step 9/9\n\nexit code 0\n");
    expect(toolbox.status(ctx).state).toBe("ready");
    workspace.writeText(toolbox.START_LOG, "error: no space left\n\nexit code 1\n");
    expect(toolbox.status(ctx)).toEqual({ state: "failed", log: "error: no space left\nexit code 1" });
  });

  it("knows when the container is not running", () => {
    const { ctx, commands: run } = toolContext(workspace, { exitCode: 1, output: "Error: No such container: openra-toolbox", timedOut: false });
    expect(toolbox.exec(ctx, "openra-check")).toBeNull();
    expect(run).toEqual(["docker exec openra-toolbox openra-check"]);
  });
});

describe("modRules", () => {
  const writeMod = () => {
    workspace.writeText(
      `${modRules.MOD}/fluent/rules.ftl`,
      "actor-2tnk =\n    .name = Medium Tank\n    .description = Tank.\n\nactor-tsla-name = Tesla Coil\nactor-vehicle-name = Vehicle\n",
    );
    workspace.writeText(
      `${modRules.RULES}/vehicles.yaml`,
      "^Vehicle:\n\tTooltip:\n\t\tName: actor-vehicle-name\n\tMobile:\n\t\tSpeed: 50\n\n" +
        "2TNK:\n\tInherits: ^Vehicle\n\tTooltip:\n\t\tName: actor-2tnk.name\n\tMobile:\n\t\tTurnSpeed: 20\n\t\tSpeed: 72\n\tHealth:\n\t\tHP: 400\n",
    );
    workspace.writeText(`${modRules.RULES}/structures.yaml`, "# defenses\nTSLA:\n\tTooltip:\n\t\tName: actor-tsla-name\n");
    workspace.writeText(`${modRules.RULES}/README.txt`, "not rules");
  };

  it("lists named actors without templates", () => {
    writeMod();
    expect(modRules.actors(workspace)).toEqual(expect.arrayContaining([
      { id: "2TNK", name: "Medium Tank", file: `${modRules.RULES}/vehicles.yaml` },
      { id: "TSLA", name: "Tesla Coil", file: `${modRules.RULES}/structures.yaml` },
    ]));
    expect(modRules.actors(workspace)).toHaveLength(2);
  });

  it("sets only a value the actor defines itself", () => {
    writeMod();
    const file = `${modRules.RULES}/vehicles.yaml`;
    expect(modRules.setValue(workspace, "2tnk", "Mobile", "Speed", " 80 ")).toEqual({ kind: "changed", file, oldValue: "72" });
    expect(workspace.readText(file)).toContain("\t\tSpeed: 80\n\tHealth:");
    expect(workspace.readText(file), "the template is untouched").toContain("\t\tSpeed: 50\n");
    expect(modRules.setValue(workspace, "2TNK", "Health", "Armor", "Heavy")).toEqual({ kind: "no_such_key", file });
    expect(modRules.setValue(workspace, "2TNK", "Armament", "Weapon", "x")).toEqual({ kind: "no_such_trait", file });
    expect(modRules.setValue(workspace, "4TNK", "Mobile", "Speed", "1")).toEqual({ kind: "no_such_actor" });
    expect(() => modRules.setValue(workspace, "2TNK", "Mobile", "Speed", "1\n\tHP: 1")).toThrow();
  });
});
