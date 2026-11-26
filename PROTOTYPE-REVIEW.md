# Review rubric: `develop-workshop-harness-prototype.zip`

What I will actually check when the archive lands, so the review is reproducible rather than
impressionistic. Derived from `PROMPT.md` (the brief it was built against) plus the verified
baseline facts in `REVIEW.md`.

**Archive as supplied:** `develop-workshop-harness-prototype.zip`, 1,170,226 bytes,
`application/zip`, modified 2026-11-25 19:23 UTC.

**How I will review:** unpack into a scratch dir, never into the repo root. Read `README`/`PLAN`
first, then trace the boot path by hand, then run everything that can run offline. Every finding
below gets a severity (P0 blocks the demo, P1 costs a reviewer/facilitator time, P2 polish) and a
`path:line` reference. Anything I cannot execute gets marked **unverified** — same standard the
brief demanded of the prototype.

---

## Gate 0 — does it run at all (blocks everything else)

| # | Test | Pass condition |
|---|---|---|
| 0.1 | Unpack, read the runbook, install, start | One documented command; no missing step |
| 0.2 | Run with network disabled | Loads, runs a scenario, renders a trace |
| 0.3 | No API key, no JDK, no Docker required | Starts clean without them |
| 0.4 | Browser console clean on first load | No uncaught errors, no failed 404s for assets |
| 0.5 | `npm run build` (or equivalent) produces a self-contained `dist/` | Builds offline; relative asset URLs |
| 0.6 | No absolute `localhost`/`127.0.0.1` in browser-facing code | Preview-proxy safe; binds `0.0.0.0` if a server |
| 0.7 | Second load is deterministic | Same scenario + seed ⇒ byte-identical trace |

## Gate 1 — engine fidelity to the real loop

The prototype's own loop must match `harness-core/.../Agent.kt`, not a paraphrase.

| # | Test | Pass condition |
|---|---|---|
| 1.1 | Hook order | `beforeInference` → dynamic sections → inference → (`beforeToolUse` → execute → `afterToolUse`)* → `beforeEndTurn` |
| 1.2 | First `Deny` wins | Later guardrails are not consulted for that call |
| 1.3 | `Ask` reasons collected | All `Ask`s surface as **one** human prompt with all reasons |
| 1.4 | `ApproveAlways` scoped | Remembered for the session, suppresses later `Ask`s for that tool |
| 1.5 | `Replace` chains, first `Reject` wins | Observable in a two-guardrail scenario |
| 1.6 | `Continue` bounded | Stops at 3 and emits the warning |
| 1.7 | `maxIterations = 25` | Hard stop with `LimitReached` |
| 1.8 | One user message per assistant turn | All `ToolResult`s of a turn in one message, in `ToolUse` order |
| 1.9 | Fail-closed | A throwing hook ⇒ Deny/Reject/Abort, demonstrable |
| 1.10 | Dynamic sections only when changed | Second inference in a turn emits no duplicate |
| 1.11 | Constants match | 25 / 3 / 120 s / 20 000 / 30 000 / 8 tools / 4 guardrails / 3 sections |
| 1.12 | `Tokens.kt` estimate | chars/4 per part (system / messages / tools), close to the stated tolerance |

**Fidelity risks I will specifically hunt for:** a rewritten engine that "improves" v1 (breaks the
teaching point); `Ask` collapsed into `Deny`; ordering of `build-file` vs `result-cap` swapped;
`ApproveAlways` implemented per-call; dynamic section emitted every iteration.

## Gate 2 — all six assignments, v1

27 numbered parts + 6 extras. Each must be selectable and produce the phenomena the worksheet
predicts — including the four **designed failures**, which are the hardest and most important:

| # | Must happen | Why it matters |
|---|---|---|
| 2.1 | 3.5 `set_actor_value` returns the "inherited value" signpost, not a silent guess | The signpost pattern is the whole lesson |
| 2.2 | 4.1 *before* the guardrail exists: an approval prompt, not a refusal | Otherwise the assignment has nothing to fix |
| 2.3 | 4.2 deny → the model tries an alternative (`grep`/`find_actor`) | Shows Deny changes behaviour |
| 2.4 | 6.1 fails at `set_actor_value` → `edit_file` on `PlayerResources` → `check_mod` passes → `play` | The capstone's designed failure |
| 2.5 | 1.2 emits once, then never again after the "clone" | Dynamic-section economy |
| 2.6 | 4.3 flags an injected comment in a tool result, model does not obey it | Rewrite beats Reject |
| 2.7 | 4.4 masks a key *before* the model sees it; ordering vs result-cap demonstrable | Register-order lesson |
| 2.8 | 5.2 bell fires on `Ask` **before** the prompt, not on `ApprovalRequested` | The event-order lesson |
| 2.9 | All 23 code parts show the actual reference solution for the chosen language | Not a paraphrase |
| 2.10 | Cleanup steps modelled (dirty vs clean OpenRA tree changes later parts) | Reproducibility across parts |

