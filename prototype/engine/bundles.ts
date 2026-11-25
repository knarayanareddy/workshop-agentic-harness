// The single place that composes the agent — the mirror of Main.kt / index.ts: "nothing registers itself".
// v1 assembly = extensions/typescript/src/index.ts + the worksheet's registration steps, executing the REAL defaults and the
// REAL reference solutions (data/ts/src, extracted from workshop.html). v2 assembly = v1 + the v2 layer.
import "../sim/shellGlobal"; // must run before "@harness/api" is evaluated
import type { AgentEventListener, AssemblyContext, Guardrail, SystemPromptSection, Tool } from "@harness/api";
import type { Workspace } from "@harness/api";
import type { Plan } from "./mock";
import type { SimEnv } from "./agent";
import type { PermissionMode } from "../contract/v2/harness-v2";
import { compaction, delegateTool, loadSkillTool, openRaCheckoutPinned, provenanceSection, skillsCatalogSection, upstreamAck, upstreamPolicySection, type DelegateDeps } from "../v2/extensions";
import { legacyView, parsePolicy, policyGuardrail, runCommandArgv, type PolicyState } from "../v2/policy";
import type { AgentEvent } from "@harness/api";

const MODS = import.meta.glob("../data/ts/src/**/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;
export const TS_SOURCES = import.meta.glob("../data/ts/src/**/*.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
export const SOLUTION_SOURCES = import.meta.glob("../data/solutions/*/*/*", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
export const DEFAULT_SOURCES = import.meta.glob("../data/defaults/**/*.{kt,java}", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
export const V2_SOURCES = import.meta.glob("../v2/*.ts", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
export const POLICY_SOURCES = import.meta.glob("../policy/*.json", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

const mod = (file: string) => MODS[`../data/ts/src/${file}.ts`] ?? (() => { throw new Error(`missing module ${file}`); })();
export const srcOf = (file: string): string => TS_SOURCES[`../data/ts/src/${file}.ts`] ?? "";

export type ItemKind = "section" | "tool" | "guardrail" | "listener";
export interface BundleItem {
  kind: ItemKind; name: string; origin: "default" | "exercise" | "v2"; part?: string; file: string; source: string; why: string;
  /** guardrails: which hooks the object implements */
  hooks?: Record<"beforeInference" | "beforeToolUse" | "afterToolUse" | "beforeEndTurn", boolean>;
  sectionKind?: "static" | "dynamic"; value: unknown;
}
export interface Bundle {
  sections: SystemPromptSection[]; tools: Tool[]; guardrails: Guardrail[]; listeners: { name: string; fn: AgentEventListener }[];
  items: BundleItem[]; policy?: PolicyState; registration: string[];
}

interface Artefact { part: string; kind: ItemKind; file: string; name: string; call?: "ctx" | "workspace" | "factory"; many?: boolean; label: string }
export const ARTEFACTS: Artefact[] = [
  { part: "1.1", kind: "section", file: "systemprompt/exercise/environment", name: "environment", call: "ctx", label: "environment" },
  { part: "1.2", kind: "section", file: "systemprompt/exercise/openRaCheckout", name: "openRaCheckout", label: "openra_checkout" },
  { part: "1.3", kind: "section", file: "systemprompt/exercise/projectInstructions", name: "projectInstructions", call: "workspace", many: true, label: "project_instructions" },
  { part: "1.4", kind: "section", file: "systemprompt/exercise/openRaState", name: "openRaState", call: "ctx", many: true, label: "openra_state" },
  { part: "2.1", kind: "section", file: "systemprompt/exercise/openRaRules", name: "openRaRules", label: "openra_rules" },
  { part: "2.2", kind: "section", file: "systemprompt/exercise/answerStyle", name: "answerStyle", label: "answer_style" },
  { part: "2.3", kind: "section", file: "systemprompt/exercise/mission", name: "mission", label: "mission" },
  { part: "2.4", kind: "section", file: "systemprompt/exercise/groundRules", name: "groundRules", label: "ground_rules" },
  { part: "3.1", kind: "tool", file: "tools/exercise/startToolbox", name: "startToolbox", label: "start_toolbox" },
  { part: "3.1", kind: "tool", file: "tools/exercise/toolboxStatus", name: "toolboxStatus", label: "toolbox_status" },
  { part: "3.2", kind: "tool", file: "tools/exercise/play", name: "play", label: "play" },
  { part: "3.3", kind: "tool", file: "tools/exercise/actorRules", name: "actorRules", label: "actor_rules" },
  { part: "3.4", kind: "tool", file: "tools/exercise/findActor", name: "findActor", label: "find_actor" },
  { part: "3.5", kind: "tool", file: "tools/exercise/setActorValue", name: "setActorValue", label: "set_actor_value" },
  { part: "3.6", kind: "tool", file: "tools/exercise/checkMod", name: "checkMod", label: "check_mod" },
  { part: "4.1", kind: "guardrail", file: "guardrails/exercise/noPush", name: "noPush", label: "no-push" },
  { part: "4.2", kind: "guardrail", file: "guardrails/exercise/noPython", name: "noPython", label: "no-python" },
  { part: "4.3", kind: "guardrail", file: "guardrails/exercise/promptInjection", name: "promptInjection", label: "prompt-injection" },
  { part: "4.4", kind: "guardrail", file: "guardrails/exercise/secretScan", name: "secretScan", label: "secret-scan" },
  { part: "4.5", kind: "guardrail", file: "guardrails/exercise/pipeToShell", name: "pipeToShell", label: "pipe-to-shell" },
  { part: "4.6", kind: "guardrail", file: "guardrails/exercise/workspaceOnly", name: "workspaceOnly", label: "workspace-only" },
  { part: "5.1", kind: "listener", file: "listeners/exercise/costMeter", name: "costMeter", call: "factory", label: "cost-meter" },
  { part: "5.2", kind: "listener", file: "listeners/exercise/bell", name: "bell", call: "factory", label: "bell" },
  { part: "5.3", kind: "listener", file: "listeners/exercise/turnSummary", name: "turnSummary", call: "factory", label: "turn-summary" },
];
export const ARTEFACT_PARTS = [...new Set(ARTEFACTS.map((a) => a.part))];
const DEFAULT_TOOL_FILES: Record<string, string> = { read_file: "readFile", write_file: "writeFile", edit_file: "editFile", list_files: "listFiles", glob: "glob", grep: "grep", run_command: "runCommand", file_stats: "fileStats" };
const DEFAULT_GUARD_FILES: Record<string, string> = { "protected-paths": "protectedPaths", command: "command", "build-file": "buildFile", "result-cap": "resultCap" };
const DEFAULT_SECTION_FILES: Record<string, string> = { role: "role", working_agreements: "workingAgreements", iteration_budget: "iterationBudget" };

const hooksOf = (g: Guardrail) => ({ beforeInference: !!g.beforeInference, beforeToolUse: !!g.beforeToolUse, afterToolUse: !!g.afterToolUse, beforeEndTurn: !!g.beforeEndTurn });

export interface V2Options {
  policy: boolean; argv: boolean; skills: boolean; delegate: boolean; compaction: boolean; provenance: boolean; scopedApprovals: boolean;
  mode: PermissionMode; policyLayers: Record<string, string>; compactionThreshold: number;
}
export const V2_ALL: Omit<V2Options, "policyLayers" | "mode"> = { policy: true, argv: true, skills: true, delegate: true, compaction: true, provenance: true, scopedApprovals: true, compactionThreshold: 3500 };
export interface AssembleInput { enabled: string[]; ws: Workspace; env: SimEnv; v2?: V2Options; delegate?: Omit<DelegateDeps, "tools" | "guardrails" | "env" | "ws"> }

export function assemble(inp: AssembleInput): Bundle {
  const on = new Set(inp.enabled);
  const ctx: AssemblyContext = { workspace: inp.ws, exec: (c) => inp.env.exec(c) };
  const items: BundleItem[] = [];
  const registration: string[] = [];
  const art = (part: string) => ARTEFACTS.filter((a) => a.part === part);
  const call = (a: Artefact) => {
    const v = mod(a.file)[a.name] as never;
    if (a.call === "ctx") return (v as (c: AssemblyContext) => unknown)(ctx);
    if (a.call === "workspace") return (v as (w: Workspace) => unknown)(inp.ws);
    if (a.call === "factory") return (v as () => unknown)();
    return v;
  };
  const push = (kind: ItemKind, value: { name: string }, origin: BundleItem["origin"], file: string, why: string, part?: string, extra: Partial<BundleItem> = {}) =>
    items.push({ kind, name: value.name, origin, part, file, source: srcOf(file), why, value, ...extra });

  // ---- system prompt: defaults (index.ts) + registration steps from the worksheet -------------------------------
  const sectionsMod = mod("systemprompt/defaults/index") as { defaultSections: (w: Workspace) => SystemPromptSection[] };
  let defaults = sectionsMod.defaultSections(inp.ws);
  if (on.has("1.2")) {
    // worksheet 1.2 step 3: "Delete the OpenRA line from workingAgreements.ts" — done here as a data edit of the default's text.
    defaults = defaults.map((s) => (s.kind === "static" && s.name === "working_agreements" ? { ...s, text: s.text.split("\n").filter((l) => !l.includes("OpenRA/ is not checked out")).join("\n") } : s));
    registration.push("1.2: removed the 'OpenRA/ is not checked out' line from working_agreements (worksheet step 3)");
  }
  let sections: SystemPromptSection[] = defaults;
  if (on.has("2.3")) { sections = sections.filter((s) => s.name !== "role"); registration.push("2.3: role removed from defaultSections; mission registered first"); }
  if (on.has("2.4")) { sections = sections.map((s) => (s.name === "working_agreements" ? (call(art("2.4")[0]) as SystemPromptSection) : s)); registration.push("2.4: working_agreements replaced by ground_rules"); }
  const extraSections: { s: SystemPromptSection; part: string; file: string }[] = [];
  for (const part of ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2"]) {
    if (!on.has(part)) continue;
    const a = art(part)[0];
    const v = call(a) as SystemPromptSection | SystemPromptSection[];
    for (const s of Array.isArray(v) ? v : [v]) extraSections.push({ s, part, file: a.file });
  }
  const mission = on.has("2.3") ? (call(art("2.3")[0]) as SystemPromptSection) : null;
  sections = [...(mission ? [mission] : []), ...sections, ...extraSections.map((x) => x.s)];
  for (const s of sections) {
    const x = extraSections.find((e) => e.s === s);
    if (x) push("section", s, "exercise", x.file, `part ${x.part}`, x.part, { sectionKind: s.kind, value: s });
    else if (s === mission) push("section", s, "exercise", art("2.3")[0].file, "part 2.3", "2.3", { sectionKind: s.kind, value: s });
    else if (s.name === "ground_rules" && on.has("2.4")) push("section", s, "exercise", art("2.4")[0].file, "part 2.4", "2.4", { sectionKind: s.kind, value: s });
    else push("section", s, "default", `systemprompt/defaults/${DEFAULT_SECTION_FILES[s.name] ?? "index"}`, "defaultSections()", undefined, { sectionKind: s.kind, value: s });
  }

  // ---- tools ------------------------------------------------------------------------------------------------------
  let tools: Tool[] = [...((mod("tools/defaults/index") as { defaultTools: Tool[] }).defaultTools)];
  const toolOrigin = new Map<Tool, { part?: string; file: string; origin: BundleItem["origin"] }>();
  tools.forEach((t) => toolOrigin.set(t, { file: `tools/defaults/${DEFAULT_TOOL_FILES[t.name]}`, origin: "default" }));
  for (const part of ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6"]) if (on.has(part)) for (const a of art(part)) { const t = call(a) as Tool; tools.push(t); toolOrigin.set(t, { part, file: a.file, origin: "exercise" }); }

  // ---- guardrails: defaults [protected-paths, command, build-file, result-cap] + registration order from the worksheet ------
  const dg = (mod("guardrails/defaults/index") as { defaultGuardrails: Guardrail[] }).defaultGuardrails;
  const byName = (n: string) => dg.find((g) => g.name === n)!;
  const ex = (part: string) => call(art(part)[0]) as Guardrail;
  const guardOrigin = new Map<Guardrail, { part?: string; file: string; origin: BundleItem["origin"] }>();
  const mk = (g: Guardrail, part: string) => { guardOrigin.set(g, { part, file: art(part)[0].file, origin: "exercise" }); return g; };
  let guardrails: Guardrail[] = [
    ...(on.has("4.3") ? [mk(ex("4.3"), "4.3")] : []),
    byName("protected-paths"), byName("command"), byName("build-file"),
    ...(on.has("4.4") ? [mk(ex("4.4"), "4.4")] : []),
    byName("result-cap"),
    ...(on.has("4.1") ? [mk(ex("4.1"), "4.1")] : []), ...(on.has("4.2") ? [mk(ex("4.2"), "4.2")] : []),
    ...(on.has("4.5") ? [mk(ex("4.5"), "4.5")] : []), ...(on.has("4.6") ? [mk(ex("4.6"), "4.6")] : []),
  ];
  dg.forEach((g) => guardOrigin.set(g, { file: `guardrails/defaults/${DEFAULT_GUARD_FILES[g.name]}`, origin: "default" }));

  // ---- listeners ---------------------------------------------------------------------------------------------------
  const listeners: Bundle["listeners"] = [{ name: "console-trace", fn: (mod("listeners/defaults/consoleTrace") as { consoleTrace: () => AgentEventListener }).consoleTrace() }];
  const listenerItems: BundleItem[] = [{ kind: "listener", name: "console-trace", origin: "default", file: "listeners/defaults/consoleTrace", source: srcOf("listeners/defaults/consoleTrace"), why: "default listener", value: listeners[0].fn }];
  for (const part of ["5.1", "5.2", "5.3"]) if (on.has(part)) { const a = art(part)[0]; const fn = call(a) as AgentEventListener; listeners.push({ name: a.label, fn }); listenerItems.push({ kind: "listener", name: a.label, origin: "exercise", part, file: a.file, source: srcOf(a.file), why: `part ${part}`, value: fn }); }

  // ================= v2 layer =====================================================================================
  let policy: PolicyState | undefined;
  const v2 = inp.v2;
  const v2items: BundleItem[] = [];
  if (v2) {
    registration.push("v2 layer: assembled after the v1 bundle; nothing registers itself");
    // sections
    const pre: SystemPromptSection[] = [];
    if (v2.provenance) {
      sections = sections.map((s) => (s.name === "openra_checkout" ? openRaCheckoutPinned() : s));
      const idx = sections.findIndex((s) => s.name !== "mission" && s.name !== "role");
      pre.push(upstreamPolicySection);
      sections = [...sections.slice(0, idx < 0 ? sections.length : idx), upstreamPolicySection, ...sections.slice(idx < 0 ? sections.length : idx)];
      if (!sections.some((s) => s.name === "openra_checkout")) sections.push(openRaCheckoutPinned());
      sections.push(provenanceSection(inp.env));
    }
    if (v2.skills) sections.splice(sections.findIndex((s) => s.kind === "dynamic") < 0 ? sections.length : sections.findIndex((s) => s.kind === "dynamic"), 0, skillsCatalogSection());
    // tools
    if (v2.argv) tools = tools.map((t) => (t.name === "run_command" ? runCommandArgv : t));
    if (v2.skills) tools.push(loadSkillTool());
    // guardrails
    if (v2.argv) guardrails = guardrails.map((g) => { const l = legacyView(g); const o = guardOrigin.get(g); if (o) guardOrigin.set(l, o); return l; });
    if (v2.policy) guardrails = guardrails.filter((g) => g.name !== "command"); // superseded by allow-list rules (kept in v1 mode)
    const front: Guardrail[] = [];
    if (v2.compaction) front.push(compaction({ thresholdTokens: v2.compactionThreshold, keepLast: 2 }));
    if (v2.policy) {
      const parsed = parsePolicy(v2.policyLayers);
      policy = { files: parsed.files, mode: v2.mode, verdicts: new Map() };
      if (parsed.errors.length) registration.push("policy parse errors (fail closed → default deny): " + parsed.errors.join("; "));
      front.push(policyGuardrail(policy));
    }
    if (v2.provenance) front.push(upstreamAck());
    guardrails = [...front, ...guardrails];
    for (const g of front) guardOrigin.set(g, { file: g.name === "policy" ? "policy" : g.name === "compaction" ? "extensions" : "extensions", origin: "v2" });
    if (v2.delegate && inp.delegate) {
      const parentTools = tools.filter((t) => t.name !== "delegate");
      const d = delegateTool({ ...inp.delegate, tools: parentTools, guardrails: guardrails.filter((g) => ["protected-paths", "policy"].includes(g.name) || g.name === "upstream-ack").map((g) => (g.name === "upstream-ack" ? { name: "noop" } : g)), env: inp.env, ws: inp.ws });
      tools.push(d);
      toolOrigin.set(d, { file: "extensions", origin: "v2" });
    }
    for (const t of tools) if (["load_skill", "delegate"].includes(t.name) || (t.name === "run_command" && v2.argv)) toolOrigin.set(t, { file: t.name === "run_command" ? "policy" : "extensions", origin: "v2" });
  }

  // ---- items in bundle order ----------------------------------------------------------------------------------------
  const finalItems: BundleItem[] = [];
  for (const s of sections) {
    const existing = items.find((i) => i.kind === "section" && i.value === s);
    if (existing) finalItems.push(existing);
    else {
      const f = s.name === "upstream_policy" ? "extensions" : s.name === "skills_catalog" ? "extensions" : "extensions";
      finalItems.push({ kind: "section", name: s.name, origin: "v2", file: f, source: V2_SOURCES[`../v2/${f}.ts`] ?? "", why: "v2 layer", sectionKind: s.kind, value: s });
    }
  }
  for (const t of tools) { const o = toolOrigin.get(t)!; finalItems.push({ kind: "tool", name: t.name, origin: o.origin, part: o.part, file: o.file, source: o.origin === "v2" ? V2_SOURCES[`../v2/${o.file}.ts`] ?? "" : srcOf(o.file), why: o.origin === "v2" ? "v2 layer" : o.origin === "exercise" ? `part ${o.part}` : "defaultTools", value: t }); }
  for (const g of guardrails) {
    const o = guardOrigin.get(g) ?? { file: "extensions", origin: "v2" as const };
    finalItems.push({ kind: "guardrail", name: g.name, origin: o.origin, part: o.part, file: o.file, source: o.origin === "v2" ? V2_SOURCES[`../v2/${o.file}.ts`] ?? "" : srcOf(o.file), why: o.origin === "v2" ? "v2 layer" : o.origin === "exercise" ? `part ${o.part}` : "defaultGuardrails", hooks: hooksOf(g), value: g });
  }
  finalItems.push(...listenerItems, ...v2items);
  return { sections, tools, guardrails, listeners, items: finalItems, policy, registration };
}

export function dynamicSectionNames(b: Bundle): string[] { return b.sections.filter((s) => s.kind === "dynamic").map((s) => s.name); }
export const plansType = null as unknown as Record<string, Plan>;
export type { AgentEvent };
