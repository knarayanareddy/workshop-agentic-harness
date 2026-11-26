// v2 — policy as data, plus the structural (argv) runner that replaces word-scanning a shell string.
//
// Two ideas, both from the workshop's own gap list:
//   C1  `run_command` is a shell-shaped hole. Guardrails read WORDS, so `git -C x push`, `cat .en*`
//       and `sh -c '...'` all slip past a regex. v2 parses argv structurally and matches on the
//       program and subcommand, so the matcher sees what would actually run.
//   C4  the build-file guardrail only understood write_file. In v2 rules name their tools explicitly,
//       so `edit_file` cannot bypass a `write_file` rule.
//
// Nothing here executes anything: verdicts are decisions. `evaluate` is pure, which is what makes it
// testable without a harness, a JVM or a model.

import { allow, ask, deny, failure, success, type Tool, type ToolDecision } from "@harness/api";
import type {
  BlastRadius,
  Effect,
  ParseResult,
  PermissionMode,
  PolicyFile,
  PolicyRule,
  PolicyVerdict,
  ToolCall,
} from "./contract";

const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_files", "glob", "grep"]);
const SEVERITY: Record<Effect, number> = { allow: 0, ask: 1, deny: 2 };

/** Programs the runner will start at all. Anything else is a deny, before any rule is consulted. */
export const RUNNER_ALLOWLIST: ReadonlySet<string> = new Set([
  "ls", "cat", "grep", "echo", "pwd", "uname", "date", "head", "tail", "wc",
  "git", "docker", "openra-check", "openra-rules", "openra-build", "openra-package",
]);

/** git's own global options, which come before the subcommand: `git -C dir status`, `git -c k=v log`. */
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);

export const baseName = (p: string): string => p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;

/** True when a path argument would leave the workspace: absolute, or containing a `..` segment. */
export function escapesWorkspace(arg: string, workspaceRoot: string): boolean {
  if (arg.startsWith("/") || /^[A-Za-z]:[\\/]/.test(arg)) return true;
  if (arg.startsWith("~")) return true;
  // A `..` segment that walks above the root. `a/../b` stays inside; `../b` does not.
  const parts = arg.replace(/\\/g, "/").split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return true;
    } else if (part !== "." && part !== "") depth += 1;
  }
  return workspaceRoot.length === 0 ? false : false;
}

/** The subcommand of an argv, skipping git's global options. `git -C dir push` -> "push". */
export function gitSubcommand(argv: string[]): string | null {
  if (baseName(argv[0] ?? "") !== "git") return null;
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (GIT_GLOBAL_WITH_VALUE.has(arg)) {
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      i += 1;
      continue;
    }
    return arg;
  }
  return null;
}

/** The argv `run_command` would execute, or null when the call has no argv (a v1 shell string). */
export function argvOf(call: ToolCall): string[] | null {
  const argv = (call.input as { argv?: unknown }).argv;
  if (!Array.isArray(argv) || argv.length === 0) return null;
  if (!argv.every((a) => typeof a === "string")) return null;
  return argv as string[];
}

// ---- globs ---------------------------------------------------------------------------------------

/**
 * A small, documented glob: `**` spans directories, `*` and `?` stay within a segment, and a leading
 * `** /` also matches at the root. Enough for `.env`, `OpenRA/mods/**`, `** /*.pem`; deliberately not
 * a full minimatch, because a policy language nobody can read is worse than a small one.
 */
export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` -> any number of segments
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else out += ".*";
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export const matchesGlob = (glob: string, path: string): boolean => globToRegExp(glob).test(path.replace(/\\/g, "/"));

const matchesAny = (globs: readonly string[] | undefined, path: string): boolean =>
  (globs ?? []).some((g) => matchesGlob(g, path));

// ---- parsing -------------------------------------------------------------------------------------

/** Parses policy layers. A layer that is not valid JSON, or is missing required fields, is DROPPED. */
export function parsePolicy(layers: Readonly<Record<string, string>>): ParseResult {
  const files: PolicyFile[] = [];
  const errors: string[] = [];
  for (const [name, text] of Object.entries(layers)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      errors.push(`layer '${name}' is not valid JSON and was ignored: ${(e as Error).message}`);
      continue;
    }
    const f = parsed as Partial<PolicyFile>;
    if (!f || typeof f !== "object" || !Array.isArray(f.rules)) {
      errors.push(`layer '${name}' has no 'rules' array and was ignored`);
      continue;
    }
    const bad = f.rules.findIndex(
      (r) => !r || typeof r.id !== "string" || typeof r.effect !== "string" || typeof r.rationale !== "string" || typeof r.owner !== "string",
    );
    if (bad >= 0) {
      errors.push(`layer '${name}' rule #${bad} is missing id/effect/rationale/owner; the layer was ignored`);
      continue;
    }
    const badEffect = f.rules.find((r) => !["allow", "ask", "deny"].includes(r.effect));
    if (badEffect) {
      errors.push(`layer '${name}' rule '${badEffect.id}' has effect '${badEffect.effect}'; the layer was ignored`);
      continue;
    }
    files.push({ policy: f.policy ?? name, layer: f.layer ?? name, defaults: f.defaults, rules: f.rules });
  }
  return { files, errors };
}