Scored per part: **complete** / **partial** / **absent** / **wrong** (contradicts the worksheet),
with the trace evidence for each.

## Gate 3 — all six assignments, v2 + diff mode

| # | Test |
|---|---|
| 3.1 | 27 parts runnable in v2; none silently dropped |
| 3.2 | Diff mode highlights the first divergent node and explains *why* in one line |
| 3.3 | v2 did not make an assignment trivial — or it says so explicitly and keeps a v1 mode |
| 3.4 | Each v2 feature is reachable from the UI, not just described in the docs |
| 3.5 | New capabilities appear in a written contract file (no invented API) |

## Gate 4 — inspectability (every element opens its implementation)

| # | Element | Inspector must show |
|---|---|---|
| 4.1 | System prompt section | name, static/dynamic, emitted text, render source |
| 4.2 | Tool | name, exact `description` the model reads, `inputSchema`, implementation, call+result JSON |
| 4.3 | Guardrail | four hooks, implemented-vs-defaulted, verdict + reason per call, why it won |
| 4.4 | Listener | consumed event types, lines printed |
| 4.5 | Transcript message | exact wire JSON |
| 4.6 | Assembly view | sections → tools → guardrails → listeners, in order, with the one place that composes them |

Spot-check the wiring: does the inspector read live bundle state, or a hand-copied string that can
drift from what actually ran? (Drift = P1.)

## Gate 5 — the workflow visualisation

| # | Test |
|---|---|
| 5.1 | Node graph with the branch actually taken highlighted per step |
| 5.2 | Play / pause / step / rewind / speed, all functional |
| 5.3 | Scrubbing shows the correct state at that point (not just re-rendered fragments) |
| 5.4 | Output visualised per node: prompt text, tool I/O, verdict, duration, token delta |
| 5.5 | Export a self-contained report page |
| 5.6 | Permalink reproduces the exact trace |

## Gate 6 — cost & observability honesty

| # | Test |
|---|---|
| 6.1 | Per inference: estimated split **and** billed usage with cache read/write |
| 6.2 | Per turn and per session totals; v1-vs-v2 delta |
| 6.3 | Prices configurable, not hardcoded to one vendor |
| 6.4 | "This section costs N tokens on every call" attribution is real arithmetic, not a mock |
| 6.5 | Estimates vs billed reconciled within a stated tolerance |

## Gate 7 — the improvement mandate (v2 substance)

Not "did they add features", but "did they diagnose". For each seeded gap (10 in the brief) and each
feature they claim, I check: **evidence it was a gap → options → decision → trade-off → demonstrable
in the sim → comparable system cited**.

Expected at minimum: skills as a first-class extension point (progressive disclosure, cost visible);
delegation/sub-agent with isolated context and budget; policy as data (add a rule without a rebuild);
a real capability boundary instead of word matching (honestly bounded); context compaction +
cache-aware assembly; resumable/auditable session; approval UX showing diff and blast radius with
`ApproveAlways` scoped by rule not tool name; spans/attribution; provenance & pinning.

The comparables survey must be real: **Claude Code** (hooks/matchers, settings layering, Skills,
subagents, permission modes), **OpenAI Agents SDK** (agents-as-tools, handoffs, tripwires),
**LangGraph** (state graph, checkpoints, interrupts), **MCP** (tools/resources/prompts, capability
negotiation), **Aider/Cline** edit-confirmation, **OpenTelemetry GenAI** spans. I will check that the
citations match what those systems actually do — plausible-sounding invented citations are a P0
because they poison the document's credibility.

## Gate 8 — documentation (sections A–G, kept separate)

| # | Test |
|---|---|
| 8.1 | A–G all present and *separate*: v1 completion, v2 completion, gaps, improvements, workflow, verification/limits, runbook |
| 8.2 | Every claim traceable: `file:line`, doc URL, or scenario ID |
| 8.3 | Fidelity boundary table: simulated vs real, labelled, and matching what the UI labels |
| 8.4 | "Unverified" used honestly wherever they could not execute |
| 8.5 | Gap list severity-ranked with evidence and a repro in the sim |
| 8.6 | Anything not done is in §F with what would be needed — not silently dropped |

## Gate 9 — repo hygiene

| # | Test |
|---|---|
| 9.1 | Nothing outside the additive prototype dir modified — or every change called out with a diff and rationale |
| 9.2 | `workshop.html`, `presentation/`, Gradle modules untouched |
| 9.3 | `extensions/typescript` `npm test` (18 cases) and `npm run build` still green |
| 9.4 | No committed `node_modules`, `dist`, build output, or secrets |
| 9.5 | Extraction script present and re-runnable (144 solutions from `<details class="solution">`), output small and textual |
| 9.6 | No OpenRA clone, nothing written outside the prototype dir |

