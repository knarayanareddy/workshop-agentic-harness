import { failure, success, type Tool } from "@harness/api";
import { toolbox } from "../../helpers";

/** Packages the checkout and opens the game on the user's machine: the whole "let me try it" job in one call. */
export const play: Tool = {
  name: "play",
  description:
    "Package the current OpenRA checkout, with all changes, and open the game on the user's machine so they can try it. " +
    "Needs the toolbox (start_toolbox). Packaging takes a minute or two: this returns at once, and the game window opens by itself.",
  inputSchema: { type: "object", properties: {} },

  execute(_input, ctx) {
    if (!toolbox.isRunning(ctx)) return failure("The toolbox is not running. Call start_toolbox first.");
    toolbox.packageAndPlay(ctx);
    return success(`Packaging started. The game opens by itself in a minute or two; tell the user. If it does not, read ${toolbox.PLAY_LOG}.`);
  },
};