// ---- evaluation ----------------------------------------------------------------------------------

/** The path a path-taking tool would touch, workspace-relative when possible. */
export function pathOf(call: ToolCall): string | null {
  if (!PATH_TOOLS.has(call.tool.name)) return null;
  const p = (call.input as { path?: unknown }).path;
  return typeof p === "string" ? p.replace(/\\/g, "/") : null;
}

function argvMatches(rule: PolicyRule, argv: string[]): boolean | null {
  const spec = rule.argv;
  if (!spec) return null;
  const program = baseName(argv[0] ?? "");
  if (spec.program && !spec.program.includes(program)) return null;
  if (spec.subcommand) {
    const sub = gitSubcommand(argv);
    if (sub === null || !spec.subcommand.includes(sub)) return null;
  }
  if (spec.any_path_outside_workspace) {
    const args = argv.slice(1);
    if (!args.some((a) => escapesWorkspace(a, "/"))) return null;
  }
  return true;
}

function ruleMatches(rule: PolicyRule, call: ToolCall, mode: PermissionMode): boolean {
  if (rule.modes && !rule.modes.includes(mode)) return false;
  if (rule.tool && !rule.tool.includes(call.tool.name)) return false;

  const path = pathOf(call);
  if (rule.path || rule.path_not || rule.except_path) {
    if (path === null) return false;
    if (matchesAny(rule.except_path, path)) return false;
    if (rule.path && !matchesAny(rule.path, path)) return false;
    if (rule.path_not && matchesAny(rule.path_not, path)) return false;
  }

  if (rule.argv) {
    const argv = argvOf(call);
    if (argv === null) return false;
    if (argvMatches(rule, argv) !== true) return false;
  }
  return true;
}

/**
 * Evaluates every layer in order. First matching rule per LAYER wins; across layers the strictest
 * verdict wins (deny > ask > allow). When nothing matches, the layer's own `defaults` for the tool
 * applies, and failing that the strictest default among layers — so an unlisted `run_command` denies.
 */
export function evaluate(files: readonly PolicyFile[], call: ToolCall, mode: PermissionMode = "default"): PolicyVerdict {
  const considered: { ruleId: string; effect: Effect }[] = [];
  const perLayer: PolicyVerdict[] = [];

  for (const file of files) {
    let hit: PolicyRule | undefined;
    for (const rule of file.rules) {
      if (!ruleMatches(rule, call, mode)) continue;
      considered.push({ ruleId: rule.id, effect: rule.effect });
      if (!hit) hit = rule;
    }
    const defaultEffect = file.defaults?.[call.tool.name];
    if (hit) {
      perLayer.push({
        effect: hit.effect,
        ruleId: hit.id,
        layer: file.layer,
        owner: hit.owner,
        rationale: hit.rationale,
        suggest: hit.suggest,
        considered: [],
      });
    } else if (defaultEffect) {
      perLayer.push({
        effect: defaultEffect,
        ruleId: null,
        layer: file.layer,
        owner: null,
        rationale: `no rule matched; layer '${file.layer}' defaults ${call.tool.name} to ${defaultEffect}`,
        considered: [],
      });
    }
  }

  if (perLayer.length === 0) {
    return {
      effect: "deny",
      ruleId: null,
      layer: null,
      owner: null,
      rationale: `no policy matched ${call.tool.name}; default-deny`,
      considered,
    };
  }

  const winner = perLayer.reduce((a, b) => (SEVERITY[b.effect] > SEVERITY[a.effect] ? b : a));
  return { ...winner, considered };
}

