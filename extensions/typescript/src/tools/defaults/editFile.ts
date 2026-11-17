import { failure, success, type Tool } from "@harness/api";

/**
 * Lets the model make a small, targeted change without resending the whole file.
 * Fails on a missing or ambiguous match, so the model must be precise.
 */
export const editFile: Tool = {
  name: "edit_file",
  description:
    "Replace one exact piece of text in a workspace file. 'old_text' must occur exactly once (include surrounding lines to make it unique), " +
    "unless 'replace_all' is true. Prefer this over write_file for changing an existing file.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root" },
      old_text: { type: "string", description: "The exact text to replace, including whitespace" },
      new_text: { type: "string", description: "The replacement text" },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a single one (default false)" },
    },
    required: ["path", "old_text", "new_text"],
  },

  execute(input, ctx) {
    const path = String(input.path);
    const oldText = String(input.old_text);
    const newText = String(input.new_text);
    if (oldText === "") return failure("'old_text' must not be empty; use write_file to create a file.");

    const text = ctx.workspace.readText(path);
    const parts = text.split(oldText);
    const count = parts.length - 1;
    if (count === 0) return failure(`'old_text' not found in ${path}. Read the file again and copy the text exactly.`);
    if (count > 1 && input.replace_all !== true) {
      return failure(`'old_text' occurs ${count} times in ${path}. Add surrounding context to make it unique, or set replace_all.`);
    }
    // join, not replace: a replacement string would interpret "$&" and friends.
    ctx.workspace.writeText(path, parts.join(newText));
    return success(`Replaced ${count} ${count === 1 ? "occurrence" : "occurrences"} in ${path}`);
  },
};
