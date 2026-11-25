import type { CommandResult } from "@harness/api";
import { text } from "./text";

/** What can run a command: the `AssemblyContext` that `index.ts` receives, or a tool's `ToolContext`. */
type Exec = { exec(command: string): CommandResult };

/**
 * Asks git about the workspace. Takes the whole `ctx`, not only `ctx.workspace`, because running git needs
 * `ctx.exec`. That runs git directly, not through `run_command`, so no guardrail sees it: guardrails check the
 * model's tool calls, not your own code.
 */
export const git = {
  /** The root of the git repository the workspace is in, or `null` when it is in none (or git is not installed). */
  repositoryRoot: (ctx: Exec): string | null => {
    const result = ctx.exec("git rev-parse --show-toplevel");
    return result.exitCode === 0 ? result.output.trim() : null;
  },

  /** The branch checked out in `dir` (relative to the workspace), or `null` for a detached HEAD or no repository. */
  branch: (ctx: Exec, dir: string): string | null => {
    const result = ctx.exec(`git -C "${dir}" branch --show-current`);
    return result.exitCode === 0 ? result.output.trim() || null : null;
  },

  /** Uncommitted changes in `dir`, one per file as `git status --porcelain` prints them, like ` M mods/ra/rules/vehicles.yaml`. */
  changes: (ctx: Exec, dir: string): string[] => {
    const result = ctx.exec(`git -C "${dir}" status --porcelain`);
    return result.exitCode === 0 ? text.nonBlankLines(result.output) : [];
  },
};
