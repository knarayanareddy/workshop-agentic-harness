import { failure, success, type Tool } from "@harness/api";

/** Tool example: reads through ctx.workspace, which keeps every path inside the workspace. */
export const fileStats: Tool = {
  name: "file_stats",
  description: "Count the lines, words and characters of a text file in the workspace.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to the workspace root" } },
    required: ["path"],
  },

  execute(input, ctx) {
    const path = input.path;
    if (typeof path !== "string") return failure("'path' must be a string");
    const text = ctx.workspace.readText(path);
    ctx.log(`counting ${path}`);
    const lines = text === "" ? 0 : text.split("\n").length;
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    return success(`${path}: ${lines} lines, ${words} words, ${text.length} characters`);
  },
};
