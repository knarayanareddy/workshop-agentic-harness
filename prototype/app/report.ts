// Export the run as a self-contained report page, in the spirit of /report (SessionReport.kt) — improved: both versions, verdict
// table, approvals with scope, cost attribution, touched summary, audit head, machine-readable JSON appendix.
import type { Trace } from "../engine/session";
import { summary } from "../engine/session";
import { describeEvent, fmt, usd } from "./ui";

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function section(t: Trace, v: 1 | 2): string {
  const s = summary(t);
  const events = t.events.map((x) => { const d = describeEvent(x.e); return `<tr class="${d.tone}"><td>${x.i}</td><td>${esc(x.e.t)}</td><td>${esc(d.tag)}</td><td>${esc(d.text)}</td></tr>`; }).join("");
  const ver = t.bundle.items.map((i) => `<li>${esc(i.kind)} <b>${esc(i.name)}</b> <small>(${esc(i.origin)}${i.part ? " " + i.part : ""})</small></li>`).join("");
  const appr = t.approvals.map((a) => `<tr><td>#${a.n + 1}</td><td>${esc(a.tool)}</td><td>${esc(a.reasons.join(" | "))}</td><td>${esc(a.decision)}</td><td>${esc(a.scope)}</td><td>${a.blast ? esc(a.blast.summary) : "—"}</td></tr>`).join("");
  const verdicts = t.events.filter((x) => x.e.type === "guardrail_decision" && !x.e.isDefault).map((x) => `<tr><td>${x.i}</td><td>${esc(x.e.guardrail)}.${esc(x.e.hook)}</td><td>${esc(x.e.decision)}</td></tr>`).join("");
  const inf = t.inferences.map((r) => `<tr><td>${esc(r.agent)}#${r.iteration}</td><td>${r.est.system}/${r.est.messages}/${r.est.tools}</td><td>${r.usage.inputTokens}</td><td>${r.usage.cacheReadInputTokens}</td><td>${r.usage.cacheCreationInputTokens}</td><td>${r.usage.outputTokens}</td><td>${usd(r.cost)}</td></tr>`).join("");
  const attr = t.attribution.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td>${a.tokens}</td><td>${a.calls}</td><td>${usd(a.usd)}</td></tr>`).join("");
  return `<section><h2>v${v} — ${esc(t.scenario.id)} ${esc(t.scenario.title)}</h2>
<p class="meta">seed ${t.config.seed} · artefact ${t.config.artefact ? "on" : "off"} · prices ${esc(JSON.stringify(t.config.prices))} · <b>simulated</b>: ${esc(t.scenario.sim.join(", "))} (docs/PROTOTYPE.md §F)</p>
<p><b>${s.inferences}</b> inference calls · <b>${s.toolCalls}</b> tool calls · <b>${s.denied}</b> denied · <b>${s.approvals}</b> approvals · pushes reaching git <b>${s.executedPushes}</b> · ${fmt(s.tokens)} billed tokens · <b>${usd(s.cost)}</b></p>
<p>outcome: ${t.results.map((r) => esc(r.kind === "completed" ? r.text : r.kind === "aborted" ? r.reason : r.limit)).join(" / ")}</p>
<h3>assertions</h3><ul>${t.assertions.map((a) => `<li class="${a.ok ? "ok" : "bad"}">${a.ok ? "✓" : "✗"} ${esc(a.name)}</li>`).join("") || "<li>n/a</li>"}</ul>
<h3>bundle (assembly order)</h3><ol>${ver}</ol>
<h3>approvals — who approved what</h3><table><tr><th>#</th><th>tool</th><th>asked because</th><th>decision</th><th>scope</th><th>blast radius</th></tr>${appr || "<tr><td colspan=6>none</td></tr>"}</table>
<h3>guardrail verdicts (non-default)</h3><table><tr><th>event</th><th>hook</th><th>decision</th></tr>${verdicts}</table>
<h3>cost per inference (est sys/msgs/tools · billed in/read/write/out)</h3><table><tr><th>call</th><th>est</th><th>in</th><th>read</th><th>write</th><th>out</th><th>cost</th></tr>${inf}</table>
<h3>cost attribution</h3><table><tr><th>extension point</th><th>kind</th><th>tokens</th><th>calls</th><th>cost</th></tr>${attr}</table>
<h3>what did this agent touch</h3><p>read: ${esc(t.world.reads.join(", "))}<br>wrote: ${esc(t.world.writes.join(", ") || "—")}<br>commands: ${esc(t.world.executed.join(" | "))}<br>commits ${t.world.commits.length} · push attempts ${t.world.pushAttempts.length} · network attempts ${t.world.network.length}</p>
<h3>timeline</h3><table class="ev"><tr><th>#</th><th>t ms</th><th>kind</th><th>detail</th></tr>${events}</table>
${v === 2 ? `<h3>audit log head</h3><p><code>${esc(t.auditHead)}</code> (${t.audit.length} entries, hash-chained; cyrb53 — not cryptographic in this sim)</p>` : ""}
<details><summary>machine-readable summary</summary><pre>${esc(JSON.stringify({ scenario: t.scenario.id, version: v, seed: t.config.seed, summary: s, approvals: t.approvals.map((a) => ({ n: a.n, tool: a.tool, decision: a.decision, scope: a.scope })), changed: t.world.changed }, null, 2))}</pre></details></section>`;
}
export function buildReport(traces: Record<number, Trace | null>, permalink: string): string {
  const ts = ([1, 2] as const).filter((v) => traces[v]);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Harness report — ${esc(traces[ts[0]]!.scenario.id)}</title><style>
body{font:13px/1.45 system-ui,sans-serif;background:#0b1220;color:#e2e8f0;max-width:1100px;margin:24px auto;padding:0 16px}h1,h2,h3{color:#f8fafc}h3{margin-top:18px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8}
table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-top:1px solid #1e293b;padding:2px 6px;text-align:left;vertical-align:top}.meta{color:#94a3b8}.ok{color:#6ee7b7}.bad{color:#fda4af}
tr.red td{color:#fda4af}tr.amber td{color:#fcd34d}tr.green td{color:#6ee7b7}tr.violet td{color:#c4b5fd}section{border-top:2px solid #334155;margin-top:28px;padding-top:8px}pre{background:#020617;padding:8px;overflow:auto}</style></head><body>
<h1>Agentic harness — session report</h1><p class="meta">Generated by the workshop-harness prototype (offline, deterministic, simulated model). Permalink: <code>${esc(permalink)}</code></p>
${ts.map((v) => section(traces[v]!, v)).join("")}</body></html>`;
}