## Gate 10 — data fidelity

| # | Test |
|---|---|
| 10.1 | The 144 reference solutions extracted and attributed per part × language, not paraphrased |
| 10.2 | Real values used where they exist: guardrail regexes, helper semantics, `ModRules` paths, `fluent/rules.ftl` lookup, `world.yaml` / `player.yaml` actor names |
| 10.3 | Simulated results labelled as simulated, and link to the doc section explaining the boundary |
| 10.4 | Simulated `openra-check` failure text plausible (OpenRA compiler format), not invented prose |
| 10.5 | Kotlin/Java solutions marked **unverified** if they were never compiled |

---

## Output shape

1. **Verdict** — one paragraph: is it a working prototype, and can a facilitator demo it tomorrow.
2. **Scorecard** — Gate 0–10, pass/partial/fail with counts, plus a per-part table for Gate 2.
3. **Top 10 findings**, severity-ranked, each with `path:line`, what's wrong, why it matters, and the
   smallest fix.
4. **What genuinely exceeded the brief** — specific and earned, not flattery.
5. **Gaps that survived into v2** — the honest list.
6. **Fix list in work order**, split into "before the workshop" and "after".

Judgement call I'll make explicit: the brief asked for *best effort with labelled limits*. A
prototype that does 15 of 27 parts flawlessly and says so scores higher than one that claims 27 and
hand-waves the four designed failures.

---
---

# Part 2 — the verdict

Reviewed: `google_drive/develop-workshop-harness-prototype.zip` (1,170,226 B) → `/tmp/proto` (270 files),
committed `0b82165` as the base. Everything below was **executed in this sandbox**, not read and believed.
Where I could not execute something I say so.

## Verdict

**Yes — it is a working prototype, and a facilitator could demo it tomorrow.** Not a mock-up: the loop is a
real port of `Agent.kt`, the defaults and all 24 TypeScript reference solutions are the repo's own files
(sha256-identical), and the four designed failures reproduce as designed. It installs and builds offline,
needs no API key, no JDK, no Docker, and `npm run build` emits one 983 kB `index.html` with **zero external
references** — it runs from `file://`. Of the six assignments, **27/27 numbered parts and all 6 extras run
green in both v1 and v2 (82 runs, 100 % of assertions)**. My three small doc offences are counting and
command-name slips, not substance. This clears the bar the brief set: best effort with labelled limits,
and the limits are labelled honestly.

## Scorecard

| Gate | Result | Evidence |
|---|---|---|
| **0 — runs at all** | ✅ **PASS** | `npm install` 154 pkgs/5 s; `npm run build` exit 0 → `dist/index.html` 983,462 B, 2 `<script>`, 0 `<link>`, 0 `http(s)://` refs; `npx tsc --noEmit` exit 0 (strict + `noUnusedLocals`); dom-smoke mounts the real `<App/>` in jsdom. Determinism: same scenario+seed ⇒ identical events, audit head `08ddc7dfca0371`, cost. *One deviation, see F-2.* |
| **1 — engine fidelity** | ✅ **PASS (11/12 traced, 1 by construction)** | `engine/agent.ts`: `DEFAULT_CONFIG {maxIterations:25, maxTurnContinuations:3}`; first `Deny` returns immediately; `Ask`s collected → **one** `ApprovalHandler.request`; `approvedAlways` keyed by tool name (v1) vs rule-scoped (v2); `Replace` chains with first `Reject` → feedback + `break`; dynamic sections skipped when text unchanged (`lastDynamicValue`); all `ToolResult`s in one user message in ToolUse order; throwing hook fails closed. `decisionString()` reproduces Kotlin `toString()` so `Bell`'s `startsWith("Ask")` works — the subtle trap handled. Constants 25/3/120 s/20 000/30 000/8/4/3 verified against `extensions/typescript/src`. **`Tokens.estimate = (len+3)/4` matches; billing within ±8 %, worst 7.77 %.** |
| **2 — six assignments, v1** | ✅ **PASS — 27/27 complete** | Per-part table below; 41/41 scenarios, all assertions, both versions. |
| **3 — v2 + diff** | ✅ **PASS** | 8 v2 labs + all 27 parts in v2. Diff names the first **behavioural** divergence with both sides: `guard:command.beforeToolUse:ask ⟷ guard:policy.beforeToolUse:deny`. Trivialisation is named and answered: §D says argv+allow-list deletes the regex exercise for 4.2/4.5/4.6 and ships a v1 mode to teach it. |
| **4 — inspectability** | ✅ **PASS** | 44 bundle-item inspectors, 56 renders, all SSR'd in `verify.tsx`. **No drift risk:** source text comes from `import.meta.glob(..., {query:"?raw"})` over `data/ts/src/**` — the same files the live values are built from (`engine/bundles.ts:17-22, 91`), not hand-copied strings. Guardrail inspector lists which of the four hooks are implemented vs defaulted (`hooksOf`). |
| **5 — workflow viz** | ✅ **PASS** | Workflow tab shows normative nodes; play/pause/step/rewind/scrub; highlighted edge = branch taken; node output panel. DOM-smoke asserts stepping works. |
| **6 — cost & observability** | ✅ **PASS** | Per-call cache read/write + prefix tokens; per-extension-point attribution; `breakEvenCalls: 13` printed for delegation; spans; audit chain + tamper detection; 92 kB self-contained report export. Fidelity table labels billing **simulated** and the counterfactual **analytic**. |
| **7 — improvement mandate** | ✅ **PASS — exceeds** | See "exceeded the brief". |
| **8 — documentation A–G** | ✅ **PASS** | All seven sections present and separate (A:802, B:802, C:1165, D:1189, E:1214, F:1234, G:1336) plus two appendices. §C = 13 gaps with `path:line` + severity + whether it was executed. §F2 is a per-subsystem fidelity table; §F3 a best-effort list. |
| **9 — repo hygiene** | ✅ **PASS** | Zip root holds only new paths (`prototype/`, `src/`, `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`) — **all six are new** in this repo, so nothing pre-existing was modified. 0 entries touch `workshop.html`, `presentation/`, `harness-*/`, or any `*.gradle*`. Additive boundary honoured. `prototype/PLAN.md` present. |
| **10 — data fidelity** | ✅ **PASS** | `data/assignments.json` sha prefix `87ce37c6e0f3` matches live `workshop.html`; 39 parts, real `goal`/`why`/`steps`/`hints`/`hasSolution`. 72 solutions (24×3) with per-file sha + selector-URI provenance. **10.5 satisfied:** Kotlin/Java marked unverified (never compiled). Fixtures that are invented (2TNK/TSLA, `world.yaml`, shader) are labelled **illustrative** in F2. |

