import "../sim/shellGlobal"; // FIRST: harness.ts reads globalThis.__harnessShell when it is evaluated
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIOS, scenarioById } from "../scenarios";
import { defaultConfig, runScenario, summary, type RunConfig, type Trace } from "../engine/session";
import type { ApprovalDecision, ApprovalRequest } from "../engine/agent";
import type { BlastRadius } from "../contract/v2/harness-v2";
import { AssembleView, AuditView, CostView, DocsView, RegressionView } from "./panels";
import { ApprovalModal, DiffView, GraphView, RunView } from "./views";
import { buildReport } from "./report";
import { Inspector, Pill, usd, fmt, type Sel } from "./ui";
import assignments from "../data/assignments.json";

type Tab = "run" | "graph" | "assemble" | "cost" | "diff" | "audit" | "regress" | "docs";
const TABS: [Tab, string][] = [["run", "Run"], ["graph", "Workflow"], ["assemble", "Assemble"], ["cost", "Cost"], ["diff", "Diff v1↔v2"], ["audit", "Audit & spans"], ["regress", "Regression"], ["docs", "Fidelity & docs"]];

interface Hash { s: string; v: 1 | 2; t: Tab; c: Partial<RunConfig> }
const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const dec = (h: string): Hash | null => { try { return JSON.parse(decodeURIComponent(escape(atob(h)))); } catch { return null; } };

