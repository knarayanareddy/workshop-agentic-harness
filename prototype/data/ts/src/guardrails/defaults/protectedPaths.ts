import { allow, deny, shell, type Guardrail, type ToolDecision, type Workspace } from "@harness/api";

const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_files", "glob", "grep"]);

const PROTECTED: RegExp[] = [
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.git(\/|$)/,
  /\.(pem|key|p12|pfx)$/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
];

const ALLOWED = /(^|\/)\.env\.(example|sample|template)$/;

/** Splits a command line into the words that may be paths. Quotes, redirects and separators are not part of one. */
const WORD_BOUNDARY = /[\s;|&<>()"'`=]+/;

/** cmd.exe switches (`dir /b`, `findstr /i`, `dir /a:d`) look like absolute paths but are not. */
const CMD_SWITCH = /^\/[A-Za-z0-9?-]{1,3}(:[^/\\]*)?$/;

const isProtected = (relative: string) => !ALLOWED.test(relative) && PROTECTED.some((pattern) => pattern.test(relative));

const denyProtected = (relative: string) => deny(`'${relative}' is protected: it may hold secrets or repository internals`);

/**
 * Every word of the command line that resolves inside the workspace is checked against the protected
 * files. Words outside it or not valid paths on this platform are skipped, and so are cmd.exe switches
 * when that is the shell.
 */
function checkCommand(command: string, workspace: Workspace): ToolDecision {
  for (const word of command.split(WORD_BOUNDARY)) {
    if (word === "" || word === "/dev/null") continue;
    if (shell.name === "cmd.exe" && CMD_SWITCH.test(word)) continue;
    let relative: string;
    try {
      if (!workspace.contains(word)) continue;
      relative = workspace.relativize(workspace.resolve(word));
    } catch {
      continue; // not a path on this platform
    }
    if (isProtected(relative)) return denyProtected(relative);
  }
  return allow();
}

/**
 * Keeps the model away from files it has no business reading or changing.
 * The file tools are already contained by the workspace; this guardrail adds which of its own files are
 * sensitive (secrets, git internals) and looks for them in run_command too. It does not keep run_command
 * inside the workspace. Only beforeToolUse is implemented.
 *
 * For run_command this is a check on the words in the command line, not a sandbox: it cannot see
 * through globs, variables, quotes, `$(...)` or an `sh -c` that builds a path at run time. The command
 * guardrail sends every command like that to a human.
 */
export const protectedPaths: Guardrail = {
  name: "protected-paths",

  beforeToolUse(call, ctx) {
    if (call.tool.name === "run_command") {
      const command = call.input.command;
      return typeof command === "string" ? checkCommand(command, ctx.workspace) : allow();
    }
    if (!PATH_TOOLS.has(call.tool.name)) return allow();

    const requested = call.input.path;
    if (typeof requested !== "string") return allow();

    // Resolved and normalised first, so `a/../.env` is caught like `.env`.
    let relative: string;
    try {
      relative = ctx.workspace.relativize(ctx.workspace.resolve(requested));
    } catch {
      return deny(`'${requested}' is outside the workspace`);
    }
    return isProtected(relative) ? denyProtected(relative) : allow();
  },
};
