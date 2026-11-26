// v2: policy as data + a structural (argv) capability boundary for shell + approval detail. All of this is v2-only.
// Reuses v1 code as-is: globToRegExp comes from the shipped defaults (workspaceFiles.ts).
import type { Guardrail, Tool, ToolCall, ToolDecision, Workspace } from "@harness/api";
import { globToRegExp } from "../data/ts/src/tools/defaults/workspaceFiles";
import type { BlastRadius, Effect, PermissionMode, PolicyFile, PolicyRule, PolicyVerdict } from "../contract/v2/harness-v2";
import { lineDiff } from "../sim/world";
import BASE from "../policy/00-workshop.json?raw";
import PROJECT from "../policy/10-project.json?raw";

export const POLICY_LAYERS_RAW = { "00-workshop": BASE, "10-project": PROJECT };
export const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_files", "glob", "grep"]);

export function parsePolicy(layers: Record<string, string>): { files: PolicyFile[]; errors: string[] } {
  const files: PolicyFile[] = [];
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(layers).sort(([a], [b]) => a.localeCompare(b))) {
    try {
      const f = JSON.parse(raw) as PolicyFile;
      for (const r of f.rules ?? []) for (const k of ["id", "effect", "rationale", "owner"] as const) if (!r[k]) throw new Error(`rule ${r.id ?? "?"}: missing '${k}'`);
      files.push({ ...f, layer: f.layer ?? name });
    } catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  return { files, errors };
}

// ---- argv parsing (the thing a regex over a shell string cannot do) ------------------------------------------------
const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
export function gitSubcommand(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (GIT_GLOBAL_WITH_VALUE.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue; // --no-pager, -P, --git-dir=x …
    return a;
  }
  return null;
}
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase().replace(/\.exe$/, "");
export const programOf = (argv: string[]) => baseName(argv[0] ?? "");
const looksLikePath = (a: string) => !a.startsWith("-") && (a.startsWith("/") || a.includes("..") || a.includes("/"));
export function pathArgs(argv: string[]): string[] { return argv.slice(1).filter(looksLikePath); }
const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
export const shellJoin = (argv: string[]) => argv.map((a) => (/^[\w./:=@%+-]+$/.test(a) ? a : shq(a))).join(" ");

const globMatch = (patterns: string[] | undefined, path: string) => !!patterns?.some((p) => globToRegExp(p).test(path));
const relPath = (ws: Workspace, p: string): string | null => { try { return ws.relativize(ws.resolve(p)); } catch { return null; } };

export function argvOf(call: ToolCall): string[] | null {
  const a = call.input.argv;
  return call.tool.name === "run_command" && Array.isArray(a) && a.every((x) => typeof x === "string") ? (a as string[]) : null;
}

function matches(rule: PolicyRule, call: ToolCall, ws: Workspace, mode: PermissionMode): boolean {
  if (rule.modes && !rule.modes.includes(mode)) return false;
  if (rule.tool && !rule.tool.includes(call.tool.name) && !rule.tool.includes("*")) return false;
  if (rule.path || rule.path_not || rule.except_path) {
    const raw = call.input.path;
    if (typeof raw !== "string") return false;
    const rel = relPath(ws, raw);
    if (rel === null) return !!rule.path; // escapes the workspace: path rules treat it as a match (fail closed)
    if (rule.path && !globMatch(rule.path, rel)) return false;
    if (rule.path_not && globMatch(rule.path_not, rel)) return false;
    if (rule.except_path && globMatch(rule.except_path, rel)) return false;
  }
  if (rule.argv) {
    const argv = argvOf(call);
    if (!argv) return false;
    const prog = programOf(argv);
    if (rule.argv.program && !rule.argv.program.includes(prog)) return false;
    if (rule.argv.subcommand) {
      const sub = prog === "git" ? gitSubcommand(argv) : argv[1];
      if (!sub || !rule.argv.subcommand.includes(sub)) return false;
    }
    if (rule.argv.any_arg && !argv.slice(1).some((a) => new RegExp(rule.argv!.any_arg!).test(a))) return false;
    if (rule.argv.any_path_outside_workspace && !pathArgs(argv).some((a) => !ws.contains(a))) return false;
    if (rule.argv.paths_inside_workspace && pathArgs(argv).some((a) => !ws.contains(a))) return false;
  }
  return true;
}

