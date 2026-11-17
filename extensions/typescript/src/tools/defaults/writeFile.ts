import { success, type Tool } from "@harness/api";

/**
 * Lets the model create a new file or replace one completely.
 * For small changes it should prefer `edit_file`.
 */
export const writeFile: Tool = {
  name: "write_file",
  description: "Create or overwrite a UTF-8 text file in the workspace with the given content. Parent directories are created.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root" },
      content: { type: "string", description: "The complete new file content" },
    },
    required: ["path", "content"],
  },

  execute(input, ctx) {
    const path = String(input.path);
    const content = String(input.content);
    ctx.workspace.writeText(path, content);
    return success(`Wrote ${content.length} characters to ${path}`);
  },
};