// ---- the guardrail -------------------------------------------------------------------------------

export interface PolicyState {
  readonly files: PolicyFile[];
  readonly mode: PermissionMode;
  readonly errors: string[];
  /** Verdicts keyed by tool-use id, so the UI and the audit log can show what was decided and why. */
  readonly verdicts: Map<string, PolicyVerdict>;
}

export function policyGuardrail(state: PolicyState) {
  return {
    name: "policy",
    beforeToolUse(call: ToolCall): ToolDecision {
      const verdict = evaluate(state.files, call, state.mode);
      state.verdicts.set(call.id, verdict);
      return toDecision(verdict);
    },
  };
}

function toDecision(v: PolicyVerdict): ToolDecision {
  if (v.effect === "deny") return deny(describe(v));
  if (v.effect === "ask") return ask(describe(v));
  return allow();
}

/** Human-readable reason, including who owns the rule and what to do instead. */
export function describe(v: PolicyVerdict): string {
  const parts = [v.ruleId ? `rule ${v.ruleId}` : "policy default", `(${v.owner ?? "no owner"})`, `- ${v.rationale}`];
  if (v.suggest) parts.push(`\nInstead: ${v.suggest}`);
  return parts.join(" ");
}

// ---- the structural runner -----------------------------------------------------------------------

/**
 * v2's `run_command`: argv, never a shell string. The model cannot quote or glob its way past the
 * matcher because there is no shell to do the quoting, and a program that is not on the allow-list is
 * refused before any policy rule is consulted.
 */
export const runCommandArgv: Tool = {
  name: "run_command",
  description:
    "Run a program with arguments in the workspace root. Pass `argv`, e.g. [\"git\",\"-C\",\"OpenRA\",\"status\"]. " +
    "There is no shell: no pipes, globs, variables or quoting. Only allow-listed programs run; a command " +
    "that changes tracked state is gated by policy.",
  inputSchema: {
    type: "object",
    properties: {
      argv: {
        type: "array",
        items: { type: "string" },
        description: "program and arguments, e.g. [\"grep\",\"-n\",\"Speed\",\"OpenRA/mods/ra/rules/vehicles.yaml\"]",
      },
    },
    required: ["argv"],
    additionalProperties: false,
  },

  execute(input, ctx) {
    const argv = (input as { argv?: unknown }).argv;
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string")) {
      return failure("'argv' must be a non-empty array of strings");
    }
    const args = argv as string[];
    const program = baseName(args[0]!);
    if (!RUNNER_ALLOWLIST.has(program)) {
      return failure(`'${program}' is not on the runner's allow-list (${[...RUNNER_ALLOWLIST].join(", ")})`);
    }
    // Quote only for the harness's own shell transport; the model cannot reach this layer, so the
    // quoting cannot be used to inject anything.
    const command = args.map((a) => (/^[\w./:=@%+,-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
    ctx.log(`argv ${command}`);
    const result = ctx.exec(command);
    if (result.timedOut) return failure(`Timed out. Output so far:\n${result.output}`);
    const text = `exit code ${result.exitCode}\n${result.output}`;
    return result.exitCode === 0 ? success(text) : failure(text);
  },
};

/** Kept for the UI and docs: a v1-shaped view of a v2 guardrail is still a guardrail. */
export const isPathTool = (name: string): boolean => PATH_TOOLS.has(name);

/** What an approval prompt shows for a call: target plus how far the change reaches. */
export function describeBlastRadius(call: ToolCall): BlastRadius {
  const path = pathOf(call);
  if (call.tool.name === "run_command") {
    const argv = argvOf(call);
    return { kind: "command", target: argv ? argv.join(" ") : String((call.input as { command?: unknown }).command ?? "?"), summary: "runs a program" };
  }
  if (path === null) return { kind: "other", target: call.tool.name, summary: "no path" };
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
  if (call.tool.name === "write_file") {
    return { kind: "write", target: path, summary: `replaces the whole file (${String((call.input as { content?: unknown }).content ?? "").length} chars)`, scope: dir };
  }
  if (call.tool.name === "edit_file") {
    return { kind: "edit", target: path, summary: "replaces one matched string (a reviewable diff)", scope: dir };
  }
  return { kind: "other", target: path, summary: call.tool.name };
}
