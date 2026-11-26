// Builds prototype/docs/PROTOTYPE.md from PROTOTYPE.src.md + real scenario runs (sections A and B) + docs/verification.txt.
import "../sim/shellGlobal";
import fs from "node:fs";
import { SCENARIOS } from "../scenarios";
import { defaultConfig, firstDivergence, runScenario, summary, type Trace } from "../engine/session";
import { describeEvent, fmt, usd } from "../app/ui";
import assignments from "../data/assignments.json";

const dir = new URL("../docs/", import.meta.url).pathname;
const src = fs.readFileSync(dir + "PROTOTYPE.src.md", "utf8");
const parts = (assignments as { parts: { part: string | null; goal: string | null; files: Record<string, string[]>; core: boolean }[] }).parts;
const excerpt = (t: Trace, max = 16) => {
  const lines = t.events.filter((x) => (x.e.agent ?? "main") === "main" && (["dynamic_section_emitted", "tool_call_proposed", "approval_requested", "turn_ended"].includes(String(x.e.type)) || (x.e.type === "guardrail_decision" && !x.e.isDefault) || x.e.type === "tool_call_completed"))
    .map((x) => { const d = describeEvent(x.e); return `${String(x.i).padStart(3)} [${d.tag}] ${d.text}`.slice(0, 170); });
  return lines.length > max ? [...lines.slice(0, max - 1), `    … (${lines.length - max + 1} more lines; open the scenario in the app)`] : lines;
};
const num = (s: ReturnType<typeof summary>) => `${s.inferences} inference calls, ${s.toolCalls} tool calls, ${s.denied} denied, ${s.approvals} approvals, ${fmt(s.tokens)} billed tokens, ${usd(s.cost)}`;
const LESSON: Record<string, string> = {
  "1.2": "**lesson changes:** the instruction becomes a *pinned* clone + an upstream-policy acknowledgement (provenance first, then convenience).",
  "1.3": "**lesson shifts:** the loaded file is labelled as data; `upstream_policy` states that files never override policy.",
  "4.1": "**lesson changes:** from 'write a regex guardrail' to 'upstream is a destination nobody may write to' as a *rule* (data) with a structural capability boundary; the code guardrail stays registered behind the policy (it never runs while a rule denies first, but it covers a missing rule). v1 mode keeps the regex exercise.",
  "4.2": "**lesson changes:** 'no python' becomes 'python is not on the allow-list' (default-deny). v1 mode keeps the regex exercise.",
  "4.4": "**lesson changes:** `env` never runs under the allow-list; secret-scan remains the backstop for `read_file`.",
  "4.5": "**lesson changes:** argv has no pipes; `sh`/`curl` are simply not allow-listed.",
  "4.6": "**lesson changes:** path arguments are resolved structurally, not word-scanned.",
};
const out: string[] = [];
const A: string[] = ["## A. Completing the six assignments in v1 (the current system)", "",
  "Each part below was **run in the sim** (`scenarios/index.ts`, v1 = default config, seed 7). *Trace expected* is an excerpt of the actual recorded v1 trace (main agent, non-default guardrail verdicts only); *before* is the same scenario with the artefact switched off. **Artefact** lists the 24 file names (Kotlin | Java | TypeScript, identical names across languages). **Status:** *executed* = the TypeScript reference solution ran unmodified inside the loop; Kotlin/Java versions are displayed but **not compiled** (unverified); *simulated* = the model and any Docker/git/OpenRA result come from the sim; *illustrative* = fixtures are mine.", ""];
