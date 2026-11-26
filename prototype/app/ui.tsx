import { useState, type ReactNode } from "react";
import type { Trace, TraceEvent } from "../engine/session";
import { toWireRequest } from "../engine/provider";
import { DEFAULT_SOURCES, SOLUTION_SOURCES, type BundleItem } from "../engine/bundles";
import { SIM_BOUNDARY } from "../sim/world";
import { SKILLS } from "../v2/extensions";

export type Sel = { kind: "item" | "event" | "wire" | "approval" | "skill" | "rule" | "span" | "audit"; id: string | number; version: 1 | 2 } | null;
export const fmt = (n: number) => n.toLocaleString("en-US");
export const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;
export const oneLine = (s: string, n = 140) => { const f = s.replace(/\s+/g, " ").trim(); return f.length <= n ? f : f.slice(0, n - 1) + "…"; };

const SIM_TOOLS = new Set(["actor_rules", "check_mod", "play", "start_toolbox", "toolbox_status"]);
export const isSimulated = (tool: string, input?: unknown) => SIM_TOOLS.has(tool) || (tool === "run_command" && /git|docker|openra|curl|python|env/.test(JSON.stringify(input ?? "")));

export function Pill({ children, tone = "slate", onClick, title }: { children: ReactNode; tone?: string; onClick?: () => void; title?: string }) {
  const tones: Record<string, string> = { slate: "bg-slate-700 text-slate-200", green: "bg-emerald-900/70 text-emerald-200", red: "bg-rose-900/70 text-rose-200", amber: "bg-amber-900/70 text-amber-200", blue: "bg-sky-900/70 text-sky-200", violet: "bg-violet-900/70 text-violet-200", orange: "bg-orange-900/70 text-orange-200" };
  return <span title={title} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-mono ${tones[tone] ?? tones.slate} ${onClick ? "cursor-pointer hover:brightness-125" : ""}`}>{children}</span>;
}
export const SimBadge = ({ k = "model" }: { k?: string }) => <Pill tone="amber" title={SIM_BOUNDARY[k]?.note ?? "simulated"}>simulated · §F</Pill>;

export function Code({ text, lang }: { text: string; lang?: string }) {
  const [open, setOpen] = useState(text.length < 1800);
  return (
    <div className="rounded border border-slate-700 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-0.5 text-[10px] text-slate-500"><span>{lang ?? "text"} · {text.length} chars</span><span className="space-x-2"><button onClick={() => navigator.clipboard?.writeText(text)} className="hover:text-slate-300">copy</button>{text.length >= 1800 && <button onClick={() => setOpen(!open)} className="hover:text-slate-300">{open ? "collapse" : "expand"}</button>}</span></div>
      <pre className={`overflow-auto p-2 text-[11px] leading-snug text-slate-200 ${open ? "max-h-[420px]" : "max-h-24"}`}>{text}</pre>
    </div>
  );
}
export const Json = ({ v }: { v: unknown }) => <Code text={JSON.stringify(v, null, 2)} lang="json" />;
export const H = ({ children }: { children: ReactNode }) => <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</div>;

export interface Desc { tag: string; tone: string; text: string }
export function describeEvent(e: Record<string, unknown>): Desc {
  const sub = e.agent && e.agent !== "main" ? `[${e.agent}] ` : "";
  switch (e.type) {
    case "turn_started": return { tag: "turn", tone: "blue", text: `run ${e.runId}: ${oneLine(String(e.userMessage), 120)}` };
    case "inference_requested": return { tag: "infer", tone: "slate", text: `${sub}#${e.iteration} ~ system ${e.systemTokens} + messages ${e.messageTokens} + tools ${e.toolTokens} tokens` };
    case "inference_completed": { const u = e.usage as Record<string, number>; return { tag: "usage", tone: "slate", text: `${sub}#${e.iteration} ${e.stopReason}: in ${u.inputTokens} (cache read ${u.cacheReadInputTokens}, write ${u.cacheCreationInputTokens}), out ${u.outputTokens}` }; }
    case "dynamic_section_emitted": return { tag: "section", tone: "violet", text: `${e.section} = ${oneLine(String(e.text), 110)}` };
    case "tool_call_proposed": return { tag: "tool", tone: "blue", text: `${sub}${e.toolName} ${oneLine(JSON.stringify(e.input), 130)}` };
    case "guardrail_decision": { const k = String(e.kind); return { tag: "guard", tone: k === "deny" || k === "abort" || k === "reject" ? "red" : k === "ask" ? "amber" : k === "allow" || k === "accept" || k === "proceed" || k === "allow_end" ? "slate" : "green", text: `${e.guardrail}.${e.hook} → ${oneLine(String(e.decision), 150)}${e.isDefault ? " (default)" : ""}` }; }
    case "approval_requested": return { tag: "approve", tone: String(e.decision).startsWith("Deny") ? "red" : "green", text: `${e.toolName}: ${oneLine(String(e.decision), 80)}${e.auto ? " (auto)" : ""} · scope ${e.scope}` };
    case "tool_call_completed": { const o = e.outcome as { kind: string; content?: string; message?: string }; return { tag: "result", tone: o.kind === "success" ? "green" : "red", text: `${sub}${e.toolName} ${o.kind === "success" ? "ok" : "error"} in ${e.durationMs} ms: ${oneLine(o.content ?? o.message ?? "", 140)}` }; }
    case "turn_ended": return { tag: "end", tone: "blue", text: String(e.reason) };
    case "warning": return { tag: "warn", tone: "orange", text: oneLine(String(e.message), 180) };
    case "log": return { tag: "log", tone: "slate", text: `${e.source}: ${oneLine(String(e.message), 160)}` };
    default: return { tag: String(e.type), tone: "slate", text: "" };
  }
}
export const isMain = (x: TraceEvent) => (x.e.agent ?? "main") === "main";

