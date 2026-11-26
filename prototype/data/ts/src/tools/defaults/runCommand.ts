import { failure, shell, success, type Tool } from "@harness/api";

/**
 * Lets the model build, run tests and use the shell.
 * The only tool with side effects beyond the workspace files, so it is the usual target for guardrails.
 */
export const runCommand: Tool = {
  name: "run_command",
  description:
    `Run a shell command in the workspace root (${shell.name}) and return its exit code and combined output. ` +
    `Times out after ${shell.timeoutSeconds} seconds; output is limited to the last ${shell.maxOutput} characters.`,
  inputSchema: {
    type: "object",
    properties: { command: { type: "string", description: "The command line to run" } },
    required: ["command"],
  },

  execute(input, ctx) {
    if (typeof input.command !== "string") return failure("'command' must be a string with the command line to run");
    const result = ctx.exec(input.command);
    if (result.timedOut) return failure(`Timed out after ${shell.timeoutSeconds} seconds.\n${result.output}`);
    const text = `exit code ${result.exitCode}\n${result.output}`;
    return result.exitCode === 0 ? success(text) : failure(text);
  },
};
