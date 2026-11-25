// Headless run of every scenario in v1 and v2: `npm run regress` (41 scenarios x v1/v2). Prints a table and writes prototype/docs/regression.json.
import "../sim/shellGlobal";
import fs from "node:fs";
import { SCENARIOS } from "../scenarios";
import { defaultConfig, firstDivergence, runScenario, summary, type Trace } from "../engine/session";

const only = process.argv[2];
const rows: Record<string, unknown>[] = [];
let failed = 0;
for (const sc of SCENARIOS.filter((s) => !only || s.id === only)) {
  const out: Record<string, Trace> = {};
  for (const v of [1, 2] as const) {
    if (sc.kind === "v2lab" && v === 1 && !sc.expect.length) continue;
    try { out[v] = await runScenario(sc, defaultConfig(v)); } catch (e) { console.log(`!! ${sc.id} v${v} CRASH`, (e as Error).stack?.split("\n").slice(0, 4).join("\n")); failed++; }
  }
  for (const v of [1, 2] as const) {
    const t = out[v]; if (!t) continue;
    const s = summary(t);
    const bad = t.assertions.filter((a) => !a.ok);
    if (bad.length) failed++;
    console.log(`${bad.length ? "FAIL" : "ok  "} ${sc.id.padEnd(16)} v${v}  calls=${s.toolCalls} inf=${s.inferences} denied=${s.denied} appr=${s.approvals} tok=${s.tokens} $${s.cost.toFixed(4)}${bad.length ? "\n      ✗ " + bad.map((b) => b.name).join("\n      ✗ ") : ""}`);
    rows.push({ id: sc.id, version: v, ...s, assertions: t.assertions });
  }
  if (out[1] && out[2]) { const d = firstDivergence(out[1], out[2]); rows.push({ id: sc.id, diff: d }); }
}
fs.writeFileSync(new URL("../docs/regression.json", import.meta.url), JSON.stringify(rows, null, 1));
console.log(failed ? `\n${failed} scenario run(s) with failures` : "\nall scenario runs passed their assertions");
process.exitCode = failed ? 1 : 0;
