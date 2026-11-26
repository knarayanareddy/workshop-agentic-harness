import { failure, success, type Tool } from "@harness/api";
import { filesUnder, globToRegExp } from "./workspaceFiles";

const MAX_MATCHES = 100;

/**
 * Lets the model find where something is used or defined by searching file contents.
 * Saves it from reading every file.
 */
export const grep: Tool = {
  name: "grep",
  description:
    `Search workspace files for lines matching a regular expression. Returns at most ${MAX_MATCHES} matches as path:line: text; ` +
    `.git, build and node_modules are skipped. Use 'include' to restrict to a glob such as '**/*.kt'.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression" },
      path: { type: "string", description: "Directory to search, relative to the workspace root (default '.')" },
      include: { type: "string", description: "Only search files whose path matches this glob" },
    },
    required: ["pattern"],
  },

  execute(input, ctx) {
    if (typeof input.pattern !== "string") return failure("'pattern' must be a string");
    const regex = new RegExp(input.pattern);
    const include = typeof input.include === "string" ? globToRegExp(input.include) : null;
    const matches: string[] = [];
    let total = 0;
    for (const path of filesUnder(ctx.workspace, typeof input.path === "string" ? input.path : ".")) {
      if (include && !include.test(path)) continue;
      let text: string;
      try {
        text = ctx.workspace.readText(path);
      } catch {
        continue; // binary or unreadable
      }
      text.split("\n").forEach((line, i) => {
        if (!regex.test(line)) return;
        if (total++ < MAX_MATCHES) matches.push(`${path}:${i + 1}: ${line.trim().slice(0, 300)}`);
      });
    }
    if (total === 0) return success("No matches.");
    const shown = matches.join("\n");
    return success(total > MAX_MATCHES ? `${shown}\n\n[${total} matches, showing the first ${MAX_MATCHES}; narrow the pattern or path]` : shown);
  },
};
