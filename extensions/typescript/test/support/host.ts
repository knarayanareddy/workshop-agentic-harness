// Stand-ins for what the JVM hands a TypeScript extension, so the extensions can be tested in Node,
// without the harness and without spending tokens. Test code only: Node's fs and path do not exist in
// the embedded runtime the extensions really run in.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CommandResult, Tool, ToolCall, ToolContext, TurnContext, Workspace } from "@harness/api";

/** Characters Java's Path rejects on Windows. That `InvalidPathException` is what `contains` throws there. */
const INVALID_ON_WINDOWS = /[<>"|?*\u0000-\u001f]|(?<!^[A-Za-z]):/;

const isInside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Behaves like `LocalWorkspace` in harness-core: paths resolve against the root, and a path that leaves
 * it (`..`, an absolute path elsewhere, a symlink pointing out) throws.
 */
export function nodeWorkspace(dir: string = mkdtempSync(join(tmpdir(), "harness-ts-"))): Workspace {
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });

  const resolveInside = (path: string): string => {
    if (process.platform === "win32" && INVALID_ON_WINDOWS.test(path)) throw new Error(`Illegal char in path: ${path}`);
    const resolved = resolve(root, path);
    if (!isInside(root, resolved)) throw new Error(`'${path}' is outside the workspace`);
    if (existsSync(resolved) && !isInside(realpathSync.native(root), realpathSync.native(resolved))) {
      throw new Error(`'${path}' resolves outside the workspace`);
    }
    return resolved;
  };

  return {
    root,
    resolve: resolveInside,
    contains(path) {
      if (process.platform === "win32" && INVALID_ON_WINDOWS.test(path)) throw new Error(`Illegal char in path: ${path}`);
      try {
        resolveInside(path);
        return true;
      } catch {
        return false;
      }
    },
    relativize: (absolutePath) => relative(root, resolve(absolutePath)).split(sep).join("/"),
    exists: (path) => existsSync(resolveInside(path)),
    readText(path) {
      const file = resolveInside(path);
      if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`'${path}' is not a file`);
      return readFileSync(file, "utf8");
    },
    writeText(path, content) {
      const file = resolveInside(path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    list(path = ".") {
      const directory = resolveInside(path);
      return readdirSync(directory, { withFileTypes: true })
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .sort();
    },
  };
}

/** The context guardrails and dynamic sections get, at inference call `iteration` of `maxIterations`. */
export const turnContext = (workspace: Workspace, iteration = 1, maxIterations = 25): TurnContext => ({
  runId: "run",
  iteration,
  maxIterations,
  iterationsRemaining: maxIterations - iteration,
  messages: [],
  workspace,
});

/**
 * The context a tool gets. `exec` answers with `result` instead of running anything; `logs` collects
 * what the tool logged.
 */
export function toolContext(workspace: Workspace, result: CommandResult = { exitCode: 0, output: "", timedOut: false }) {
  const logs: string[] = [];
  const commands: string[] = [];
  const ctx: ToolContext = {
    runId: "run",
    iteration: 1,
    toolUseId: "id",
    workspace,
    log: (...message) => logs.push(message.join(" ")),
    exec: (command) => {
      commands.push(command);
      return result;
    },
    spawn: () => {},
  };
  return { ctx, logs, commands };
}

/** A call of the tool named `tool` with `input`, as a guardrail sees it. */
export const toolCall = (tool: string | Tool, input: Record<string, unknown> = {}): ToolCall => ({
  id: "1",
  tool: typeof tool === "string" ? { name: tool, description: "" } : tool,
  input,
});
