import { success, type Tool } from "@harness/api";

const MAX_CHARS = 50_000;

/**
 * Lets the model inspect a file before changing it.
 * Large files are truncated, not rejected.
 */
export const readFile: Tool = {
  name: "read_file",
  description: `Read a UTF-8 text file from the workspace. Returns at most ${MAX_CHARS} characters; longer files are truncated with a note.`,
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to the workspace root" } },
    required: ["path"],
  },

  execute(input, ctx) {
    const text = ctx.workspace.readText(String(input.path));
    if (text.length <= MAX_CHARS) return success(text);
    return success(`${text.slice(0, MAX_CHARS)}\n\n[truncated: file has ${text.length} characters, showing the first ${MAX_CHARS}]`);
  },
};
