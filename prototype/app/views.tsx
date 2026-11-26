import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "../engine/agent";
import type { Trace } from "../engine/session";
import { firstDivergence, summary } from "../engine/session";
import type { BlastRadius } from "../contract/v2/harness-v2";
import { Code, describeEvent, fmt, H, isMain, isSimulated, Json, oneLine, Pill, SimBadge, usd, type Sel } from "./ui";

// ---- interactive approval (the real prompt: ConsoleApprovalHandler, plus v2's diff + blast radius) ---------------------------
export function ApprovalModal({ req, detail, version, onDecide }: { req: ApprovalRequest; detail?: BlastRadius; version: 1 | 2; onDecide: (d: ApprovalDecision) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-amber-600 bg-slate-900 p-4 shadow-2xl">
        <div className="text-sm font-semibold text-amber-300">!! {req.call.tool.name} needs approval <Pill tone={version === 2 ? "violet" : "blue"}>v{version}</Pill></div>
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-200">{req.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="mt-2 text-xs text-slate-400">input: <code className="text-sky-300">{JSON.stringify(req.call.input)}</code></div>
        {detail && <div className="mt-2 rounded border border-violet-800 bg-slate-950 p-2 text-xs"><div className="text-violet-300">v2 · {detail.summary}</div><div className="text-slate-400">risk {detail.risk} · network {String(detail.network)} · undo: {detail.reversible}</div>{detail.diff && <pre className="mt-1 overflow-auto text-[11px] text-slate-200">{detail.diff.split("\n").map((l, i) => <div key={i} className={l.startsWith("+") ? "text-emerald-300" : l.startsWith("-") ? "text-rose-300" : ""}>{l}</div>)}</pre>}<div className="mt-1 text-slate-500">“always” would cover scope <code className="text-sky-300">{req.scope}</code> — not the whole tool.</div></div>}
        {!detail && <div className="mt-2 text-[11px] text-slate-500">v1: “always” is scoped by tool name ({req.call.tool.name}): it will also approve every other call to this tool, for the rest of the session.</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="rounded bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600" onClick={() => onDecide({ kind: "approve" })}>[y] approve</button>
          <button className="rounded bg-sky-700 px-3 py-1 text-xs text-white hover:bg-sky-600" onClick={() => onDecide({ kind: "approve_always" })}>[a] always{version === 1 ? ` for ${req.call.tool.name}` : " (rule-scoped)"}</button>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (optional)" className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200" />
          <button className="rounded bg-rose-700 px-3 py-1 text-xs text-white hover:bg-rose-600" onClick={() => onDecide({ kind: "deny", reason: reason || "the user declined" })}>[n] deny</button>
        </div>
      </div>
    </div>
  );
}

// ---- Run view -----------------------------------------------------------------------------------------------------------
export function RunView({ t, version, cursor, onSel }: { t: Trace; version: 1 | 2; cursor: number; onSel: (s: Sel) => void }) {
  const reqIndex = useMemo(() => { const m = new Map<number, number>(); let n = 0; for (const x of t.events) if (x.e.type === "inference_requested" && isMain(x)) m.set(x.i, n++); return m; }, [t]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: "nearest" }); }, [cursor]);
  const sc = t.scenario;
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-slate-700 bg-slate-900 p-2">
        <div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-100">{sc.id} · {sc.title}</b>{sc.core && <Pill tone="amber">★ core</Pill>}<Pill>{sc.kind}</Pill><Pill tone={sc.fidelity === "illustrative" ? "orange" : "amber"}>{sc.fidelity}</Pill>{sc.sim.map((k) => <SimBadge key={k} k={k} />)}</div>
        <div className="mt-1 text-slate-400">worksheet hook: <i>{sc.hook}</i></div>
        {sc.designed && <div className="mt-1 text-amber-300/90">designed phenomenon: {sc.designed}</div>}
        {version === 2 && <div className="mt-1 text-violet-300">v2: {sc.v2note}</div>}
        <div className="mt-1 text-slate-500">cleanup: <code>{sc.cleanup ?? "none"}</code></div>
      </div>
      <div>
        <H>system prompt — static sections, frozen for the session ({fmt(t.totals.estSystem)} est. tokens)</H>
        <div className="flex flex-wrap gap-1">{t.bundle.items.filter((i) => i.kind === "section").map((i) => <Pill key={i.name} tone={i.sectionKind === "dynamic" ? "violet" : i.origin === "v2" ? "violet" : i.origin === "exercise" ? "green" : "slate"} onClick={() => onSel({ kind: "item", id: `section:${i.name}`, version })}>{i.sectionKind === "dynamic" ? "◌ " : ""}{i.name}</Pill>)}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-slate-500">tools: {t.bundle.tools.map((x) => <Pill key={x.name} onClick={() => onSel({ kind: "item", id: `tool:${x.name}`, version })}>{x.name}</Pill>)}</div>
      </div>
      <div className="space-y-0.5 font-mono">
        {t.events.slice(0, cursor).map((x) => {
          const d = describeEvent(x.e); const sub = !isMain(x);
          const tool = String(x.e.toolName ?? "");
          return (
            <div key={x.i} className={`group flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-800 ${sub ? "ml-6 border-l border-violet-700 pl-2" : ""} ${x.e.type === "turn_started" ? "mt-3 border-t border-slate-700 pt-2" : ""}`} onClick={() => onSel({ kind: "event", id: x.i, version })}>
              <span className="w-7 shrink-0 text-right text-slate-600">{x.i}</span>
              <Pill tone={d.tone}>{d.tag.padEnd(7, " ")}</Pill>
              <span className="min-w-0 flex-1 break-words text-slate-200">{d.text}</span>
              {x.e.type === "tool_call_completed" && isSimulated(tool, undefined) && <SimBadge k="docker" />}
              {x.e.type === "inference_requested" && isMain(x) && <Pill tone="blue" onClick={() => onSel({ kind: "wire", id: reqIndex.get(x.i)!, version })} title="exact wire JSON">wire</Pill>}
              {x.e.type === "guardrail_decision" && !x.e.isDefault && <Pill tone="slate" onClick={() => onSel({ kind: "item", id: `guardrail:${x.e.guardrail}`, version })}>{String(x.e.guardrail)}</Pill>}
              {x.e.type === "approval_requested" && !x.e.auto && <Pill tone="amber" onClick={() => onSel({ kind: "approval", id: t.approvals.findIndex((a) => a.eventIndex === x.i + 0 || a.eventIndex === x.i), version })}>detail</Pill>}
              {x.e.type === "tool_call_proposed" && <Pill tone="slate" onClick={() => onSel({ kind: "item", id: `tool:${tool}`, version })}>tool</Pill>}
              {x.e.type === "dynamic_section_emitted" && <Pill tone="violet" onClick={() => onSel({ kind: "item", id: `section:${x.e.section}`, version })}>section</Pill>}
            </div>
          );
        })}
        {t.printed.filter((p) => p.i <= cursor && p.i > 0).length > 0 && <div className="pt-2"><H>listener output (console.log captured from the TS listeners)</H><Code text={t.printed.filter((p) => p.i <= cursor).map((p) => `[${p.listener}] ${p.line.replace("\u0007", "🔔 BEL (terminal bell)")}`).join("\n")} lang="stdout" /></div>}
        <div ref={bottom} />
      </div>
      {cursor >= t.events.length && (
        <div className="rounded border border-slate-700 bg-slate-900 p-2">
          <H>outcome</H>
          <div className="text-slate-200">{t.results.map((r, i) => <div key={i}><Pill tone={r.kind === "completed" ? "green" : "orange"}>{r.kind}</Pill> {r.kind === "completed" ? r.text : r.kind === "aborted" ? r.reason : r.limit}</div>)}</div>
          {t.assertions.length > 0 && <><H>trace assertions (scenario expectations for v{version})</H>{t.assertions.map((a) => <div key={a.name} className={a.ok ? "text-emerald-300" : "text-rose-300"}>{a.ok ? "✓" : "✗"} {a.name}</div>)}</>}
          {t.assertions.length === 0 && <div className="mt-1 text-slate-500">assertions are only evaluated with the artefact switched on.</div>}
        </div>
      )}
    </div>
  );
}