export function evaluate(files: PolicyFile[], call: ToolCall, ws: Workspace, mode: PermissionMode): PolicyVerdict {
  const hits: { rule: PolicyRule; layer: string }[] = [];
  for (const f of files) for (const rule of f.rules) if (matches(rule, call, ws, mode)) hits.push({ rule, layer: f.layer });
  const considered = hits.map((h) => ({ ruleId: h.rule.id, effect: h.rule.effect }));
  const pick = (e: Effect) => hits.find((h) => h.rule.effect === e);
  const w = pick("deny") ?? pick("ask") ?? pick("allow");
  if (w) return { effect: w.rule.effect, ruleId: w.rule.id, layer: w.layer, owner: w.rule.owner, rationale: w.rule.rationale, suggest: w.rule.suggest, considered };
  const def = files.map((f) => f.defaults?.[call.tool.name]).filter(Boolean).pop() as Effect | undefined;
  if (def === "deny") {
    return { effect: "deny", ruleId: "default:" + call.tool.name, layer: null, owner: "workshop-staff", considered,
      rationale: `no rule allows this ${call.tool.name} call, and the default for ${call.tool.name} is deny (allow-list). Program '${programOf(argvOf(call) ?? []) || "?"}' is not on it`,
      suggest: "Use a dedicated tool (find_actor, actor_rules, check_mod …) or ask the user to run it." };
  }
  return { effect: def ?? "allow", ruleId: null, layer: null, owner: null, rationale: "no rule matched", considered };
}

export interface PolicyState { files: PolicyFile[]; mode: PermissionMode; verdicts: Map<string, PolicyVerdict> }
/** the data-driven guardrail: code that interprets data. Only beforeToolUse is implemented. */
export function policyGuardrail(state: PolicyState): Guardrail {
  return {
    name: "policy",
    beforeToolUse(call, ctx): ToolDecision {
      const v = evaluate(state.files, call, ctx.workspace, state.mode);
      state.verdicts.set(call.id, v);
      const tag = `[${v.ruleId ?? "no-rule"}|${v.owner ?? "-"}] ${v.rationale}${v.suggest ? ` || ${v.suggest}` : ""}`;
      if (v.effect === "deny") return { kind: "deny", reason: tag };
      if (v.effect === "ask") return { kind: "ask", reason: tag };
      return { kind: "allow" };
    },
  };
}

/** v2 denial text: rule id, owner, rationale and the sanctioned alternative — one extra sentence that saves a retry. */
export function denialText(guardrail: string, reason: string): string {
  const m = reason.match(/^\[([^|\]]+)\|([^\]]*)\] ([\s\S]*?)(?: \|\| ([\s\S]*))?$/);
  if (!m) return `Denied by guardrail '${guardrail}': ${reason}`;
  return `Denied by policy rule ${m[1]} (owner: ${m[2]}): ${m[3]}.${m[4] ? ` Instead: ${m[4]}` : ""}`;
}

/** v2: "approve always" is scoped by rule + what it covers, not by tool name (the v1 over-grant). */
export function approvalScope(call: ToolCall, reasons: string[]): string {
  const ids = [...new Set(reasons.map((r) => r.match(/^\[([^|\]]+)\|/)?.[1]).filter(Boolean) as string[])];
  if (ids.length === 1 && ids[0] === "G-upstream-ack") return "G-upstream-ack";
  const rule = ids.join("+") || "no-rule";
  const argv = argvOf(call);
  if (argv) return `${rule}:${programOf(argv)} ${programOf(argv) === "git" ? gitSubcommand(argv) ?? "" : argv[1] ?? ""}`.trim();
  const p = call.input.path;
  if (typeof p === "string") return `${rule}:${p.slice(0, p.lastIndexOf("/") + 1) || "./"}`;
  return `${rule}:${call.tool.name}`;
}

