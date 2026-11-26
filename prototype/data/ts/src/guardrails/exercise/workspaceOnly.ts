import { allow, deny, type Guardrail } from "@harness/api";
import { commands } from "../../helpers";

/**
 * Keeps run_command inside the workspace; the file tools are contained already. A check on the words of the
 * command line, not a sandbox: the command guardrail sends variables, globs and quotes to a human.
 */
export const workspaceOnly: Guardrail = {
  name: "workspace-only",

  beforeToolUse(call, ctx) {
    const command = commands.of(call);
    if (command === null) return allow();
    const outside = commands.words(command).find((word) => commands.isOutsideWorkspace(word, ctx.workspace));
    if (outside === undefined) return allow();
    return deny(`'${outside}' is outside the workspace. Everything you need is inside it: use paths relative to the workspace root.`);
  },
};
