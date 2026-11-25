import { failure, success, type Tool } from "@harness/api";
import { filesUnder, globToRegExp } from "./workspaceFiles";

const MAX_RESULTS = 200;

/**
 * Lets the model find files by name or path pattern, e.g. all test files.
 * Used when it does not know where something lives.
 */
export const glob: Tool = {
  name: "glob",
  description:
    `Find workspace files whose path matches a glob pattern such as '**/*.kt' or 'src/*/Main.java'. ` +
    `Returns at most ${MAX_RESULTS} paths; .git, build and node_modules are skipped.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern, matched against the path relative to the workspace root" },
      path: { type: "string", description: "Directory to search, relative to the workspace root (default '.')" },
    },
    required: ["pattern"],
  },

  execute(input, ctx) {
    if (typeof input.pattern !== "string") return failure("'pattern' must be a string");
    const matcher = globToRegExp(input.pattern);
    const hits = filesUnder(ctx.workspace, typeof input.path === "string" ? input.path : ".").filter((p) => matcher.test(p));
    if (hits.length === 0) return success("No files match.");
    const shown = hits.slice(0, MAX_RESULTS).join("\n");
    return success(hits.length > MAX_RESULTS ? `${shown}\n\n[${hits.length - MAX_RESULTS} more not shown; narrow the pattern]` : shown);
  },
};
