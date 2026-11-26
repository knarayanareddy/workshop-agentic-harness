import { useState } from "react";
import type { RunConfig, Trace } from "../engine/session";
import { defaultConfig, firstDivergence, runScenario, summary } from "../engine/session";
import { PRICE_PRESETS, TOKENIZER_TOLERANCE, type Prices } from "../engine/provider";
import { SCENARIOS } from "../scenarios";
import { SIM_BOUNDARY } from "../sim/world";
import { AuditLog, SKILLS, SUBAGENTS, PIN, verifyToolbox } from "../v2/extensions";
import DOCS from "../docs/PROTOTYPE.md?raw";
import { Code, fmt, H, isMain, Pill, usd, type Sel } from "./ui";

const EXAMPLE_RULE = { id: "P-protect-shaders", effect: "deny", owner: "you", tool: ["write_file", "edit_file"], path: ["OpenRA/glsl/**"], rationale: "shader edits can break the renderer and check_mod cannot see it", suggest: "Describe the visual change and let the user edit the shader." };

// ---- Assemble: the single place that composes the agent -----------------------------------------------------------------
export function AssembleView({ t, version, cfg, setCfg, onSel }: { t: Trace; version: 1 | 2; cfg: RunConfig; setCfg: (c: RunConfig) => void; onSel: (s: Sel) => void }) {
  const groups: [string, string][] = [["section", "1 · system prompt sections (static → system, dynamic → conversation)"], ["tool", "2 · tools"], ["guardrail", "3 · guardrails (registration order = evaluation order)"], ["listener", "4 · listeners"]];
  const v2 = cfg.v2;
  const set = (patch: Partial<RunConfig["v2"]>) => setCfg({ ...cfg, v2: { ...v2, ...patch } });
  const toggles: [keyof RunConfig["v2"], string][] = [["policy", "policy-as-data guardrail (replaces `command`)"], ["argv", "argv runner for run_command (no shell)"], ["skills", "skills catalog + load_skill"], ["delegate", "delegate tool (sub-agent)"], ["compaction", "compaction guardrail"], ["provenance", "provenance + pinned clone + upstream-ack"], ["scopedApprovals", "approve-always scoped by rule"]];
  const project = (() => { try { return JSON.parse(v2.projectPolicy); } catch { return null; } })();
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-slate-700 bg-slate-900 p-2 text-slate-300">This is the whole composition, in order — the browser mirror of <code>Main.kt</code> / <code>index.ts</code>: <b>nothing registers itself</b>. Enabled artefacts: {t.effectiveEnabled.length ? t.effectiveEnabled.map((p) => <Pill key={p} tone="green">{p}</Pill>) : "none (defaults only)"} {t.registration.map((r) => <div key={r} className="text-slate-500">· {r}</div>)}</div>
      {groups.map(([k, title]) => (
        <div key={k}><H>{title}</H>
          <div className="flex flex-wrap gap-1">{t.bundle.items.filter((i) => i.kind === k).map((i, n) => <span key={i.name + n} className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 hover:border-sky-500" onClick={() => onSel({ kind: "item", id: `${k}:${i.name}`, version })}><span className="text-slate-500">{n + 1}</span><span className="cursor-pointer font-mono text-slate-100">{i.name}</span><Pill tone={i.origin === "v2" ? "violet" : i.origin === "exercise" ? "green" : "slate"}>{i.origin === "exercise" ? `part ${i.part}` : i.origin}</Pill>{i.sectionKind && <Pill>{i.sectionKind}</Pill>}{i.hooks && <span className="text-[10px] text-slate-500">{(["beforeInference", "beforeToolUse", "afterToolUse", "beforeEndTurn"] as const).map((h) => (i.hooks![h] ? h[0] === "b" && h.startsWith("beforeI") ? "BI " : h.startsWith("beforeT") ? "BT " : h.startsWith("beforeE") ? "BE " : "AT " : "")).join("")}</span>}</span>)}</div>
        </div>
      ))}
      <div className="text-[11px] text-slate-500">hooks: BI beforeInference · BT beforeToolUse · AT afterToolUse · BE beforeEndTurn (only implemented hooks are shown).</div>
      {version === 2 && (
        <div className="space-y-2 rounded border border-violet-800 bg-violet-950/20 p-2">
          <H>v2 layer — switch features off to get back to “v1 mode” (the worksheet's teaching setup)</H>
          <div className="grid gap-1 md:grid-cols-2">{toggles.map(([k, label]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={Boolean(v2[k])} onChange={(e) => set({ [k]: e.target.checked } as Partial<RunConfig["v2"]>)} />{label}</label>)}</div>
          <div className="flex flex-wrap items-center gap-3">permission mode <select value={v2.mode} onChange={(e) => set({ mode: e.target.value as "default" | "plan" })} className="rounded bg-slate-800 px-1 py-0.5"><option value="default">default</option><option value="plan">plan (read-only)</option></select>
            compaction threshold (est. msg tokens) <input type="number" value={v2.compactionThreshold} onChange={(e) => set({ compactionThreshold: Number(e.target.value) })} className="w-20 rounded bg-slate-800 px-1 py-0.5" /></div>
          {t.bundle.policy && <><H>policy rules (data, layered) — click to inspect</H><div className="flex flex-wrap gap-1">{t.bundle.policy.files.flatMap((f) => f.rules.map((r) => <Pill key={r.id} tone={r.effect === "deny" ? "red" : r.effect === "ask" ? "amber" : "green"} onClick={() => onSel({ kind: "rule", id: r.id, version: 2 })} title={`${f.layer} · ${r.owner}`}>{r.id}</Pill>))}</div></>}
          <H>10-project.json — your layer (edited live, no rebuild)</H>
          <textarea value={v2.projectPolicy} onChange={(e) => set({ projectPolicy: e.target.value })} spellCheck={false} className="h-32 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200" />
          <div className="flex items-center gap-2"><button className="rounded bg-violet-700 px-2 py-1 text-white" onClick={() => { const base = project ?? { policy: "project-local", layer: "10-project", version: 1, owner: "you", rules: [] }; if (!base.rules.some((r: { id: string }) => r.id === EXAMPLE_RULE.id)) base.rules.push(EXAMPLE_RULE); set({ projectPolicy: JSON.stringify(base, null, 2) }); }}>add example rule P-protect-shaders</button>{!project && <Pill tone="red">invalid JSON → layer ignored; the base layer still applies (fail closed)</Pill>}</div>
          <H>skills (progressive disclosure)</H><div className="flex flex-wrap gap-1">{SKILLS.map((s) => <Pill key={s.name} tone="violet" onClick={() => onSel({ kind: "skill", id: s.name, version: 2 })}>{s.name}</Pill>)}</div>
          <H>sub-agents</H>{SUBAGENTS.map((s) => <div key={s.name} className="text-slate-300"><b>{s.name}</b>: {s.description} · ≤ {s.maxIterations} calls · {fmt(s.tokenBudget)} token budget · own context</div>)}
          <H>provenance (real checksums of the real toolbox files)</H>
          <div className="font-mono text-[10px] text-slate-400">pin {PIN.slice(0, 12)} (release history, 2026-10-20)</div>
          {verifyToolbox().map((x) => <div key={x.file} className="font-mono text-[10px]"><span className={x.ok ? "text-emerald-300" : "text-rose-300"}>{x.ok ? "✓" : "✗"}</span> {x.file} <span className="text-slate-500">sha256:{x.actual.slice(0, 16)}…</span></div>)}
        </div>
      )}
    </div>
  );
}

// ---- Cost --------------------------------------------------------------------------------------------------------------------
export function PriceEditor({ cfg, setCfg }: { cfg: RunConfig; setCfg: (c: RunConfig) => void }) {
  const p = cfg.prices;
  const setP = (k: keyof Prices, v: number) => setCfg({ ...cfg, priceKey: "custom", prices: { ...p, [k]: v } });
  return <div className="flex flex-wrap items-center gap-2 text-xs"><span className="text-slate-400">prices $/MTok</span><select value={cfg.priceKey} onChange={(e) => { const k = e.target.value; if (PRICE_PRESETS[k]) setCfg({ ...cfg, priceKey: k, prices: PRICE_PRESETS[k].prices }); }} className="rounded bg-slate-800 px-1 py-0.5">{Object.entries(PRICE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="custom">custom</option></select>{(["input", "output", "cacheRead", "cacheWrite"] as const).map((k) => <label key={k} className="flex items-center gap-1">{k}<input type="number" step="0.01" value={p[k]} onChange={(e) => setP(k, Number(e.target.value))} className="w-16 rounded bg-slate-800 px-1 py-0.5" /></label>)}</div>;
}
export function CostView({ traces, version, cfg, setCfg, onSel }: { traces: Record<number, Trace | null>; version: 1 | 2; cfg: RunConfig; setCfg: (c: RunConfig) => void; onSel: (s: Sel) => void }) {
  const t = traces[version]!;
  const both = traces[1] && traces[2];
  const tot = (x: Trace) => { const u = x.totals.usage; return { all: u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens, out: u.outputTokens, cr: u.cacheReadInputTokens, cw: u.cacheCreationInputTokens, cost: x.totals.cost }; };
  const noCache = (x: Trace) => { const u = x.totals.usage; return ((u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens) * cfg.prices.input + u.outputTokens * cfg.prices.output) / 1e6; };
  const a = tot(t);
  return (
    <div className="space-y-3 p-3 text-xs">
      <PriceEditor cfg={cfg} setCfg={setCfg} />
      <div className="text-[11px] text-slate-500">Estimated = chars/4 as <code>Tokens.kt</code> (estimate = (len+3)/4). Billed = simulated provider usage: estimate × a seeded factor ({t.billingFactor.toFixed(3)}, tolerance ±{(TOKENIZER_TOLERANCE * 100).toFixed(0)}%), cache = longest common prefix at message granularity, min 1024 tokens. <b>Simulated</b>, see §F.</div>
      <table className="w-full text-right font-mono"><thead className="text-slate-500"><tr className="text-right"><th className="text-left">#</th><th className="text-left">agent</th><th>est sys</th><th>est msgs</th><th>est tools</th><th>billed in</th><th>cache read</th><th>cache write</th><th>out</th><th>cost</th><th>billed/est</th></tr></thead>
        <tbody>{t.inferences.map((r, i) => { const est = r.est.system + r.est.messages + r.est.tools; const bil = r.usage.inputTokens + r.usage.cacheReadInputTokens + r.usage.cacheCreationInputTokens; return <tr key={i} className="cursor-pointer border-t border-slate-800 hover:bg-slate-800" onClick={() => onSel({ kind: "event", id: r.i, version })}><td className="text-left">{r.iteration}</td><td className="text-left">{r.agent}{r.agent === "main" ? ` t${r.turn + 1}` : ""}</td><td>{fmt(r.est.system)}</td><td>{fmt(r.est.messages)}</td><td>{fmt(r.est.tools)}</td><td>{fmt(r.usage.inputTokens)}</td><td className="text-emerald-300">{fmt(r.usage.cacheReadInputTokens)}</td><td className="text-amber-300">{fmt(r.usage.cacheCreationInputTokens)}</td><td>{fmt(r.usage.outputTokens)}</td><td>{usd(r.cost)}</td><td className={Math.abs(bil / est - 1) <= TOKENIZER_TOLERANCE + 0.001 ? "" : "text-rose-300"}>{(bil / est).toFixed(3)}</td></tr>; })}</tbody></table>
      <div className="flex flex-wrap gap-4">{t.totals.perTurn.map((x) => <div key={x.turn}>turn {x.turn + 1}: <b>{usd(x.cost)}</b> <span className="text-slate-500">(read {fmt(x.usage.cacheReadInputTokens)}, write {fmt(x.usage.cacheCreationInputTokens)}, out {fmt(x.usage.outputTokens)})</span></div>)}<div>session v{version}: <b className="text-sky-300">{usd(a.cost)}</b> · {fmt(a.all)} tokens · cache saved <b className="text-emerald-300">{usd(noCache(t) - a.cost)}</b> vs. no cache</div></div>
      {both && <div className="rounded border border-slate-700 bg-slate-900 p-2"><H>v1 vs v2 delta (same scenario, seed, prices)</H><table className="font-mono"><tbody>{(["all", "out", "cr", "cw", "cost"] as const).map((k) => { const x = tot(traces[1]!)[k], y = tot(traces[2]!)[k]; return <tr key={k}><td className="pr-4 text-slate-400">{{ all: "billed tokens", out: "output tokens", cr: "cache read", cw: "cache write", cost: "cost" }[k]}</td><td className="pr-4">{k === "cost" ? usd(x) : fmt(x)}</td><td className="pr-4">{k === "cost" ? usd(y) : fmt(y)}</td><td className={y > x ? "text-rose-300" : "text-emerald-300"}>{k === "cost" ? (y - x >= 0 ? "+" : "") + usd(y - x) : (y - x >= 0 ? "+" : "") + fmt(y - x)}</td></tr>; })}</tbody></table><div className="text-[11px] text-slate-500">v2's fixed overhead (policy-free sections, skills catalog, delegate + load_skill definitions) is visible below; it buys enforcement, procedures on demand and isolation.</div></div>}
      <H>attribution: what each extension point costs (main agent, {t.totals.calls} calls)</H>
      <table className="w-full font-mono"><thead className="text-left text-slate-500"><tr><th>extension point</th><th>kind</th><th>origin</th><th className="text-right">tokens</th><th className="text-right">× calls</th><th className="text-right">cost</th><th>note</th></tr></thead><tbody>{[...t.attribution].sort((x, y) => y.usd - x.usd).map((r, i) => <tr key={i} className="border-t border-slate-800"><td>{r.name}</td><td>{r.kind}</td><td>{r.origin}</td><td className="text-right">{fmt(r.tokens)}</td><td className="text-right">{r.calls}</td><td className="text-right">{usd(r.usd)}</td><td className="font-sans text-[10px] text-slate-500">{r.note}</td></tr>)}</tbody></table>
      {t.delegations.length > 0 && <div className="rounded border border-violet-800 p-2"><H>delegation economics (analytic counterfactual — labelled simulated)</H>{t.delegations.map((d) => <div key={d.agent} className="space-y-0.5"><div>{d.agent}: {d.subCalls} inference calls, {fmt(d.subTokens)} billed tokens in its OWN context (peak {fmt(d.peakContextTokens)}); parent received {fmt(d.summaryTokens)} tokens instead of {fmt(d.inlineTokens)} → <b className="text-emerald-300">{fmt(d.avoidedTokens)} tokens never entered the parent's context</b>.</div><div>cost if inline: {usd(d.inlineExtraCost)} · cost delegated (sub-agent session + summary): {usd(d.delegatedExtraCost)} · later parent calls: {d.laterParentCalls} · <b>break-even after {Number.isFinite(d.breakEvenCalls) ? d.breakEvenCalls : "∞"} further parent calls</b>. Delegation saves context first and dollars only when the parent keeps going or the reads are big.</div></div>)}</div>}
    </div>
  );
}

// ---- Audit / spans / touched / fork ----------------------------------------------------------------------------------------
export function AuditView({ t, version, onSel, onFork }: { t: Trace; version: 1 | 2; onSel: (s: Sel) => void; onFork: (n: number, d: "approve" | "deny") => void }) {
  const [tamper, setTamper] = useState<number | null>(null);
  const entries = tamper === null ? t.audit : t.audit.map((e, i) => (i === tamper ? { ...e, summary: e.summary + " (edited)" } : e));
  const ver = AuditLog.verify(entries);
  const T = Math.max(1, ...t.spans.map((s) => s.end));
  const w = t.world;
  const verdictRows = t.events.filter((x) => x.e.type === "guardrail_decision" && !x.e.isDefault && x.e.hook === "beforeToolUse");
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-slate-700 bg-slate-900 p-2"><H>what did this agent touch?</H>
        <div>read {w.reads.length} file(s): <span className="text-slate-400">{w.reads.slice(0, 8).join(", ")}{w.reads.length > 8 ? " …" : ""}</span></div>
        <div>wrote {w.writes.length}: <span className="text-emerald-300">{w.writes.join(", ") || "—"}</span> · uncommitted vs HEAD: {w.changed.join(", ") || "—"}</div>
        <div>commands run: <span className="text-slate-400">{w.executed.filter((c) => !/^(docker (info|image|rm)|uname|git rev-parse|git -C "?OpenRA"? (branch|status|log))/.test(c)).join(" | ") || "—"}</span></div>
        <div>commits {w.commits.length} · <b className={w.pushAttempts.length ? "text-rose-300" : "text-emerald-300"}>push attempts reaching git: {w.pushAttempts.length}</b> · network attempts: {w.network.length}</div>
        <div>guardrail denials: {verdictRows.filter((x) => x.e.kind === "deny").length} · approvals: {t.approvals.length}</div>
      </div>
      <div><H>approvals — fork at approval #k with the opposite decision (same prefix, different decision; replay is deterministic)</H>{t.approvals.length === 0 && <span className="text-slate-500">no approvals in this run</span>}{t.approvals.map((a) => <div key={a.n} className="mb-1 flex items-center gap-2"><Pill tone="amber" onClick={() => onSel({ kind: "approval", id: a.n, version })}>#{a.n + 1} {a.tool}</Pill><span className="text-slate-400">{a.decision}</span><span className="text-slate-600">scope {a.scope}</span><button className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600" onClick={() => onFork(a.n, a.decision.startsWith("deny") ? "approve" : "deny")}>fork: {a.decision.startsWith("deny") ? "approve" : "deny"} instead</button></div>)}</div>
      <div><H>spans (OpenTelemetry GenAI naming; virtual time {fmt(T)} ms)</H>
        <div className="space-y-px">{t.spans.filter((s) => s.kind !== "guardrail" || s.attrs["harness.decision"] !== "allow").map((s) => <div key={s.id} className="flex cursor-pointer items-center gap-2 hover:bg-slate-800" onClick={() => onSel({ kind: "span", id: s.id, version })}><span className="w-56 shrink-0 truncate font-mono text-[10px] text-slate-300">{s.parent ? "  " : ""}{s.name}</span><div className="relative h-3 flex-1 bg-slate-900"><div className={`absolute h-3 rounded-sm ${s.kind === "inference" ? "bg-sky-600" : s.kind === "tool" ? "bg-emerald-600" : s.kind === "guardrail" ? "bg-rose-500" : s.kind === "approval" ? "bg-amber-500" : "bg-slate-500"}`} style={{ left: `${(s.start / T) * 100}%`, width: `${Math.max(0.4, ((s.end - s.start) / T) * 100)}%` }} /></div></div>)}</div></div>
      <div><H>audit log {version === 2 ? "(append-only, hash-chained)" : "— v1 has none (REVIEW gap 9): switch to v2"}</H>
        {version === 2 && <><div className="mb-1 flex items-center gap-2"><Pill tone={ver.ok ? "green" : "red"}>{ver.ok ? "chain verifies" : `broken at #${ver.brokenAt}`}</Pill><span className="font-mono text-slate-500">head {t.auditHead} (cyrb53, NOT cryptographic — sim)</span><button className="rounded bg-slate-700 px-2 py-0.5" onClick={() => setTamper(tamper === null ? Math.min(3, t.audit.length - 1) : null)}>{tamper === null ? "tamper with entry #4" : "undo tamper"}</button><button className="rounded bg-slate-700 px-2 py-0.5" onClick={() => { const b = new Blob([t.audit.map((e) => JSON.stringify(e)).join("\n")], { type: "application/jsonl" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `audit-${t.scenario.id}.jsonl`; a.click(); }}>download JSONL</button></div>
          <div className="max-h-72 overflow-auto font-mono text-[10px]">{entries.map((e, i) => <div key={e.n} className={`flex cursor-pointer gap-2 hover:bg-slate-800 ${i === tamper ? "bg-rose-950" : ""}`} onClick={() => onSel({ kind: "audit", id: i, version })}><span className="w-6 text-right text-slate-600">{e.n}</span><span className="w-36 shrink-0 text-sky-300">{e.actor}</span><span className="w-28 shrink-0 text-slate-400">{e.kind}</span><span className="flex-1 truncate text-slate-200">{e.summary}</span><span className="text-slate-600">{e.hash.slice(0, 8)}</span></div>)}</div></>}
      </div>
    </div>
  );
}

// ---- Regression ---------------------------------------------------------------------------------------------------------------
export function RegressionView({ cfg }: { cfg: RunConfig }) {
  const [rows, setRows] = useState<{ id: string; title: string; kind: string; s1?: ReturnType<typeof summary>; s2?: ReturnType<typeof summary>; why?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setRows([]);
    for (const sc of SCENARIOS) {
      const r: (typeof rows)[number] = { id: sc.id, title: sc.title, kind: sc.kind };
      const base = { ...defaultConfig(1), seed: cfg.seed, prices: cfg.prices, priceKey: cfg.priceKey };
      const t1 = await runScenario(sc, { ...base, version: 1 }), t2 = await runScenario(sc, { ...base, version: 2, v2: { ...defaultConfig(2).v2 } });
      r.s1 = summary(t1); r.s2 = summary(t2); r.why = firstDivergence(t1, t2)?.sig2;
      setRows((x) => [...x, r]); await new Promise((res) => setTimeout(res, 0));
    }
    setBusy(false);
  };
  const pass = rows.filter((r) => r.s1?.passed && r.s2?.passed).length;
  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="flex items-center gap-3"><button disabled={busy} onClick={run} className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50">{busy ? "running…" : "run all scenarios in v1 and v2"}</button><span className="text-slate-400">seed {cfg.seed} · {rows.length}/{SCENARIOS.length} · {pass} pass in both versions</span></div>
      <table className="w-full font-mono"><thead className="text-left text-slate-500"><tr><th>id</th><th>title</th><th>v1</th><th className="text-right">calls</th><th className="text-right">cost</th><th>v2</th><th className="text-right">calls</th><th className="text-right">cost</th><th>first divergence (v2)</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id} className="border-t border-slate-800"><td>{r.id}</td><td className="font-sans">{r.title}</td><td className={r.s1?.passed ? "text-emerald-300" : "text-rose-300"}>{r.s1?.passed ? "pass" : "FAIL"}</td><td className="text-right">{r.s1?.toolCalls}</td><td className="text-right">{r.s1 && usd(r.s1.cost)}</td><td className={r.s2?.passed ? "text-emerald-300" : "text-rose-300"}>{r.s2?.passed ? "pass" : "FAIL"}</td><td className="text-right">{r.s2?.toolCalls}</td><td className="text-right">{r.s2 && usd(r.s2.cost)}</td><td className="text-[10px] text-slate-400">{r.why ?? "—"}</td></tr>)}</tbody></table>
    </div>
  );
}

// ---- Docs / fidelity ------------------------------------------------------------------------------------------------------------
export function DocsView({ t }: { t: Trace | null }) {
  const tone: Record<string, string> = { real: "green", replayed: "blue", simulated: "amber", illustrative: "orange" };
  return (
    <div className="space-y-3 p-3 text-xs">
      <H>fidelity boundary (every simulated result in the UI links here; PROTOTYPE.md §F has the long form)</H>
      <table className="w-full"><tbody>{Object.entries(SIM_BOUNDARY).map(([k, v]) => <tr key={k} className="border-t border-slate-800 align-top"><td className="py-1 pr-2 font-mono text-slate-200">{k}</td><td className="pr-2"><Pill tone={tone[v.fidelity]}>{v.fidelity}</Pill></td><td className="text-slate-400">{v.note}{t?.scenario.sim.includes(k) ? " ← used by this scenario" : ""}</td></tr>)}</tbody></table>
      <H>PROTOTYPE.md (sections A–G; also in the repo at prototype/docs/PROTOTYPE.md)</H>
      <Code text={DOCS} lang="markdown" />
    </div>
  );
}
export { isMain };