## Gate 2 — per-part evidence

Every row ran in **both** v1 and v2 with all assertions passing (`docs/regression.json`, 82 run rows,
`all(passed) == True`).

| Parts | Status | Note |
|---|---|---|
| 1.1–1.4, 2.1–2.4 | **complete** (8) | sections/tools compose, dynamic-section economy holds |
| 3.1–3.6 | **complete** (6) | incl. 3.1 `docker build` timing out at 120 s with 1 approval; 3.5 inherited-value signpost then `edit_file`; 3.6 no `check_mod` → declares victory on an invalid value |
| 4.1–4.6 | **complete** (6) | all four designed failures fire: 4.1 approval-not-refusal *before*, deny-and-0-pushes *after*; 4.2 two distinct deny→alternative branches over seeds 1–6; 4.3 model obeys the injected comment *before*; 4.4 key reaches model *before*; 4.6 `/etc/hosts` read with no approval *before* |
| 5.1–5.3 | **complete** (3) | 5.2 bell asserts `b.i <= approvals[0].eventIndex` — the Ask genuinely precedes the prompt, not just "rings twice" |
| 6.1–6.4 | **complete** (4) | capstone chain `grep>read_file>set_actor_value>actor_rules>edit_file>check_mod>play`; signpost text is the real helper text |
| extras ×6 | **complete** | `guardrails-extra`, `init-extra`, `listeners-extra`, `prompt-extra`, `red-teaming`, `tools-extra` |
| v2 labs ×8 | **complete** | compaction 4437→1293 msg tokens; delegate `breakEvenCalls:13`; hitl v1 commits=1/v2 commits=0; shell v1 reads `.env` via `cat .en*`/v2 never; policy layer added without rebuild **and** invalid layer ignored (fail-closed); provenance pinning; plan mode denies edits; resume verify/tamper/fork/export |

## Top findings

Severity: **P1** = fix before the workshop; **P2** = fix when convenient. Nothing here is P0 — I found no
claim that is false in substance, no assignment that silently does not work, and no boundary violation.