const B: string[] = ["## B. Completing the six assignments in v2", "", "Same scenarios, same seed, v2 default config (all v2 features on). *Gained* = what the part gets from v2; *Δ* = v2 minus v1 for this scenario; *first behavioural divergence* ignores v2-only infrastructure (extra sections, once-per-session ack).", ""];
const rows: string[] = ["| id | title | v1 assertions | v2 assertions | tool calls v1/v2 | approvals v1/v2 | cost v1 → v2 |", "|---|---|---|---|---|---|---|"];
let last = "";
for (const sc of SCENARIOS) {
  const t1 = await runScenario(sc, defaultConfig(1)); const t2 = await runScenario(sc, defaultConfig(2));
  const s1 = summary(t1), s2 = summary(t2);
  rows.push(`| ${sc.id} | ${sc.title} | ${t1.assertions.filter((a) => a.ok).length}/${t1.assertions.length} | ${t2.assertions.filter((a) => a.ok).length}/${t2.assertions.length} | ${s1.toolCalls}/${s2.toolCalls} | ${s1.approvals}/${s2.approvals} | ${usd(s1.cost)} → ${usd(s2.cost)} |`);
  if (sc.kind === "v2lab") continue;
  if (sc.assignment !== last && sc.kind === "part") { last = sc.assignment; A.push(`### Assignment ${sc.assignment}`, ""); B.push(`### Assignment ${sc.assignment}`, ""); }
  if (sc.kind === "extra" && last !== "extras") { last = "extras"; A.push("### Extras (open-ended — `kind: extra`)", ""); B.push("### Extras (open-ended)", ""); }
  const p = parts.find((x) => x.part === sc.id);
  const f = p?.files ?? {};
  const files = f.typescript?.length ? f.kotlin.map((k, i) => `\`${k}\` | \`${f.java[i]}\` | \`${f.typescript[i]}\``).join("; ") : "none — this part produces no harness code";
  const before = sc.kind === "part" && sc.id[0] !== "6" ? summary(await runScenario(sc, { ...defaultConfig(1), artefact: false })) : null;
  A.push(`#### ${sc.id} ${sc.title}${sc.core ? " ★" : ""}  _(scenario \`${sc.id}\`)_`, "",
    `- **Objective:** ${p?.goal ?? sc.title}`, `- **Artefact:** ${files}`,
    `- **Status:** ${sc.kind === "extra" ? "open-ended, simulated (keyword-driven model)" : sc.fidelity === "illustrative" ? "run in the sim — **illustrative** fixtures" : f.typescript?.length ? "run in the sim — TS solution **executed unmodified**; Kotlin/Java displayed, **unverified**" : "run in the sim — composed from the earlier parts' executed solutions"}; simulated pieces: ${sc.sim.join(", ")}`,
    `- **Verification hook (worksheet):** ${sc.hook}`, `- **Cleanup:** \`${sc.cleanup ?? "none"}\``,
    ...(sc.designed ? [`- **Designed phenomenon:** ${sc.designed}`] : []),
    `- **v1 result:** ${num(s1)}; ${t1.assertions.filter((a) => a.ok).length}/${t1.assertions.length} trace assertions pass`,
    ...(before ? [`- **before (artefact off):** ${num(before)}`] : []),
    `- **Trace expected** (recorded):`, "", "```", ...excerpt(t1), "```", "",
    `- **Simulation boundary:** ${sc.sim.map((k) => `\`${k}\``).join(", ")} → UI badge *simulated · §F*; see §F2.`, "");
  const d = firstDivergence(t1, t2, true);
  B.push(`#### ${sc.id} ${sc.title}`, "", `- **Gained in v2:** ${sc.v2note}`, ...(LESSON[sc.id] ? [`- ${LESSON[sc.id]}`] : []),
    `- **Δ:** tool calls ${s1.toolCalls}→${s2.toolCalls}, approvals ${s1.approvals}→${s2.approvals}, denied ${s1.denied}→${s2.denied}, system tokens ${s1.systemTokens}→${s2.systemTokens}, cost ${usd(s1.cost)}→${usd(s2.cost)}`,
    `- **First behavioural divergence:** ${d ? `\`${d.sig1}\` ⟷ \`${d.sig2}\` — ${d.why}` : "none (same tool calls and verdicts)"}`,
    `- **v2 assertions:** ${t2.assertions.filter((a) => a.ok).length}/${t2.assertions.length} pass${t2.assertions.some((a) => !a.ok) ? " — **FAILING: " + t2.assertions.filter((a) => !a.ok).map((a) => a.name).join("; ") + "**" : ""}`, "");
}
B.push("### v2-only labs (every v2 feature is reachable from the UI and covered by a scenario)", "");
for (const sc of SCENARIOS.filter((s) => s.kind === "v2lab")) {
  const t1 = await runScenario(sc, defaultConfig(1)), t2 = await runScenario(sc, defaultConfig(2));
  B.push(`#### ${sc.id} — ${sc.title}`, "", `- **How to see it:** ${sc.hook}`, `- **Why:** ${sc.v2note}`, `- **v1:** ${num(summary(t1))} — ${t1.assertions.map((a) => (a.ok ? "✓ " : "✗ ") + a.name).join("; ")}`, `- **v2:** ${num(summary(t2))} — ${t2.assertions.map((a) => (a.ok ? "✓ " : "✗ ") + a.name).join("; ")}`, "");
}
B.push("### Regression view (all scenarios, seed 7, workshop prices)", "", ...rows, "");
const verify = fs.existsSync(dir + "verification.txt") ? "```\n" + fs.readFileSync(dir + "verification.txt", "utf8").replace(/\u001b\[[0-9;]*m/g, "") + "```" : "_(run `npx vite-node prototype/scripts/verify.tsx > prototype/docs/verification.txt` first)_";
const dom = fs.existsSync(dir + "dom-smoke.txt") ? "\n\n**`dom-smoke.tsx` output (verbatim; mounts the real `<App/>` in jsdom with React 19 effects, clicks every tab, switches scenarios, opens an inspector, copies a permalink, runs the Regression view):**\n\n```\n" + fs.readFileSync(dir + "dom-smoke.txt", "utf8").replace(/\u001b\[[0-9;]*m/g, "") + "```" : "";
out.push(src.replace("<!--A-->", A.join("\n")).replace("<!--B-->", B.join("\n")).replace("<!--VERIFY-->", "**`verify.tsx` output (verbatim):**\n\n" + verify + dom));
fs.writeFileSync(dir + "PROTOTYPE.md", out.join("\n"));
console.log("PROTOTYPE.md written,", out.join("\n").length, "chars");