export function describeBlastRadius(call: ToolCall, ws: Workspace): BlastRadius {
  const argv = argvOf(call);
  if (argv) {
    const prog = programOf(argv);
    const sub = prog === "git" ? gitSubcommand(argv) : null;
    const mutating = prog === "git" && ["add", "commit", "checkout", "reset", "clone"].includes(sub ?? "");
    return {
      summary: `runs \`${shellJoin(argv)}\` as a literal argv (no shell, no expansion)`, risk: mutating ? "medium" : "low", network: sub === "clone",
      paths: pathArgs(argv).map((p) => ({ path: p, inWorkspace: ws.contains(p), change: mutating ? "modify" : "read", tracked: true })),
      reversible: mutating ? (sub === "commit" ? "local commit: `git reset --soft HEAD~1` undoes it" : "working tree changes: `git checkout -- .`") : "nothing changes",
    };
  }
  const p = call.input.path;
  if (typeof p === "string" && (call.tool.name === "write_file" || call.tool.name === "edit_file")) {
    const rel = relPath(ws, p) ?? p;
    const before = ws.exists(rel) ? ws.readText(rel) : "";
    let after = before;
    if (call.tool.name === "write_file") after = String(call.input.content ?? "");
    else { const parts = before.split(String(call.input.old_text ?? "\u0000")); after = parts.length === 2 || call.input.replace_all === true ? parts.join(String(call.input.new_text ?? "")) : before; }
    return {
      summary: `${ws.exists(rel) ? "modifies" : "creates"} ${rel} (${after.length - before.length >= 0 ? "+" : ""}${after.length - before.length} chars)`,
      risk: rel.startsWith("OpenRA/mods/") ? "low" : "medium", network: false,
      paths: [{ path: rel, inWorkspace: true, change: ws.exists(rel) ? "modify" : "create", tracked: rel.startsWith("OpenRA/") }],
      reversible: rel.startsWith("OpenRA/") ? "tracked by git: `git -C OpenRA checkout -- " + rel.replace("OpenRA/", "") + "` restores it" : "not tracked by git: no automatic undo",
      diff: lineDiff(before, after),
    };
  }
  return { summary: `calls ${call.tool.name}`, risk: "medium", network: false, paths: [], reversible: "unknown" };
}

// ---- the v2 run_command: argv, no shell ---------------------------------------------------------------------------
/** The runner is itself an allow-list (defence in depth): even with an empty policy it cannot start these. */
export const RUNNER_ALLOWLIST = new Set(["ls", "cat", "grep", "echo", "pwd", "uname", "date", "head", "wc", "git", "docker", "openra-check", "openra-rules"]);
export const runCommandArgv: Tool = {
  name: "run_command",
  description:
    "Run ONE program in the workspace root and return its exit code and combined output. Pass the program and its arguments as an `argv` array: " +
    "there is no shell, so pipes, redirects, globs, variables and `$(...)` are not interpreted and do nothing. Only allow-listed programs run; " +
    "everything else is denied by policy. Times out after 120 seconds; output is limited to the last 20000 characters.",
  inputSchema: { type: "object", properties: { argv: { type: "array", items: { type: "string" }, description: "The program followed by its arguments, e.g. [\"git\", \"status\"]" } }, required: ["argv"] },
  execute(input, ctx) {
    const argv = input.argv;
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== "string")) return { kind: "failure", message: "'argv' must be a non-empty array of strings" };
    const prog = programOf(argv as string[]);
    if (!RUNNER_ALLOWLIST.has(prog)) return { kind: "failure", message: `runner refused: '${prog}' is not in the runner's built-in allow-list (${[...RUNNER_ALLOWLIST].join(", ")})` };
    // SIM: the real runner would call execve(2) directly. The sim's exec takes a string, so each word is single-quoted and the
    // world is told to treat it literally (no globbing) with the marker below.
    const r = ctx.exec(`\u0001argv ${shellJoin(argv as string[])}`);
    const text = `exit code ${r.exitCode}\n${r.output}`;
    return r.timedOut ? { kind: "failure", message: `Timed out after 120 seconds.\n${r.output}` } : r.exitCode === 0 ? { kind: "success", content: text } : { kind: "failure", message: text };
  },
};

/** v1 code guardrails read `call.input.command`. In v2 the model sends argv; give legacy guardrails the joined string as a *view*. */
export function legacyView(g: Guardrail): Guardrail {
  const adapt = (call: ToolCall): ToolCall => {
    const argv = argvOf(call);
    return argv ? { ...call, input: { ...call.input, command: argv.join(" ") } } : call;
  };
  return {
    name: g.name,
    beforeInference: g.beforeInference?.bind(g),
    beforeToolUse: g.beforeToolUse ? (call, ctx) => g.beforeToolUse!(adapt(call), ctx) : undefined,
    afterToolUse: g.afterToolUse ? (call, r, ctx) => g.afterToolUse!(adapt(call), r, ctx) : undefined,
    beforeEndTurn: g.beforeEndTurn?.bind(g),
  };
}
