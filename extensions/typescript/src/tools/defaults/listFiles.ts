import { success, type Tool } from "@harness/api";

/**
 * Lets the model look around one directory to learn the project layout.
 * Not recursive; see `glob` for that.
 */
export const listFiles: Tool = {
  name: "list_files",
  description: "List the entries of a workspace directory (not recursive). Directories end with '/'.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Directory relative to the workspace root; '.' for the root" } },
  },

  execute(input, ctx) {
    const entries = ctx.workspace.list(typeof input.path === "string" ? input.path : ".");
    return success(entries.length === 0 ? "(empty directory)" : entries.join("\n"));
  },
};