// ---- source lookup for the inspector -------------------------------------------------------------------------------
const pascal = (s: string) => s.replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase());
export function otherLanguageSources(it: BundleItem): { lang: string; file: string; text: string }[] {
  const out: { lang: string; file: string; text: string }[] = [];
  if (it.part) for (const [k, v] of Object.entries(SOLUTION_SOURCES)) { const m = k.match(/solutions\/([^/]+)\/(kotlin|java)\/(.+)$/); if (m && m[1] === it.part && !m[3].startsWith("_")) out.push({ lang: m[2], file: m[3], text: v }); }
  else if (it.origin === "default") {
    const base = pascal(it.file.split("/").pop() ?? "").toLowerCase();
    for (const [k, v] of Object.entries(DEFAULT_SOURCES)) { const m = k.match(/defaults\/(kotlin|java)\/.*\/([A-Za-z]+)\.(kt|java)$/); if (m && (m[2].toLowerCase() === base || m[2].toLowerCase() === base + "guardrail")) out.push({ lang: m[1], file: `${m[2]}.${m[3]}`, text: v }); }
  }
  return out;
}
const EVENT_TYPES = ["turn_started", "inference_requested", "inference_completed", "dynamic_section_emitted", "tool_call_proposed", "guardrail_decision", "approval_requested", "tool_call_completed", "turn_ended", "warning", "log"];
export const consumedEvents = (src: string) => EVENT_TYPES.filter((t) => src.includes(`"${t}"`) || src.includes(`'${t}'`));