export default function App() {
  const initial = useMemo(() => { const m = location.hash.match(/#s=(.+)$/); return m ? dec(m[1]) : null; }, []);
  const [sid, setSid] = useState(initial?.s && SCENARIOS.some((s) => s.id === initial.s) ? initial.s : "4.1");
  const [version, setVersion] = useState<1 | 2>(initial?.v ?? 1);
  const [tab, setTab] = useState<Tab>(initial?.t ?? "run");
  const [cfg, setCfg] = useState<RunConfig>(() => { const d = defaultConfig(1); const c = initial?.c ?? {}; return { ...d, ...c, v2: { ...d.v2, ...(c.v2 ?? {}) } }; });
  const [traces, setTraces] = useState<Record<number, Trace | null>>({ 1: null, 2: null });
  const [cursor, setCursor] = useState(0);
  const [sel, setSel] = useState<Sel>(null);
  const [pending, setPending] = useState<{ req: ApprovalRequest; detail?: BlastRadius; version: 1 | 2; resolve: (d: ApprovalDecision) => void } | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const sc = scenarioById(sid);
  const verRef = useRef(version); verRef.current = version;

  useEffect(() => {
    if (cfg.approvals === "interactive") return;
    let dead = false;
    (async () => {
      try {
        const t1 = await runScenario(sc, { ...cfg, version: 1 });
        const t2 = await runScenario(sc, { ...cfg, version: 2 });
        if (dead) return;
        setTraces({ 1: t1, 2: t2 }); setError("");
        setCursor((verRef.current === 1 ? t1 : t2).events.length);
      } catch (e) { if (!dead) setError(String((e as Error).stack ?? e)); }
    })();
    return () => { dead = true; };
  }, [sid, cfg.seed, cfg.artefact, cfg.prices, cfg.v2, cfg.overrides, cfg.freePrompt, cfg.approvals]); // eslint-disable-line react-hooks/exhaustive-deps

  const runInteractive = useCallback(async () => {
    setCursor(0);
    try {
      const t = await runScenario(sc, { ...cfg, version }, (req, detail) => new Promise<ApprovalDecision>((resolve) => setPending({ req, detail, version, resolve: (d) => { setPending(null); resolve(d); } })));
      setTraces((x) => ({ ...x, [version]: t })); setCursor(t.events.length);
    } catch (e) { setError(String((e as Error).stack ?? e)); }
  }, [sc, cfg, version]);

  const t = traces[version];
  const hash = () => `${location.origin}${location.pathname}#s=${enc({ s: sid, v: version, t: tab, c: { seed: cfg.seed, artefact: cfg.artefact, priceKey: cfg.priceKey, prices: cfg.prices, v2: cfg.v2, overrides: cfg.overrides, freePrompt: cfg.freePrompt } } satisfies Hash)}`;
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };
  const copyLink = () => { const h = hash(); history.replaceState(null, "", h.slice(h.indexOf("#"))); navigator.clipboard?.writeText(h); flash("permalink copied (state is in the URL hash)"); };
  const exportReport = () => { if (!traces[1] && !traces[2]) return; const b = new Blob([buildReport(traces, hash())], { type: "text/html" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `harness-report-${sid}.html`; a.click(); };

  const groups = useMemo(() => {
    const m = new Map<string, typeof SCENARIOS>();
    for (const s of SCENARIOS) { const k = s.kind === "v2lab" ? "v2 labs (v2-only features)" : s.kind === "extra" ? "Extras (open-ended)" : s.assignment; m.set(k, [...(m.get(k) ?? []), s]); }
    return [...m.entries()].sort((a, b) => (a[0].startsWith("v2") ? 1 : b[0].startsWith("v2") ? -1 : a[0].startsWith("Extras") ? 1 : b[0].startsWith("Extras") ? -1 : a[0].localeCompare(b[0])));
  }, []);
  const part = (assignments as { parts: { part: string | null; goal: string | null }[] }).parts.find((p) => p.part === sid);
  const free = sc.kind === "extra" || sid === "6.4";

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="text-sm font-bold text-slate-100">Agentic harness <span className="font-normal text-slate-500">· inspectable prototype</span></div>
        <div className="flex overflow-hidden rounded border border-slate-700 text-xs">{([1, 2] as const).map((v) => <button key={v} onClick={() => { setVersion(v); if (traces[v]) setCursor(traces[v]!.events.length); }} className={`px-3 py-1 ${version === v ? (v === 1 ? "bg-sky-700 text-white" : "bg-violet-700 text-white") : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{v === 1 ? "v1 · faithful to the repo" : "v2 · improved"}</button>)}</div>
        <label className="flex items-center gap-1 text-xs text-slate-400">seed<input type="number" value={cfg.seed} onChange={(e) => setCfg({ ...cfg, seed: Number(e.target.value) })} className="w-14 rounded bg-slate-800 px-1 py-0.5 text-slate-200" /></label>
        <label className="flex items-center gap-1 text-xs text-slate-400" title="off = the 'before' run: harness without your artefact for this part"><input type="checkbox" checked={cfg.artefact} onChange={(e) => setCfg({ ...cfg, artefact: e.target.checked })} />with my solution (part {sc.kind === "part" ? sc.id : "—"})</label>
        <select value={cfg.approvals} onChange={(e) => setCfg({ ...cfg, approvals: e.target.value as RunConfig["approvals"] })} className="rounded bg-slate-800 px-1 py-0.5 text-xs"><option value="scripted">approvals: scripted human</option><option value="interactive">approvals: I answer</option></select>
        {cfg.approvals === "interactive" && <button onClick={runInteractive} className="rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600">▶ run v{version} interactively</button>}
        {Object.keys(cfg.overrides).length > 0 && <button onClick={() => setCfg({ ...cfg, overrides: {} })} className="rounded bg-rose-900 px-2 py-1 text-xs text-rose-100">forked ({Object.keys(cfg.overrides).length}) — reset</button>}
        <div className="ml-auto flex items-center gap-2 text-xs">{t && <span className="text-slate-400">{t.totals.calls} calls · {fmt(t.totals.usage.inputTokens + t.totals.usage.outputTokens + t.totals.usage.cacheReadInputTokens + t.totals.usage.cacheCreationInputTokens)} tok · <b className="text-sky-300">{usd(t.totals.cost)}</b></span>}<button onClick={copyLink} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">copy permalink</button><button onClick={exportReport} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">export report</button></div>
      </header>
      {free && (
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-3 py-1 text-xs"><span className="text-slate-400">open-ended — type your own request (keyword-driven simulated model, not an LLM):</span><input value={cfg.freePrompt ?? ""} placeholder={sc.prompts[0]} onChange={(e) => setCfg({ ...cfg, freePrompt: e.target.value || undefined })} className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-slate-200" /></div>
      )}
      <div className="flex min-h-0 flex-1">
        <nav className="w-64 shrink-0 overflow-auto border-r border-slate-800 bg-slate-900/50 p-2 text-xs">
          {groups.map(([g, list]) => (
            <div key={g} className="mb-2"><div className="mb-1 font-semibold text-slate-400">{g}</div>
              {list.map((s) => <button key={s.id} onClick={() => { setSid(s.id); setSel(null); }} className={`block w-full truncate rounded px-2 py-0.5 text-left ${sid === s.id ? "bg-sky-900 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{s.core ? "★ " : ""}{s.kind === "part" ? s.id + " " : ""}{s.title}</button>)}
            </div>
          ))}
        </nav>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-slate-800 bg-slate-900/40 px-3 py-1 text-xs text-slate-400"><b className="text-slate-200">{sc.id}</b> {part?.goal ? `— ${part.goal}` : ""} <span className="text-slate-500">user: “{cfg.freePrompt ?? sc.prompts.join("” → “")}”</span></div>
          <div className="flex border-b border-slate-800 bg-slate-900 text-xs">{TABS.map(([k, n]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 ${tab === k ? "border-b-2 border-sky-400 text-white" : "text-slate-400 hover:text-slate-200"}`}>{n}</button>)}</div>
          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto">
              {error && <pre className="m-3 whitespace-pre-wrap rounded border border-rose-700 bg-rose-950 p-2 text-xs text-rose-200">{error}</pre>}
              {!t && tab !== "regress" && tab !== "docs" && !error && <div className="p-4 text-sm text-slate-500">{cfg.approvals === "interactive" ? "Press “run interactively”." : "running…"}</div>}
              {t && tab === "run" && <RunView t={t} version={version} cursor={cursor} onSel={setSel} />}
              {t && tab === "graph" && <GraphView t={t} version={version} cursor={cursor} setCursor={setCursor} onSel={setSel} />}
              {t && tab === "assemble" && <AssembleView t={t} version={version} cfg={cfg} setCfg={setCfg} onSel={setSel} />}
              {t && tab === "cost" && <CostView traces={traces} version={version} cfg={cfg} setCfg={setCfg} onSel={setSel} />}
              {tab === "diff" && traces[1] && traces[2] && <DiffView t1={traces[1]!} t2={traces[2]!} onSel={setSel} />}
              {t && tab === "audit" && <AuditView t={t} version={version} onSel={setSel} onFork={(n, d) => setCfg({ ...cfg, overrides: { ...cfg.overrides, [n]: d } })} />}
              {tab === "regress" && <RegressionView cfg={cfg} />}
              {tab === "docs" && <DocsView t={t} />}
            </div>
            <aside className="w-[460px] shrink-0 overflow-auto border-l border-slate-800 bg-slate-900/60"><Inspector sel={sel} traces={traces} onSel={setSel} /></aside>
          </div>
        </main>
      </div>
      {pending && <ApprovalModal req={pending.req} detail={pending.detail} version={pending.version} onDecide={pending.resolve} />}
      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-slate-700 px-3 py-1 text-xs text-white shadow">{toast}</div>}
      <footer className="border-t border-slate-800 bg-slate-900 px-3 py-0.5 text-[10px] text-slate-500">Everything runs offline in this page · model = deterministic replay driver (simulated) · {summaryLine(t)} <Pill tone="amber">simulated parts are labelled · docs §F</Pill></footer>
    </div>
  );
}
function summaryLine(t: Trace | null) { if (!t) return ""; const s = summary(t); return `${s.passed ? "assertions pass" : "ASSERTIONS FAIL"} · denied ${s.denied} · approvals ${s.approvals}`; }
