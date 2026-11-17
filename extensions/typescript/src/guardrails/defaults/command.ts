import { allow, ask, deny, type Guardrail } from "@harness/api";

const NEVER: RegExp[] = [
  /\brm\b(?=[^;&|]*\s-[a-zA-Z]*[rR])(?=[^;&|]*\s-[a-zA-Z]*f)/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
];

const READ_ONLY = /^\s*(ls|dir|cat|type|git\s+(status|diff|log)|(\.\/)?gradlew(\.bat)?\s+test)(\s[\s\S]*)?$/;

/** Anything that can chain, redirect or substitute makes a "read-only" prefix meaningless: `ls; rm x`. */
const SHELL_CONTROL = /[;&|<>`\n\r]|\$\(/;

/**
 * Globs, variables, quotes and escapes become other words when the shell runs, so protected-paths cannot
 * see where they lead: `cat .en*` reads `.env`.
 */
const SHELL_EXPANSION = /[*?[\]{}$%~"'\\^]/;

/** `git diff --output=build.gradle.kts` writes a file, read-only list or not. */
const WRITES_FILE = /\s--output\b/;

/**
 * Keeps the model from running dangerous shell commands.
 * Never-acceptable commands are denied outright (§5.4: don't Ask when you mean Deny); anything not
 * on the read-only list waits for a human. Only beforeToolUse is implemented.
 */
export const command: Guardrail = {
  name: "command",

  beforeToolUse(call) {
    if (call.tool.name !== "run_command") return allow();

    const cmd = call.input.command;
    if (typeof cmd !== "string") return allow();
    if (NEVER.some((pattern) => pattern.test(cmd))) return deny(`'${cmd}' is never allowed in this workshop`);

    const readOnly = READ_ONLY.test(cmd) && !SHELL_CONTROL.test(cmd) && !SHELL_EXPANSION.test(cmd) && !WRITES_FILE.test(cmd);
    return readOnly ? allow() : ask(`runs a command: ${cmd}`);
  },
};