// ---- Workflow graph ------------------------------------------------------------------------------------------------------
type NodeId = "user" | "beforeInference" | "dynamic" | "inference" | "stop" | "tool_use" | "beforeToolUse" | "ask" | "execute" | "afterToolUse" | "tool_result" | "beforeEndTurn" | "end_turn";
const NODES: Record<NodeId, { x: number; y: number; label: string; sub: string }> = {
  user: { x: 10, y: 20, label: "user", sub: "appendUser(text)" },
  beforeInference: { x: 150, y: 20, label: "beforeInference", sub: "each sees prior rewrite" },
  dynamic: { x: 300, y: 20, label: "dynamic sections", sub: "emit only on change" },
  inference: { x: 450, y: 20, label: "inference", sub: "model.infer(request)" },
  stop: { x: 600, y: 20, label: "stop_reason?", sub: "ToolUse | EndTurn" },
  tool_use: { x: 150, y: 130, label: "tool_use", sub: "ToolCallProposed" },
  beforeToolUse: { x: 300, y: 130, label: "beforeToolUse", sub: "first Deny wins" },
  ask: { x: 450, y: 130, label: "ask?", sub: "ONE human prompt" },
  execute: { x: 600, y: 130, label: "execute", sub: "tool.execute()" },
  afterToolUse: { x: 750, y: 130, label: "afterToolUse", sub: "Replace chains; 1st Reject" },
  tool_result: { x: 900, y: 130, label: "tool_result", sub: "ONE user message" },
  beforeEndTurn: { x: 600, y: 240, label: "beforeEndTurn", sub: "Continue ≤ 3" },
  end_turn: { x: 750, y: 240, label: "end_turn", sub: "Completed" },
};
const EDGES: [NodeId, NodeId, string][] = [["user", "beforeInference", ""], ["beforeInference", "dynamic", ""], ["dynamic", "inference", ""], ["inference", "stop", ""], ["stop", "tool_use", "ToolUse"], ["tool_use", "beforeToolUse", ""], ["beforeToolUse", "ask", "Ask"], ["ask", "execute", "approved"], ["beforeToolUse", "execute", "Allow"], ["execute", "afterToolUse", ""], ["afterToolUse", "tool_result", ""], ["beforeToolUse", "tool_result", "Deny"], ["ask", "tool_result", "denied"], ["tool_result", "beforeInference", "next iteration"], ["stop", "beforeEndTurn", "EndTurn"], ["beforeEndTurn", "end_turn", "AllowEnd"], ["beforeEndTurn", "beforeInference", "Continue"]];
function nodeOf(e: Record<string, unknown>): NodeId | null {
  switch (e.type) {
    case "turn_started": return "user";
    case "guardrail_decision": return e.hook === "beforeInference" ? "beforeInference" : e.hook === "beforeToolUse" ? (e.kind === "ask" ? "ask" : "beforeToolUse") : e.hook === "afterToolUse" ? "afterToolUse" : "beforeEndTurn";
    case "dynamic_section_emitted": return "dynamic";
    case "inference_requested": case "inference_completed": return e.type === "inference_completed" ? "stop" : "inference";
    case "tool_call_proposed": return "tool_use";
    case "approval_requested": return "ask";
    case "tool_call_completed": return "tool_result";
    case "turn_ended": return "end_turn";
    default: return null;
  }
}
export function GraphView({ t, version, cursor, setCursor, onSel }: { t: Trace; version: 1 | 2; cursor: number; setCursor: (n: number) => void; onSel: (s: Sel) => void }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    if (cursor >= t.events.length) { setPlaying(false); return; }
    const h = setTimeout(() => setCursor(cursor + 1), 650 / speed);
    return () => clearTimeout(h);
  }, [playing, cursor, speed, t, setCursor]);
  const shown = t.events.slice(0, cursor);
  const mainShown = shown.filter(isMain);
  const visits = new Map<NodeId, number>();
  const seq: NodeId[] = [];
  for (const x of mainShown) { const n = nodeOf(x.e); if (n) { if (seq[seq.length - 1] !== n) { visits.set(n, (visits.get(n) ?? 0) + 1); seq.push(n); } } }
  const cur = seq[seq.length - 1]; const prev = seq[seq.length - 2];
  const last = shown[shown.length - 1];
  const itersAt = t.events.filter((x) => x.e.type === "inference_requested" && isMain(x));
  const prevUsage = (() => { const u = [...shown].reverse().filter((x) => x.e.type === "inference_completed" && isMain(x)).slice(0, 2).map((x) => x.e.usage as Record<string, number>); return u.length === 2 ? { delta: u[0].inputTokens + u[0].cacheReadInputTokens + u[0].cacheCreationInputTokens - (u[1].inputTokens + u[1].cacheReadInputTokens + u[1].cacheCreationInputTokens) } : null; })();
  const w = 1010, h = 300;
  const edgePath = (a: NodeId, b: NodeId) => { const A = NODES[a], B = NODES[b]; const ax = A.x + 55, ay = A.y + 24, bx = B.x + 55, by = B.y + 24; if (b === "beforeInference" && a === "tool_result") return `M ${A.x + 55} ${A.y + 48} C ${A.x + 55} 210, ${B.x + 55} 90, ${B.x + 55} ${B.y + 48}`; if (b === "beforeInference") return `M ${A.x} ${ay} C ${A.x - 60} 200, ${B.x} 100, ${B.x + 20} ${B.y + 48}`; if (Math.abs(ay - by) < 5) return `M ${A.x + 110} ${ay} L ${B.x} ${by}`; return `M ${ax} ${A.y + 48} L ${bx} ${B.y}`; };
  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2">
        <button className="rounded bg-slate-700 px-2 py-1" title="rewind" onClick={() => { setPlaying(false); setCursor(0); }}>⏮</button>
        <button className="rounded bg-slate-700 px-2 py-1" title="step back" onClick={() => { setPlaying(false); setCursor(Math.max(0, cursor - 1)); }}>◀</button>
        <button className="rounded bg-emerald-700 px-3 py-1" onClick={() => { if (cursor >= t.events.length) setCursor(0); setPlaying(!playing); }}>{playing ? "⏸ pause" : "▶ play"}</button>
        <button className="rounded bg-slate-700 px-2 py-1" title="step" onClick={() => { setPlaying(false); setCursor(Math.min(t.events.length, cursor + 1)); }}>▶|</button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded bg-slate-800 px-1 py-1"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={10}>10×</option></select>
        <input type="range" min={0} max={t.events.length} value={cursor} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} className="min-w-[200px] flex-1" />
        <span className="text-slate-400">event {cursor}/{t.events.length} · t={last ? String(last.e.t) : 0} ms (virtual)</span>
        <span className="flex gap-1">{itersAt.map((x, i) => <button key={x.i} className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300 hover:bg-slate-700" title="jump to inference" onClick={() => { setPlaying(false); setCursor(x.i + 1); }}>#{i + 1}</button>)}</span>
      </div>
      <div className="overflow-auto rounded border border-slate-700 bg-slate-950">
        <svg width={w} height={h} className="min-w-[1010px]">
          <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b" /></marker><marker id="arrH" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#fbbf24" /></marker></defs>
          {EDGES.map(([a, b, label], i) => { const hot = prev === a && cur === b; const d = edgePath(a, b); return <g key={i}><path d={d} fill="none" stroke={hot ? "#fbbf24" : "#334155"} strokeWidth={hot ? 3 : 1.5} markerEnd={hot ? "url(#arrH)" : "url(#arr)"} />{label && <text fontSize="9" fill={hot ? "#fbbf24" : "#64748b"}><textPath href={`#e${i}`} /></text>}</g>; })}
          {EDGES.map(([a, b, label], i) => label ? <text key={"l" + i} x={(NODES[a].x + NODES[b].x) / 2 + 55} y={(NODES[a].y + NODES[b].y) / 2 + (NODES[a].y === NODES[b].y ? 20 : 34) + (i % 3) * 0} fontSize="9" fill="#64748b" textAnchor="middle">{label}</text> : null)}
          {(Object.keys(NODES) as NodeId[]).map((id) => { const n = NODES[id]; const v = visits.get(id) ?? 0; const hot = cur === id; return (
            <g key={id} transform={`translate(${n.x},${n.y})`} className="cursor-pointer" onClick={() => last && onSel({ kind: "event", id: [...shown].reverse().find((x) => nodeOf(x.e) === id)?.i ?? last.i, version })}>
              <rect width={110} height={48} rx={6} fill={hot ? "#78350f" : v ? "#0f2a3d" : "#0f172a"} stroke={hot ? "#fbbf24" : v ? "#38bdf8" : "#334155"} strokeWidth={hot ? 3 : 1.5} />
              <text x={55} y={20} fontSize="11" fill="#e2e8f0" textAnchor="middle" fontWeight="600">{n.label}</text><text x={55} y={35} fontSize="8.5" fill="#94a3b8" textAnchor="middle">{n.sub}</text>
              {v > 0 && <g><circle cx={104} cy={4} r={9} fill="#0369a1" /><text x={104} y={7.5} fontSize="9" fill="#fff" textAnchor="middle">{v}</text></g>}
            </g>); })}
        </svg>
      </div>
      <div className="rounded border border-slate-700 bg-slate-900 p-2">
        <H>output at the current node: {cur ?? "—"}</H>
        {last ? <NodeOutput t={t} lastIndex={last.i} delta={prevUsage?.delta ?? null} onSel={(s) => onSel({ ...s, version })} /> : <div className="text-slate-500">press ▶ or step to start.</div>}
      </div>
      <div className="text-[11px] text-slate-500">Nodes follow Agent.kt's normative order; the highlighted edge is the branch taken at this step; badges count visits. v2 adds no nodes: policy, compaction and upstream-ack are guardrails at the same hooks (open the Assemble tab).</div>
    </div>
  );
}
function NodeOutput({ t, lastIndex, delta, onSel }: { t: Trace; lastIndex: number; delta: number | null; onSel: (s: Sel & object) => void }) {
  const e = t.events[lastIndex].e as Record<string, unknown>; const d = describeEvent(e);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2"><Pill tone={d.tone}>{d.tag}</Pill><span className="text-slate-200">{d.text}</span><button className="text-sky-400 hover:underline" onClick={() => onSel({ kind: "event", id: lastIndex, version: 1 })}>raw event</button></div>
      {e.type === "dynamic_section_emitted" && <Code text={String(e.text)} lang={`section ${e.section}`} />}
      {e.type === "tool_call_proposed" && <Json v={e.input} />}
      {e.type === "tool_call_completed" && <><Code text={(e.outcome as { content?: string; message?: string }).content ?? (e.outcome as { message?: string }).message ?? ""} lang="tool result" /><div className="text-slate-500">duration {String(e.durationMs)} ms (virtual)</div></>}
      {e.type === "guardrail_decision" && <div className="text-slate-300">verdict <b>{String(e.kind)}</b>{e.reason ? <> — reason: <i>{String(e.reason)}</i></> : null}</div>}
      {e.type === "inference_completed" && <div className="text-slate-300">{(e.content as { kind: string; text?: string; name?: string }[]).map((b, i) => <div key={i}>{b.kind === "text" ? `“${b.text}”` : b.kind === "tool_use" ? `→ tool_use ${b.name}` : b.kind}</div>)}<div className="text-slate-500">token delta vs previous call: {delta === null ? "n/a" : (delta >= 0 ? "+" : "") + delta} · latency {String(e.t)} ms</div></div>}
      {e.type === "inference_requested" && <div className="text-slate-300">system {String(e.systemTokens)} + messages {String(e.messageTokens)} + tools {String(e.toolTokens)} (chars/4)</div>}
    </div>
  );
}