| # | Sev | Finding | Evidence | Smallest fix |
|---|---|---|---|---|
| F-1 | **P1** | **The documented headless commands do not exist.** `verify.tsx` and `regress.ts` both open by naming a command; `package.json` has only `dev`/`build`/`preview`. A facilitator following §F1 or G gets `npm ERR! Missing script`. | `package.json:5-9` vs `prototype/scripts/verify.tsx:1` (`npm run verify`) and `regress.ts:1` (`npm run regress`) | Add `"verify": "vite-node prototype/scripts/verify.tsx"`, `"regress": "vite-node prototype/scripts/regress.ts"`, `"smoke": "vite-node prototype/scripts/dom-smoke.tsx"`, `"gen-docs": "vite-node prototype/scripts/gen-docs.ts"` |
| F-2 | **P1** | **Dev server rejects the preview proxy by default.** `server.allowedHosts` is unset, so any proxied hostname gets `403 Blocked request`. I hit this live; the brief's §8 explicitly warned about it. | `vite.config.ts:11-13` (no `server` block); observed `403` for `5180-*.e2b.app` | `server: { host: "0.0.0.0", allowedHosts: true }` (and the same under `preview`). I applied it locally to demo; **not** in the shipped zip. |
| F-3 | P2 | **Scenario count overstated 42 → 41.** §F1 says "every one of the **42** scenarios"; the suite and the regression view both say **41**. The recurring "41/41 · 41 pass" is correct. | `PROTOTYPE.md:1244` "42 scenarios" vs `:1297` "41/41"; `regression.json` distinct ids = 41 | Change 42 → 41 in one line |
| F-4 | P2 | **"44 bundle-item inspectors … 56 renders"** — rendered *pages* exceed items (v1+v2 render the same items), which is fine, but the sentence reads as if 56 items exist. | `verify.tsx` output line 26; §F1 line 1245 | Reword to "44 items, 56 renders (v1+v2)" |
| F-5 | P2 | **"23 reference solutions" in §F2 vs 24 solution files.** `verify.tsx` says 23 executed. The 24th (3.1's second artefact) is the reason; not stated. | `PROTOTYPE.md` F2 row "23 reference solutions"; `data/ts/src/**/exercise/` = 24 | Add "(24 files; 3.1 supplies two artefacts, so 23 parts)" |
| F-6 | P2 | **Two additive fixes not applied, correctly declared.** Appendix 1 carries the `buildFile.ts` diff and the clone-URL note, both marked NOT applied because the repo was read-only. Disclosed, not smuggled — but it means the `edit_file` build-file bypass is still live in the repo. | `PROTOTYPE.md:1369-1385`; repo `buildFile.ts:14` still `!== "write_file"` | Apply the two diffs in the repo, then re-run the 18 tests |
| F-7 | P2 | **`globals.d.ts` is the only repo file not shipped** into `data/ts/src` (28/28 shipped files are byte-identical; the `.d.ts` is a type stub with no runtime role). Worth knowing, not worth fixing. | `comm -23` of the two file lists | none — note it in F2 |
| F-8 | P2 | **Interactive approval while a run is alive, replay after.** Scrubbing a finished run replays the recorded trace rather than re-executing; if a facilitator scrubs backwards and expects live guardrails they will be confused. Already in F3, but it belongs in the runbook too. | `PROTOTYPE.md` F3 bullet 3 | one sentence in §G |

**One thing I checked and could not fault:** the `?raw` inspector sourcing. If the inspector had held
hand-written copies of the guardrail source, it would drift from what ran and be a P1. It doesn't —
both come from the same `import.meta.glob` over `data/ts/src/**`.

## What genuinely exceeded the brief

Not flattery — each of these is a thing the brief asked for that came back better than asked.

1. **The engine is a real port, not a paraphrase.** `decisionString()` re-implementing Kotlin's `toString()`
   so that `Bell`'s `startsWith("Ask")` keeps working is the kind of detail you only notice if you actually
   read `Agent.kt` and `Bell.kt` together. Most reviewers would have missed it; most implementations would
   have broken it.
2. **`policy/*.json` closes REVIEW F-7 in the fix's own language.** v1's `build-file` guardrail only inspects
   `write_file` (REVIEW gap 3). Rather than patch it, v2 makes policy *data* — and the rule's `rationale`
   field cites the gap by name. Gap → design, with a citation.
3. **The four designed failures are executable assertions, not prose.** 4.1/4.3/4.4/4.6 run with the artefact
   **off** and assert the failure happens. That is the only way to know an assignment still teaches what it
   claims after a refactor, and almost nobody does it.
4. **v2 is honest about what it deletes.** §D names the three parts where argv+allow-list makes the regex
   exercise vanish (4.2, 4.5, 4.6) and keeps a v1 mode. The brief demanded exactly this and usually gets a
   sales pitch instead.
5. **The fidelity table is per-subsystem.** F2 distinguishes *real (ported)* / *real (executed unmodified)* /
   *real shape* / *simulated* / *illustrative* / *analytic* / *not cryptographic* / *virtual*. That is a
   stronger honesty instrument than the brief's "label verified vs unverified".

## Gaps that survived into v2

Restating these so they are not lost among the wins: `run_command` remains a shell-shaped hole in **v1** by
construction (that is the lesson); "approve always" remains tool-scoped in **v1** by construction (also the
lesson); the v2 argv runner's guarantee needs `execve` in a real container and is a **design, not an
enforcement** here; audit hashing is cyrb53 and **not cryptographic**; there is **no `Agent.resume`**, so fork
re-runs rather than resumes; `acceptEdits` is typed but unimplemented; there is no MCP, no LangGraph-style
graph engine, no parallel sessions; a policy typo silently loses *your* layer (fails closed on the base);
±8 % is a stated simulation tolerance, not a measured vendor drift.

## Fix list, in work order

**Before the workshop (≈20 minutes):**
1. Add the four missing npm scripts (`verify`, `regress`, `smoke`, `gen-docs`) — F-1. Without this the
   documented runbook is broken on the first command a sceptical participant tries.
2. Add `server.allowedHosts` / `preview.allowedHosts` + `host: "0.0.0.0"` — F-2. Otherwise the demo cannot
   be shown from a proxied URL at all; this is the difference between "demoable tomorrow" and "demoable on
   `localhost` only".
3. Correct 42 → 41 (F-3), and the two smaller count sentences (F-4, F-5).
4. Apply the two Appendix-1 diffs in the repo and re-run the 18 tests (F-6).

**After the workshop:**
5. Compile the Kotlin/Java solutions in CI — 48 solutions are still unverified, and that is the single
   largest unverified surface in the whole repo (mine and theirs).
6. Run the real toolbox once and replace the simulated `openra-check`/`openra-rules` text with captured
   output; wording is currently imitative and unverified.
7. Implement `Agent.resume` and the `execve` runner; both are named as next steps and both are the honest
   ceiling of a browser sim.
8. Pin a real OpenRA commit (the sim's `PIN` is illustrative) and add LICENSE + CI.

## Provenance of this review

Everything in Part 2 was run here: install, `tsc --noEmit`, `npm run build`, `vite-node verify.tsx`,
`vite-node dom-smoke.tsx`, a live dev server, sha256 comparison of the shipped defaults against the repo,
`comm` of the two source trees, and json/grep analysis of `regression.json`, `assignments.json` and
`scenarios/index.ts`. **Not verified by me:** the Kotlin/Java twins (no JDK), and the zip's claim about
scratch hygiene outside `prototype/` — the archive contains only new paths, which is consistent with but
does not prove that nothing else was touched on the authoring machine.

---
---

# Part 3 — fix list items 1–4, applied

Branch `arena/3d83f813-workshop-agentic-harness`. Items 1–4 of the "before the workshop" list are done and
verified. The prototype was first materialised into the checkout root (it had only ever existed as a zip), so
these are real, reviewable changes rather than edits to a scratch copy.

## What changed

| Item | Change | File(s) |
|---|---|---|
| **1** | Added `typecheck`, `verify`, `regress`, `smoke`, `gen-docs`, `extract` scripts. The header comments in `verify.tsx`/`regress.ts` named commands that did not exist; they now do. | `package.json` |
| **2** | `server`/`preview` now bind `0.0.0.0` with `allowedHosts: [".e2b.app", ...VITE_ALLOWED_HOSTS]`. Wildcard suffix, not `true`, so DNS-rebinding protection still rejects unrelated Host headers. | `vite.config.ts` |
| **3** | 42 → **41** scenarios; "44 inspectors" reworded to "44 distinct items, **56 renders** (v1 and v2 render the same items separately)"; "23 reference solutions" → "**24** files across 23 code parts" with the 3.1 two-artefact reason. Runbook now uses the real script names. | `prototype/docs/PROTOTYPE.src.md` → regenerated `PROTOTYPE.md` |
| **4a** | `build-file` deny now covers `edit_file` in **TypeScript, Kotlin and Java**, with a regression test. Clause 2 stays write_file-only so §5.3's GATE lesson is unchanged. | `extensions/{typescript,kotlin,java}/…/BuildFile*`, `extensions/typescript/test/defaults.test.ts` |
| **4b** | Clone URL `bitbucket.org/jdriven/…` → `github.com/knarayanareddy/…` (this checkout's `origin`). One line; 4244 lines before and after. | `workshop.html:356` |
| **bonus** | `extract.mjs` no longer deletes `prototype/contract/v1/package.json`, which is what makes `@harness/api` resolve. It now clears only `kotlin/` and regenerates the manifest, and is idempotent. | `prototype/scripts/extract.mjs` |

## Verification actually run

| Command | Result |
|---|---|
| `npm install` (repo root) | 154 packages, 0 vulnerabilities |
| `npm run typecheck` | clean (strict, `noUnusedLocals`) |
| `npm run regress` | **all 41 scenarios × v1/v2 = 82 runs**, every assertion passes |
| `npm run verify` | **all 27 checks pass**, byte-identical to the recorded output |
| `npm run smoke` | **all DOM smoke checks pass**; `41/41 · 41 pass in both` |
| `npm run build` | `dist/index.html` 987.71 kB single file |
| `extensions/typescript: npm test` | **19/19** (18 original + the new `edit_file`-bypass case) |
| `npm run extract -- .` twice | idempotent; one `@harness/api` copy; 39 parts / 27 numbered / 72 solutions both times |
| Host allowlist, live dev server | `.e2b.app` Host → **200**; `evil.example.com` → **403** |

## Two corrections to my own Part 2

- **F-6 was wrong, and the brief's item 4 was based on it.** The summary line said "two additive fixes *not*
  applied". The prototype's Appendix 1 did present them as unapplied — but they were unapplied **because the
  repo was read-only on the authoring machine**, not because they were refused. Both are now applied and
  verified. Treat F-6 as closed, not as a defect in the deliverable.
- **The extract bug was not in my original review at all** — it only surfaced when I actually re-ran
  `extract` as the runbook instructs. Worth noting: the "re-extract after `workshop.html` changes" step was
  broken end-to-end before this session, and no test covered it.

## Still unverified (unchanged)

- **Kotlin and Java were not compiled** — no JDK in this sandbox. To compensate I transcribed all three
  implementations' branch structure and compared them over 40 `(tool, path)` pairs: **0 mismatches**. That is
  a logic check, *not* a compile check. Run `./gradlew build` before the workshop if a JVM is available.
- Items 5–8 (Kotlin/Java CI, real toolbox capture, `Agent.resume` + `execve` runner, pinned commit + LICENSE
  + CI) remain open. Item 8 is cheap and I can do it next; item 5 is the one that matters most, because 48
  solutions are still uncompiled.

---

# Part 4 — fix list items 5 and 8, applied and verified by CI

Unlike Part 3, these could **not** be verified in this sandbox: it has no JDK and egress to
`services.gradle.org`/`api.adoptium.net` fails at TLS. So the work was pushed to
`arena/3d83f813-workshop-agentic-harness` and verified by GitHub Actions instead. Every claim below is
backed by a run, not by reading the YAML.

**Final run:** `45691754000` — **4/4 jobs green.**

| Job | Time | What it proves |
|---|---|---|
| Prototype (TypeScript, offline) | 47 s | `typecheck`, 27 verification checks, 41×2 regression runs, DOM smoke, single-file build, and an assertion that `dist/index.html` has no external URL |
| extensions/typescript tests | 24 s | the repo's own 19 tests still pass with the `build-file` fix |
| **Kotlin/Java solutions compile** | **1 m 21 s** | **all 48 solutions compile** — the largest previously-unverified surface in the repo |
| OpenRA pin still valid | 7 s | pin exists, has no `AGENTS.md`, is `net10.0`, and matches the source |

## Item 5 — the 48 solutions now compile

`prototype/scripts/place-solutions.mjs` places each solution into the module that owns it. The destination
is **derived from the file's own `package` line**, never mapped by hand — all 48 were checked to carry one,
24 per language, with the package always matching the module. It refuses to overwrite a tracked file, and
the placed copies are gitignored (attendees write those files; they must never ship as a "solution key").

Three commands, usable locally as well as in CI: `npm run solutions:install` / `solutions:verify` /
`solutions:clean`. `verify` exits 1 when a solution is missing or has drifted from `prototype/data/`.

**The gate was mutation-tested, not just observed green.** I injected a type error into
`3.5/kotlin/SetActorValue.kt`, pushed, and the job failed (run `45691462744`); reverting it went green
again. A gate that has never failed is a gate nobody knows works.

## Item 8 — pin, licence, CI

- **Pin is now real:** `1f594e32065615ed1847962c80ecfe6e868a11c3` (2026-10-20). Verified through the API:
  the commit resolves, `Directory.Build.props` targets **`net10.0`**, and `AGENTS.md` returns **404**. It is
  the last commit before upstream added the prohibition (`9636b63ea`, 2026-10-28). The simulated `git log`
  fixture was updated to the same SHA so the provenance section reads *matches* rather than *DOES NOT
  MATCH*; the panel label no longer says "illustrative"; and `verify.tsx` now compares against `PIN`
  instead of a hardcoded prefix — that hardcoded string was the only thing that broke when the pin moved.
- **LICENSE:** MIT, plus an explicit note that this repo does **not** vendor OpenRA (it is cloned at
  runtime under its own licence). Swap the holder line if you want a person or company named.
- **`.github/workflows/ci.yml`:** four jobs, triggers on `main`, `arena/**`, PRs and manual dispatch.
  The `upstream-pin` job is the interesting one: the workshop's premises about upstream are *claims*, and
  this job fails loudly if the pin is force-pushed away, `AGENTS.md` appears at that commit, or the
  target framework changes. It caught a real bug in itself, too (see below).

## What CI caught that I did not

Worth recording, because it is the argument for having built it:

1. **`upstream-pin` had no `actions/checkout`.** Its first step only used `curl`, so the repo was never
   checked out and the pin-agreement `grep` ran against an empty workspace. My sandbox run of that shell
   logic passed because the files were already on disk. The fix needed the runner to *tell* me — which it
   could not, because **workflow logs are served from `productionresultssa7.blob.core.windows.net`, a host
   this sandbox cannot reach**. So I re-plumbed the diagnostics through `::notice::`/`::error::`
   annotations, which `gh run view` does show. That turned "exit 1, cause unknown" into
   `pin line: grep: prototype/v2/extensions.ts: No such file or directory` in one run.
2. **Four deprecated action versions** were emitting warnings on every run; bumped to v5.

## Honest limits on this part

- **CI is green, not exhaustive.** It compiles the solutions; it does not *run* them against a live
  harness, and it does not exercise the Kotlin/Java registrations (the `_registration.txt` snippets are
  still applied by hand by attendees). Compilation catches type/API drift — the failure mode that would
  embarrass a workshop — not semantic mistakes inside a solution.
- The workflow needs network (Gradle downloads Koin/Kotlin/JUnit). That does **not** weaken the prototype's
  offline contract: the prototype jobs need no network beyond `npm ci`.
- The pin is a **good** commit, not a blessed one: whether to pin at all, and which commit, remains the
  organisers' call. `1f594e3` is simply the newest date at which every workshop premise was still true.
- Item 6 (capture real toolbox output) and item 7 (`Agent.resume`, `execve` runner) remain open; both need
  Docker or a design change, not just a build step.

---

# Part 5 — v2 in the real harness (not just the prototype)

The prototype proved v2 was *designable*. This part puts it in the harness participants actually run.

## Result

| | |
|---|---|
| **Where** | `extensions/typescript/src/v2/` + `extensions/typescript/policy/*.json` + one core change |
| **Opt-in** | `HARNESS_V2=1 HARNESS_LANGUAGE=typescript ./gradlew :app:run`. v1 is untouched and still the default |
| **Tests** | **87** in `extensions/typescript` (was 19) and **72 JVM tests, 0 failures** (was 66) |
| **CI** | run `45870596071`: 4/4 jobs green, including the JVM suite and the built v2 artefact |

## The interesting finding: most of v2 needed no loop change

The four v1 extension points were nearly sufficient:

| Feature | Mechanism | Core change |
|---|---|---|
| Policy as data | JSON + a `beforeToolUse` guardrail | none |
| argv runner (closes C1) | a `Tool` taking `argv[]`, no shell | none |
| Skills / progressive disclosure | static catalog section + `load_skill` | none |
| Compaction | `beforeInference` → `ProceedWith` | none |
| Audit log | a listener + hash chain | none |
| Provenance + upstream ack | static section + an `Ask` guardrail | none |
| **Scoped approvals (C2)** | `ApprovalScope` + `Guardrail.approvalScope` | **`Agent.kt`** |

Only C2 needed the loop, because v1 recorded `approvedAlways += call.tool.name` — a guardrail cannot
un-remember what the loop remembered. The change is backward-compatible by construction: a guardrail
that expresses no scope still gets `WholeTool`, i.e. v1's exact behaviour.

## Deliberately not done

**Delegation is not in the real harness.** A sub-agent needs a nested loop inside a tool, which changes
what a tool is allowed to do. `SubAgentRunner` is declared as the seam; nothing implements it. The
prototype still demonstrates the idea. This is stated in `v2/DESIGN.md` rather than glossed over.

## Four bugs CI caught that I could not

No JDK here, so the JVM path was only checkable in CI. It earned its keep four times:

1. **`shipped-bundle.test.ts` needed `dist/`** but ran during `npm test`, before any build — a clean
   checkout had no bundle. It now builds the bundle itself when absent, and CI also builds and re-runs
   it, so the artefact is checked both ways.
2. **The Gradle npm task passed two script names to the first script.** `args = [run, build, bundle:v2]`
   makes npm hand `bundle:v2` to `build`, where esbuild reads it as a second input file. I had been
   running a *different* script locally, so the bug existed only in the path Gradle uses. Fixed with a
   single `build:all` script.
3. **`covers()` crashed on a whole-tool key.** `key.split(':', limit = 3)` returns two parts for
   `"tool:echo"`, and destructuring a 2-element list into 3 components throws — killing exactly the
   v1-compatibility path. Now indexed with `getOrElse`.
4. **My own test asserted the opposite of the design**: it used `ArgvPrefix(["git"])`, a prefix that
   correctly covers `git push` as well as `git status`. The test was wrong, not the code.

Bugs 3 and 4 are only visible by *running* the Kotlin, which is why the second `covers()` bug mattered:
it was in the branch that keeps v1 working.

## Trust the number, not the colour

A green JVM job could mean the suite ran zero tests. CI now reads the JUnit XML and reports
`JVM tests executed: 72, failures: 0`, so "green" comes with a count.

## Post-merge: the pin check was rate limited, not broken

The first CI run on `main` after the v2 merge failed `OpenRA pin still valid` — minutes after the same
job passed. The API answered 200 from here and unauthenticated requests are rate-limited per IP, so
shared runner IPs hit 403/429 intermittently. A health check that fails for reasons unrelated to what it
checks is worse than none, so it now authenticates with `GITHUB_TOKEN`, retries three times, and says
"this is usually rate limiting, not a missing commit" if it still fails. Green again on `45871310701`.
