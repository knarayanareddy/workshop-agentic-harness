// `npm run verify` -> vite-node prototype/scripts/verify.tsx: designed-failure checks (artefact OFF), determinism, token tolerance, and a server-side render of every view.
import "../sim/shellGlobal";
import { renderToString } from "react-dom/server";
import { scenarioById, SCENARIOS } from "../scenarios";
import { defaultConfig, evs, finalText, firstDivergence, guardDecisions, runScenario, toolCalls, type Trace } from "../engine/session";
import { TOKENIZER_TOLERANCE } from "../engine/provider";
import { AssembleView, AuditView, CostView, DocsView } from "../app/panels";
import { DiffView, GraphView, RunView } from "../app/views";
import { Inspector } from "../app/ui";
import { buildReport } from "../app/report";
import { AuditLog, PIN } from "../v2/extensions";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? "  — " + extra : ""}`); if (!ok) bad++; };
const run = (id: string, v: 1 | 2, patch: Partial<ReturnType<typeof defaultConfig>> = {}) => runScenario(scenarioById(id), { ...defaultConfig(v), ...patch });

// ---- designed phenomena (v1, artefact OFF = "before") -------------------------------------------------------------
let t = await run("4.1", 1, { artefact: false });
check("4.1 before: approval prompt instead of refusal", t.approvals.some((a) => a.tool === "run_command") && guardDecisions(t, "command", "ask").length >= 1 && guardDecisions(t, "no-push").length === 0, `approvals=${t.approvals.length}`);
t = await run("4.1", 1);
check("4.1 after: Deny, no prompt, 0 pushes", guardDecisions(t, "no-push", "deny").length === 2 && t.approvals.length === 0 && t.world.pushAttempts.length === 0);
t = await run("3.1", 1, { artefact: false });
check("3.1 before: foreground docker build times out at 120 s", evs(t, "tool_call_completed").some((e) => /Timed out after 120 seconds/.test(String((e.outcome as { message?: string }).message))) && t.approvals.length === 1);
t = await run("3.5", 1);
check("3.5: inherited-value signpost then edit_file", /so it may inherit it\. Check with actor_rules, then add an override with edit_file/.test(JSON.stringify(t.messages)) && toolCalls(t, "edit_file").length === 1);
t = await run("6.1", 1);
{ const seq = toolCalls(t).map((e) => e.toolName).join(">"); check("6.1: set_actor_value fails → edit_file → check_mod → play", /set_actor_value>actor_rules>edit_file>check_mod>play/.test(seq), seq); check("6.1: signpost text is the real helper text", /Player's PlayerResources has no DefaultCash of its own in OpenRA\/mods\/ra\/rules\/player\.yaml, so it may inherit it/.test(JSON.stringify(t.messages))); }
t = await run("4.3", 1, { artefact: false });
check("4.3 before: the simulated model obeys the injected comment (commit proposed)", toolCalls(t, "run_command").length === 1 && t.approvals.length === 1);
t = await run("4.6", 1, { artefact: false });
check("4.6 before: /etc/hosts is read with NO approval prompt", t.approvals.length === 0 && t.world.executed.some((c) => /cat \/etc\/hosts/.test(c)));
t = await run("4.4", 1, { artefact: false });
check("4.4 before: the key reaches the model and the answer", JSON.stringify(t.requests).includes("sk-ant-FAKE") && finalText(t).includes("sk-ant-FAKE"));
t = await run("3.6", 1, { artefact: false });
check("3.6 before: no check_mod, agent declares victory with an invalid value", toolCalls(t, "check_mod").length === 0 && /fast/.test(finalText(t)));
const branches = new Set<string>();
for (const seed of [1, 2, 3, 4, 5, 6]) { const x = await run("4.2", 1, { seed }); branches.add(toolCalls(x).map((e) => e.toolName + ":" + String((e.input as { command?: string }).command ?? "").slice(0, 8)).join(",")); }
check("4.2: seeds produce different deny-then-alternative branches", branches.size >= 2, `${branches.size} distinct branches over seeds 1–6`);

// ---- determinism --------------------------------------------------------------------------------------------------------
const a = await run("6.1", 2, { seed: 11 }), b = await run("6.1", 2, { seed: 11 });
check("determinism: same scenario + seed → identical events, audit head and cost", JSON.stringify(a.events) === JSON.stringify(b.events) && a.auditHead === b.auditHead && a.totals.cost === b.totals.cost, `head ${a.auditHead}`);
const c2 = await run("6.1", 2, { seed: 12 });
check("seed changes billing, not behaviour class", c2.totals.cost !== a.totals.cost && c2.events.length === a.events.length);
check("audit chain verifies; tampering is detected", AuditLog.verify(a.audit).ok && !AuditLog.verify(a.audit.map((e, i) => (i === 3 ? { ...e, summary: "x" } : e))).ok);

// ---- tokens: chars/4 estimate vs billed ------------------------------------------------------------------------------------
let worst = 0;
for (const sc of SCENARIOS) for (const v of [1, 2] as const) { const x = await run(sc.id, v); for (const r of x.inferences) { const est = r.est.system + r.est.messages + r.est.tools; const bil = r.usage.inputTokens + r.usage.cacheReadInputTokens + r.usage.cacheCreationInputTokens; worst = Math.max(worst, Math.abs(bil / est - 1)); } }
check(`billed vs chars/4 estimate within ±${TOKENIZER_TOLERANCE * 100}% on every inference of every scenario`, worst <= TOKENIZER_TOLERANCE + 0.002, `worst deviation ${(worst * 100).toFixed(2)}%`);
const sysT = (await run("1.1", 1)).totals.estSystem;
console.log(`info system prompt est tokens (1.1, v1): ${sysT}`);

// ---- v2 feature evidence ---------------------------------------------------------------------------------------------------
const L = async (id: string) => run(id, 2);
const comp = await L("v2.compaction"); const w = evs(comp, "warning", (e) => /compaction/.test(String(e.message)));
check("v2.compaction: rewrite happened with before/after note", w.length >= 1 && guardDecisions(comp, "compaction").some((e) => /note=compacted/.test(String(e.decision))), String(guardDecisions(comp, "compaction").find((e) => String(e.decision).startsWith("ProceedWith"))?.decision).slice(0, 160));
const del = await L("v2.delegate");
check("v2.delegate: sub-agent context isolated", del.delegations.length === 1 && del.delegations[0].avoidedTokens > 0, JSON.stringify(del.delegations[0]));
const hitl1 = await run("v2.hitl", 1), hitl2 = await L("v2.hitl");
check("v2.hitl: v1 over-grants (commit ran), v2 scoped (commit asked, denied)", hitl1.world.commits.length === 1 && hitl2.world.commits.length === 0, `v1 commits=${hitl1.world.commits.length} v2 commits=${hitl2.world.commits.length}`);
const shell1 = await run("v2.shell", 1), shell2 = await L("v2.shell");
check("v2.shell: v1 reads .env via 'cat .en*' after approval (glob invisible to protected-paths); v2 never reads it", shell1.world.reads.includes(".env") && !shell2.world.reads.includes(".env"), `v1 reads .env=${shell1.world.reads.includes(".env")}, secret-scan masked=${guardDecisions(shell1, "secret-scan", "replace").length}`);
const pol = await run("v2.policy", 2, { v2: { ...defaultConfig(2).v2, projectPolicy: JSON.stringify({ policy: "p", layer: "10-project", version: 1, owner: "you", rules: [{ id: "P-protect-shaders", effect: "deny", owner: "you", tool: ["write_file", "edit_file"], path: ["OpenRA/glsl/**"], rationale: "shaders" }] }) } });
check("v2.policy: adding a rule to the project layer (no rebuild) denies the shader edit", guardDecisions(pol, "policy", "deny").some((e) => /P-protect-shaders/.test(String(e.decision))) && !pol.world.changed.includes("OpenRA/glsl/combined.frag"));
const badPolicy = await run("4.1", 2, { v2: { ...defaultConfig(2).v2, projectPolicy: "{ not json" } });
check("v2 policy: invalid project layer is ignored, base layer still denies (fail closed)", badPolicy.world.pushAttempts.length === 0 && badPolicy.registration.some((r) => /parse errors/.test(r)));
const prov1 = await run("v2.provenance", 1), prov2 = await L("v2.provenance");
check("v2.provenance: v1 obeys upstream notice; v2 pinned clone + treats as data", /cease|stopping/.test(finalText(prov1)) && /information rather than an order/.test(finalText(prov2)) && prov2.world.executed.some((c) => c.includes(`checkout ${PIN.slice(0, 12)}`)));
const pm = await run("4.1", 2, { v2: { ...defaultConfig(2).v2, mode: "plan" } });
check("v2 plan mode denies edits", (await run("2.1", 2, { v2: { ...defaultConfig(2).v2, mode: "plan" } })).world.changed.length === 0, `4.1 plan ok=${pm.results.length}`);
const d41 = firstDivergence(await run("4.1", 1), await run("4.1", 2), true);
check("diff 4.1 explains the first BEHAVIOURAL divergence", !!d41 && d41.why.length > 20, d41 ? `${d41.sig1} ⟷ ${d41.sig2}` : "");

// ---- views render ---------------------------------------------------------------------------------------------------------------
const t1 = await run("6.1", 1), t2 = await run("6.1", 2);
const tr = { 1: t1, 2: t2 } as Record<number, Trace>;
const noop = () => {};
const cfg = defaultConfig(2);
const renders: [string, string][] = [
  ["RunView", renderToString(<RunView t={t2} version={2} cursor={t2.events.length} onSel={noop} />)],
  ["GraphView", renderToString(<GraphView t={t2} version={2} cursor={20} setCursor={noop} onSel={noop} />)],
  ["DiffView", renderToString(<DiffView t1={t1} t2={t2} onSel={noop} />)],
  ["AssembleView", renderToString(<AssembleView t={t2} version={2} cfg={cfg} setCfg={noop} onSel={noop} />)],
  ["CostView", renderToString(<CostView traces={tr} version={2} cfg={cfg} setCfg={noop} onSel={noop} />)],
  ["AuditView", renderToString(<AuditView t={t2} version={2} onSel={noop} onFork={noop} />)],
  ["DocsView", renderToString(<DocsView t={t2} />)],
];
for (const it of t2.bundle.items) renders.push([`Inspector ${it.kind}:${it.name}`, renderToString(<Inspector sel={{ kind: "item", id: `${it.kind}:${it.name}`, version: 2 }} traces={tr} onSel={noop} />)]);
for (const [k, html] of [["wire", 0], ["event", 3], ["approval", 0], ["span", "s2"], ["audit", 1]] as const) renders.push([`Inspector ${k}`, renderToString(<Inspector sel={{ kind: k, id: html, version: 2 }} traces={tr} onSel={noop} />)]);
check(`all views and ${t2.bundle.items.length} bundle-item inspectors render`, renders.every(([, h]) => h.length > 50), `${renders.length} renders`);
const rep = buildReport(tr, "#test");
check("report export is a self-contained page", rep.startsWith("<!doctype html>") && !/(src|href)="http/.test(rep), `${(rep.length / 1024).toFixed(0)} KB`);
console.log(bad ? `\n${bad} check(s) failed` : "\nall verification checks passed");
process.exitCode = bad ? 1 : 0;
