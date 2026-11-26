import { failure, shell, success, type Tool } from "@harness/api";
import { text, toolbox } from "../../helpers";

/** Builds and lints the mod, and returns only what the model needs to act on. */
export const checkMod: Tool = {
  name: "check_mod",
  description:
    "Build OpenRA and lint the Red Alert mod's rules and Lua scripts. Run it after every change, before you report the change done. " +
    "Returns 'passed', or the errors to fix. Needs the toolbox (start_toolbox).",
  inputSchema: { type: "object", properties: {} },

  execute(_input, ctx) {
    const result = toolbox.exec(ctx, "openra-check");
    if (!result) return failure("The toolbox is not running. Call start_toolbox first.");
    if (result.timedOut) {
      return failure(`The check took longer than ${shell.timeoutSeconds} seconds, usually because OpenRA was compiling. Run check_mod again.`);
    }
    if (result.exitCode === 0) return success("The Red Alert mod passed all checks.");
    const errors = text.nonBlankLines(result.output).filter((line) => !line.startsWith("== ")).slice(-30);
    return failure(`The check failed. Fix these and run check_mod again:\n${errors.join("\n")}`);
  },
};