// ---- Diff -------------------------------------------------------------------------------------------------------------------
export function DiffView({ t1, t2, onSel }: { t1: Trace; t2: Trace; onSel: (s: Sel) => void }) {
  const d = firstDivergence(t1, t2);
  const db = firstDivergence(t1, t2, true);
  const s1 = summary(t1), s2 = summary(t2);
  const rows: [string, string | number, string | number][] = [["inference calls", s1.inferences, s2.inferences], ["tool calls", s1.toolCalls, s2.toolCalls], ["denied by guardrail", s1.denied, s2.denied], ["human approval prompts", s1.approvals, s2.approvals], ["pushes that reached git", s1.executedPushes, s2.executedPushes], ["system prompt tokens (est.)", s1.systemTokens, s2.systemTokens], ["billed tokens (all kinds)", s1.tokens, s2.tokens], ["cache-read tokens", s1.cacheRead, s2.cacheRead], ["session cost", usd(s1.cost), usd(s2.cost)]];
  const col = (t: Trace, v: 1 | 2, mark: number) => (
    <div className="min-w-0 flex-1 space-y-0.5 font-mono">
      <div className="mb-1 text-slate-300">v{v} <Pill tone={t.assertions.every((a) => a.ok) ? "green" : "red"}>{t.assertions.filter((a) => a.ok).length}/{t.assertions.length} assertions</Pill></div>
      {t.events.filter((x) => isMain(x) && !(x.e.type === "guardrail_decision" && x.e.isDefault) && ["dynamic_section_emitted", "tool_call_proposed", "guardrail_decision", "approval_requested", "tool_call_completed", "inference_completed"].includes(String(x.e.type))).map((x) => { const dd = describeEvent(x.e); const hit = x.i === mark; return <div key={x.i} onClick={() => onSel({ kind: "event", id: x.i, version: v })} className={`flex cursor-pointer gap-1 rounded px-1 py-0.5 hover:bg-slate-800 ${hit ? "bg-amber-900/50 ring-1 ring-amber-500" : ""} ${mark >= 0 && x.i > mark ? "opacity-60" : ""}`}><Pill tone={dd.tone}>{dd.tag}</Pill><span className="break-words text-[11px] text-slate-200">{dd.text}</span></div>; })}
    </div>
  );
  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="rounded border border-amber-700 bg-amber-950/40 p-2"><b className="text-amber-300">first divergence</b>{d ? <><div className="mt-1 text-slate-200">v1: <code>{d.sig1}</code> ⟷ v2: <code>{d.sig2}</code></div><div className="mt-1 text-amber-100">why: {d.why}</div></> : <div className="text-slate-300"> none — same behaviour in this scenario (v2 changes only cost here).</div>}
        <div className="mt-2 border-t border-amber-800 pt-1"><b className="text-amber-300">first behavioural divergence</b> <span className="text-slate-500">(ignores v2-only infrastructure: extra sections, the once-per-session upstream-ack)</span>{db ? <><div className="mt-1 text-slate-200">v1: <code>{db.sig1}</code> ⟷ v2: <code>{db.sig2}</code></div><div className="mt-1 text-amber-100">why: {db.why}</div></> : <div className="text-slate-300"> none — identical tool calls and verdicts.</div>}</div></div>
      <table className="w-full max-w-xl text-left"><thead className="text-slate-500"><tr><th>metric</th><th>v1</th><th>v2</th><th>Δ</th></tr></thead><tbody>{rows.map(([n, a, b]) => <tr key={n} className="border-t border-slate-800"><td className="py-0.5">{n}</td><td>{typeof a === "number" ? fmt(a) : a}</td><td>{typeof b === "number" ? fmt(b) : b}</td><td className={typeof a === "number" && typeof b === "number" ? (b > a ? "text-rose-300" : b < a ? "text-emerald-300" : "") : ""}>{typeof a === "number" && typeof b === "number" ? (b - a >= 0 ? "+" : "") + fmt(b - a) : ""}</td></tr>)}</tbody></table>
      <div className="flex gap-3">{col(t1, 1, d?.index1 ?? -1)}{col(t2, 2, d?.index2 ?? -1)}</div>
      <div className="text-[11px] text-slate-500">v2's extra prompt/tool tokens (policy-free sections, skills catalog, delegate, load_skill) are the price of its features; the cost tab attributes every token to the extension point that causes it. {oneLine(t2.scenario.v2note, 300)}</div>
    </div>
  );
}