// ---- the inspector -------------------------------------------------------------------------------------------------
export function Inspector({ sel, traces, onSel }: { sel: Sel; traces: Record<number, Trace | null>; onSel: (s: Sel) => void }) {
  const [lang, setLang] = useState("typescript");
  if (!sel) return <div className="p-3 text-xs text-slate-500">Click anything — a section, tool, guardrail, listener, event, message, skill, rule, approval or span — to see its real implementation, its wiring and the wire JSON.</div>;
  const t = traces[sel.version];
  if (!t) return <div className="p-3 text-xs text-slate-500">No trace for v{sel.version}.</div>;
  const ev = (i: number) => t.events[i]?.e as Record<string, unknown>;
  const head = (title: string, extra?: ReactNode) => <div className="flex items-center gap-2 border-b border-slate-700 pb-2"><span className="text-sm font-semibold text-slate-100">{title}</span><Pill tone={sel.version === 2 ? "violet" : "blue"}>v{sel.version}</Pill>{extra}<button className="ml-auto text-xs text-slate-500 hover:text-slate-200" onClick={() => onSel(null)}>close ✕</button></div>;

  if (sel.kind === "event") { const e = ev(Number(sel.id)); const d = describeEvent(e); return <div className="p-3">{head(`event #${sel.id}`, <Pill tone={d.tone}>{d.tag}</Pill>)}<div className="mt-2 text-xs text-slate-300">{d.text}</div><H>raw event (AgentEvent, TS wire shape)</H><Json v={e} /></div>; }
  if (sel.kind === "wire") {
    const r = t.requests[Number(sel.id)];
    return <div className="p-3">{head(`request #${Number(sel.id) + 1} — exact wire JSON`)}<div className="mt-2 text-[11px] text-slate-400">OpenAI-compatible chat/completions body as OpenAiModelClient.toMessages builds it (system first; each tool result its own `tool` message). The SYSTEM text is frozen: it is identical in every request of the session.</div><Json v={toWireRequest(r)} /></div>;
  }
  if (sel.kind === "approval") {
    const a = t.approvals[Number(sel.id)];
    return <div className="p-3">{head(`approval #${a.n + 1}: ${a.tool}`)}<H>why the human was asked</H><ul className="list-disc pl-5 text-xs text-amber-200">{a.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul><div className="mt-1 text-xs">asked by: {a.guardrails.map((g) => <Pill key={g} tone="amber" onClick={() => onSel({ kind: "item", id: `guardrail:${g}`, version: sel.version })}>{g}</Pill>)}</div><div className="mt-1 text-xs">decision: <Pill tone={a.decision.startsWith("deny") ? "red" : "green"}>{a.decision}</Pill> · scope key (what “approve always” would cover): <code className="text-sky-300">{a.scope}</code></div>{a.blast ? <><H>blast radius (v2)</H><div className="text-xs text-slate-300">{a.blast.summary} · risk <Pill tone={a.blast.risk === "low" ? "green" : "amber"}>{a.blast.risk}</Pill> · network {String(a.blast.network)}</div><div className="text-xs text-slate-400">undo: {a.blast.reversible}</div>{a.blast.diff && <Code text={a.blast.diff} lang="diff" />}</> : <div className="mt-2 text-[11px] text-slate-500">v1's prompt shows only the tool name, reasons and raw input (ConsoleApprovalHandler.kt) — no diff, no blast radius; “always” is scoped by tool name.</div>}<H>tool input</H><Json v={a.input} /></div>;
  }
  if (sel.kind === "skill") { const s = SKILLS.find((x) => x.name === sel.id)!; return <div className="p-3">{head(`skill: ${s.name}`, <Pill tone="violet">v2</Pill>)}<div className="mt-2 text-xs text-slate-300">{s.description}</div><div className="mt-1 text-[11px] text-slate-400">catalog cost (every call): ~{Math.ceil((s.name.length + s.description.length + 4) / 4)} tokens · body (only after load_skill): ~{Math.ceil(s.body.length / 4)} tokens · triggers: {s.triggers.join(", ")}</div><Code text={s.body} lang="markdown" /></div>; }
  if (sel.kind === "rule") {
    const rules = t.bundle.policy?.files.flatMap((f) => f.rules.map((r) => ({ ...r, layer: f.layer }))) ?? [];
    const r = rules.find((x) => x.id === sel.id);
    const fired = Object.entries(t.verdicts).filter(([, v]) => v.ruleId === sel.id);
    return <div className="p-3">{head(`rule ${sel.id}`, <Pill tone="violet">policy as data</Pill>)}{r ? <><Json v={r} /><H>fired in this run</H>{fired.length ? fired.map(([id, v]) => <div key={id} className="text-xs text-slate-300">{id}: <Pill tone={v.effect === "deny" ? "red" : v.effect === "ask" ? "amber" : "green"}>{v.effect}</Pill> considered {v.considered.map((c) => `${c.ruleId}:${c.effect}`).join(", ")}</div>) : <div className="text-xs text-slate-500">did not fire</div>}</> : <div className="text-xs text-slate-500">default rule / no rule</div>}</div>;
  }
  if (sel.kind === "span") { const s = t.spans.find((x) => x.id === sel.id)!; return <div className="p-3">{head(`span ${s.name}`)}<div className="text-xs text-slate-400">{s.kind} · {s.start}–{s.end} ms (virtual) · parent {s.parent ?? "—"}</div><Json v={s.attrs} /><div className="mt-1 text-[11px] text-slate-500">Attribute names follow the OpenTelemetry GenAI semantic conventions (gen_ai.operation.name, gen_ai.usage.*, gen_ai.tool.*); `harness.*` are ours.</div></div>; }
  if (sel.kind === "audit") { const a = t.audit[Number(sel.id)]; return <div className="p-3">{head(`audit entry #${a.n}`)}<Json v={a} /></div>; }

  // item: section / tool / guardrail / listener
  const [kind, name] = String(sel.id).split(":");
  const it = t.bundle.items.find((i) => i.kind === kind && i.name === name);
  if (!it) return <div className="p-3 text-xs text-slate-500">not in this bundle: {String(sel.id)}</div>;
  const others = otherLanguageSources(it);
  const idx = t.bundle.items.filter((i) => i.kind === kind).findIndex((i) => i.name === name);
  const srcTabs = [{ lang: "typescript", file: `${it.file}.ts`, text: it.source }, ...others];
  const cur = srcTabs.find((x) => x.lang === lang) ?? srcTabs[0];
  return (
    <div className="p-3">
      {head(`${it.kind}: ${it.name}`, <><Pill tone={it.origin === "v2" ? "violet" : it.origin === "exercise" ? "green" : "slate"}>{it.origin}{it.part ? ` ${it.part}` : ""}</Pill>{it.sectionKind && <Pill>{it.sectionKind}</Pill>}</>)}
      <div className="mt-2 text-[11px] text-slate-400">wiring: position <b>#{idx + 1}</b> of {t.bundle.items.filter((i) => i.kind === kind).length} {kind}s · registered by: {it.why}</div>

      {it.kind === "section" && (() => {
        const s = it.value as { kind: string; text?: string };
        const emitted = t.events.filter((x) => x.e.type === "dynamic_section_emitted" && x.e.section === it.name);
        return <><H>text it currently emits</H>{s.kind === "static" ? <><Code text={s.text ?? ""} lang="static section text" /><div className="text-[11px] text-slate-500">~{Math.ceil((s.text ?? "").length / 4)} tokens on every call (chars/4). In the system prompt: frozen for the session.</div></> : emitted.length ? emitted.map((x) => <div key={x.i} className="mb-1"><div className="text-[11px] text-slate-500">emitted at event #{x.i}</div><Code text={String(x.e.text)} lang="dynamic emission" /></div>) : <div className="text-xs text-slate-500">dynamic: rendered before every inference; returned null in this run, so nothing was added to the conversation (and nothing was paid).</div>}</>;
      })()}
      {it.kind === "tool" && (() => {
        const tool = it.value as { description: string; inputSchema: unknown };
        const calls = t.events.filter((x) => x.e.type === "tool_call_proposed" && x.e.toolName === it.name);
        return <><H>description the model reads (it is the API doc)</H><Code text={tool.description} /><H>inputSchema</H><Json v={tool.inputSchema} /><H>calls in this run ({calls.length})</H>{calls.map((c) => { const done = t.events.find((x) => x.i > c.i && x.e.type === "tool_call_completed" && x.e.toolUseId === c.e.toolUseId); return <div key={c.i} className="mb-2 rounded border border-slate-800 p-1"><div className="text-[11px] text-slate-500">call #{c.i} {isSimulated(it.name, c.e.input) && <SimBadge k="docker" />}</div><Json v={{ call: { id: c.e.toolUseId, name: c.e.toolName, input: c.e.input }, result: done ? done.e.outcome : "(never executed: denied or asked-and-declined)" }} /></div>; })}</>;
      })()}
      {it.kind === "guardrail" && (() => {
        const decs = t.events.filter((x) => x.e.type === "guardrail_decision" && x.e.guardrail === it.name);
        const hooks = it.hooks!;
        return <><H>hooks — implemented vs defaulted</H><table className="text-xs"><tbody>{(Object.keys(hooks) as (keyof typeof hooks)[]).map((h) => <tr key={h}><td className="pr-3 font-mono text-slate-300">{h}</td><td>{hooks[h] ? <Pill tone="green">implemented</Pill> : <Pill>default (Proceed/Allow/Accept/AllowEnd)</Pill>}</td></tr>)}</tbody></table>
          <H>verdicts in this run ({decs.length}, defaults hidden)</H>
          {decs.filter((x) => !x.e.isDefault).map((x) => {
            const siblings = t.events.filter((y) => y.e.type === "guardrail_decision" && y.e.toolUseId === x.e.toolUseId && y.e.hook === x.e.hook && x.e.toolUseId);
            const firstDeny = siblings.find((y) => y.e.kind === "deny");
            const why = x.e.kind === "deny" ? (firstDeny === x ? `won: first Deny in registration order (guardrail #${t.bundle.guardrails.findIndex((g) => g.name === it.name) + 1} of ${t.bundle.guardrails.length}) — later guardrails never ran for this call` : "lost: an earlier guardrail already denied") : x.e.kind === "ask" ? (firstDeny ? "overridden: a Deny elsewhere wins over Asks — no prompt shown" : "collected: Asks from all guardrails are merged into ONE prompt") : x.e.kind === "replace" ? "Replace chains: later guardrails see this rewritten result" : x.e.kind === "reject" ? "first Reject wins" : "";
            return <div key={x.i} className="mb-1 cursor-pointer rounded border border-slate-800 p-1 hover:border-slate-600" onClick={() => onSel({ kind: "event", id: x.i, version: sel.version })}><div className="text-xs"><Pill tone={describeEvent(x.e).tone}>{String(x.e.hook)}</Pill> {String(x.e.decision).slice(0, 220)}</div><div className="text-[11px] text-slate-500">event #{x.i} · {why}{x.e.failedClosed ? " · FAILED CLOSED" : ""}</div></div>;
          })}</>;
      })()}
      {it.kind === "listener" && (() => {
        const lines = t.printed.filter((p) => p.listener === it.name);
        return <><H>AgentEvent types consumed (from its source)</H><div className="flex flex-wrap gap-1">{consumedEvents(it.source).map((e) => <Pill key={e} tone="blue">{e}</Pill>)}</div><H>lines it printed ({lines.length})</H><Code text={lines.map((l) => `@event #${l.i}  ${l.line.replace("\u0007", "🔔 BEL")}`).join("\n") || "(nothing)"} lang="stdout" /></>;
      })()}

      <H>real implementation</H>
      <div className="mb-1 flex gap-1">{srcTabs.map((s) => <button key={s.lang} onClick={() => setLang(s.lang)} className={`rounded px-2 py-0.5 text-[11px] ${cur.lang === s.lang ? "bg-sky-800 text-white" : "bg-slate-800 text-slate-400"}`}>{s.lang}{s.lang === "typescript" ? " (executed)" : " (reference, unverified)"}</button>)}</div>
      <div className="text-[11px] text-slate-500">{cur.file} — {it.origin === "exercise" ? `attributed to part ${it.part}, workshop.html#solution` : it.origin === "default" ? "mirrored from extensions/" : "prototype v2 module"}</div>
      <Code text={cur.text || "(source not found)"} lang={cur.lang} />
    </div>
  );
}
