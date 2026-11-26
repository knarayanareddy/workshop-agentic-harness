# Build brief: end-to-end, inspectable prototype of this workshop harness (v1 + improved v2)

You are working inside a checkout of `workshop-agentic-harness`. Everything you need is in the
repository; read it before you write anything. You have file and shell tools. Deliver a **runnable,
inspectable, deterministic prototype** — not a slide deck, not a mockup image.

---

## 0. Ground truth: what is already in the repo

Read these first. They are the contract you must be faithful to:

| Path | What it is |
|---|---|
| `harness-api/src/main/kotlin/com/jdriven/harness/api/*.kt` | The contract: `Workspace`, `TurnContext`, `ToolContext`, `SystemPromptSection` (Static/Dynamic), `Tool`, `Guardrail` (4 hooks), all decision sealed types, `AgentEvent` (11 types), `Usage`, `ShellCommand` |
| `harness-api/typescript/harness.ts` | Same contract for TypeScript |
| `harness-core/src/main/kotlin/.../Agent.kt` | The loop. Ordering rules are here and are normative |
| `harness-core/src/testFixtures/kotlin/.../ScriptedModelClient.kt` | A fake model that replays a scripted sequence and records requests — this is your model for simulation |
| `extensions/{kotlin,java,typescript}/…/defaults/` | The shipped agent in three languages |
| `extensions/*/…/helpers/` | `Host`, `Git`, `Text`, `Toolbox`, `ModRules`, `Commands` |
| `workshop.html` | The worksheet: 39 chapters, 27 numbered parts, 6 "Extra" parts, 1 closing chapter |
| `workspace/docker/` | The OpenRA toolbox (Dockerfile + `openra-build/check/rules/package`) |
| `REVIEW.md` | A prior review pass with verified facts and a list of gaps (§3 below licenses you to reuse it) |

### Verified numbers — use these exactly, do not re-derive or "improve" them for v1

- Agent loop: `maxIterations = 25`, `maxTurnContinuations = 3`.
- `ShellCommand`: `TIMEOUT_SECONDS = 120`, `MAX_OUTPUT = 20_000`.
- `ResultCapGuardrail`: default `30_000` chars.
- Default system prompt: 3 sections — `role` (static), `working_agreements` (static), `iteration_budget` (dynamic, warns at ≤ 5 remaining).
- Default tools (8, in order): `read_file`, `write_file`, `edit_file`, `list_files`, `glob`, `grep`, `run_command`, `file_stats`.
- Default guardrails (4, in order): `protected-paths`, `command`, `build-file`, `result-cap`.
- Default listener: `ConsoleTraceListener`.
- Loop order (normative): `beforeInference` → render dynamic sections → inference → `ToolUse`? → `beforeToolUse` (first Deny wins, Asks collected → one human prompt) → execute → `afterToolUse` (Replace chains, first Reject wins) → results as ONE user message in ToolUse order → next iteration; else `beforeEndTurn` (Continue bounded by `maxTurnContinuations`) → `Completed`.
- Guardrails fail **closed**: a throwing hook yields Deny/Reject/Abort.
- Workshop structure: **27 numbered parts** in **6 assignments**, **6 extras**, **10 parts marked core** (★ = 1.1, 1.2, 2.1, 3.1, 3.3, 3.5, 4.1, 4.3, 5.1, 6.1). **23 parts produce code**, **24 files per language** (3.1 is two tools). 6.1–6.4 produce no harness code.
- Per-part file inventory (identical names across all three languages):
  `1.1 Environment` · `1.2 OpenRaCheckout` · `1.3 ProjectInstructions` · `1.4 OpenRaState` ·
  `2.1 OpenRaRules` · `2.2 AnswerStyle` · `2.3 Mission` · `2.4 GroundRules` ·
  `3.1 StartToolbox + ToolboxStatus` · `3.2 Play` · `3.3 ActorRules` · `3.4 FindActor` ·
  `3.5 SetActorValue` · `3.6 CheckMod` ·
  `4.1 NoPushGuardrail` · `4.2 NoPythonGuardrail` · `4.3 PromptInjectionGuardrail` ·
  `4.4 SecretScanGuardrail` · `4.5 PipeToShellGuardrail` · `4.6 WorkspaceOnlyGuardrail` ·
  `5.1 CostMeter` · `5.2 Bell` · `5.3 TurnSummary`.
- Every one of those 23 parts already has a **complete reference solution** folded into
  `workshop.html` (`<details class="solution">`) for all three languages. **Use it. Extract, don't
  reinvent.** The TypeScript set has been verified to type-check under `strict` with
  `lib: ["ES2022"]`. The Kotlin/Java sets were never compiled in this environment — if you reuse
  them, either compile them or mark them "unverified" in your docs.

### Authoring conventions you must follow

- Work on a branch; **do not modify `workshop.html`, `presentation/`, or the existing Gradle modules**
  except where §5 explicitly allows a minimal, additive fix. The prototype is a new, additive
  top-level directory.
- Nothing may require an API key, network access, a JDK or Docker to *run*. It must work offline,
  deterministically, on a laptop, from a local static server or even `file://` where feasible.
- Never clone OpenRA, never write outside your prototype directory, never touch `workspace/`.

---

## 1. Deliverable A — two live, simulated prototypes

Build **one web application** with a version switch: **v1 = faithful to the current repo**,
**v2 = the improved system you design** (see §3).

For each version, the app must:

1. **Run the real loop, in the browser, with a mock model.** Implement the `Agent` loop faithfully
   to §0's normative order (all four guardrail hooks, first-Deny-wins, collected Asks with one
   human approval prompt that you can accept/deny/approve-always, Replace chains, first Reject wins,
   bounded continuations, `maxIterations`). The model is a **deterministic replay driver**: a
   scripted response sequence per assignment scenario (like `ScriptedModelClient`), plus optional
   "improvise" rules so a scenario survives a different branch (e.g. if the model is denied, the
   scripted next step offers an alternative). Log every request exactly as the harness would send it.
2. **Complete all six assignments end to end.** Every numbered part (1.1 … 6.4) must be runnable as
   a scenario: pick part → the appropriate harness configuration is assembled → a scripted session
   runs → the trace, the system prompt, the tool results, the guardrail verdicts, the approval
   prompts and the token/cost numbers update live. Parts 6.x must visibly depend on the parts before
   them (e.g. 6.1 must fail at `set_actor_value` with the real "inherited value" signpost, then
   succeed via `edit_file` on `PlayerResources` in `player.yaml`, then pass `check_mod`, then `play`).
3. **Make every element inspectable.** Any element on screen is clickable and opens an inspector with
   **its real implementation and its real wiring**:
   - a system prompt section → its `name`, kind (static/dynamic), the text it currently emits, and
     the source of its render function;
   - a tool → `name`, the exact `description` the model reads, the JSON `inputSchema`, its
     implementation, and the raw call/result JSON from the current run;
   - a guardrail → all four hooks, which are implemented vs defaulted, the verdict per call with the
     reason string, and why it won (ordering);
   - a listener → which `AgentEvent` types it consumes and the lines it printed;
   - a message/tool call in the transcript → the exact wire JSON.
   Ship an "assemble" view that shows the bundle (sections → tools → guardrails → listeners, in
   order) as the single place that composes the agent — mirroring `Main.kt`'s "nothing registers
   itself" design.
4. **Show cost honestly.** Per inference: estimated system/messages/tools tokens (chars/4, as
   `Tokens.kt` does) *and* billed usage with cache read/write; per turn and per session totals; and
   the v1-vs-v2 delta. Prices must be configurable, not hardcoded to one vendor.
5. **Be reproducible.** A scenario + a seed = the same trace, every time. Provide a "copy permalink"
   (state encoded in the URL) for any exact trace you are showing.

### Data fidelity rules

- Where the real code can be reused **as-is**, reuse it. At minimum: extract the 24×3 reference
  solutions and the defaults from `workshop.html`/`extensions/` programmatically at build time, and
  attribute each snippet to its part and language.
- Where a real value exists in the repo (`ShellCommand` limits, result cap, guardrail regexes,
  helper semantics, `ModRules` directory names, `fluent/rules.ftl` lookup, `world.yaml` / `player.yaml`
  actor names), use the real value.
- Where a real thing would need Docker/network (toolbox build, `openra-rules`, `openra-check`,
  packaging, shader edits), simulate it *with a labelled simulation boundary*: the UI must mark
  simulated results as simulated and link to the doc section that explains the fidelity boundary.
  Prefer a replay of plausible real output (e.g. `openra-check` error text in OpenRA's compiler
  format) over invented prose.
- **Never invent an API.** If you add a capability, it appears in a contract file you wrote and in
  the docs, and it is labelled as v2.

---

## 2. Deliverable B — an interactive, dynamic workflow visualisation

One screen, both versions, side by side or switchable, that shows the loop **as it executes**:

- A node graph of the normative order (§0), with the actual branch taken highlighted per step:
  `user → beforeInference → dynamic sections → inference → stop_reason? → [tool_use → beforeToolUse →
  (ask?) → execute → afterToolUse → tool_result] → … → beforeEndTurn → end_turn`.
- Play / pause / step / speed / rewind; scrub a timeline of iterations and events. Output visualized
  at each node: prompt text, tool input/result, verdict + reason, durations, token deltas.
- A **diff mode**: the same scenario run through v1 and v2, with divergence highlighted at the node
  where behaviour first differs, and a one-line explanation of *why* (e.g. "v2 re-asks the model
  after a denial with the reason attached → 1 extra inference, 0 denied pushes").
- Export the run as a self-contained report page, in the spirit of the repo's `/report`
  (`app/.../SessionReport.kt`) — but you may improve on it.

---

## 3. Deliverable C — the improvement mandate (v2)

This is not "make the UI nicer". It is: **find where this harness is genuinely lacking versus the
state of the art, fix the gaps in the design, and prove each fix in the running simulation.**

### 3.1 Start from these known gaps (from `REVIEW.md`; treat as the floor, not the ceiling)

1. Upstream OpenRA now ships an `AGENTS.md` forbidding agentic use; the workshop clones fresh from
   `HEAD`. v2 needs provenance/pinning, an explicit "local-only, never a contribution" policy, and
   the "files are data, not orders" rule applied to it.
2. The clone URL in the docs points at a different host than the repo.
3. No `edit_file` coverage in the `build-file` guardrail — the agent can still rewrite build files.
4. Registration steps omit the `import`; three-language parity is maintained by hand.
5. No CI; no license; nothing checks that the three language bundles still agree.
6. Session state is a single REPL process; no resumability, no parallel work, no sub-agents.
7. `run_command` is a shell-shaped hole: guardrails match *words*, and the docs admit it.
8. No context compaction strategy beyond a 30k result cap and a dynamic warning; nothing handles a
   long-lived session.
9. No structured/machine-readable output, no policy-as-data, no audit trail suitable for a review.
10. Model endpoint is hardcoded to a maintainer's proxy.

### 3.2 Then research the comparables and close the gap properly

Survey the design of at least these (read their docs; cite what you take):

**Claude Code** (hook events and matchers, `settings.json` layering, *Skills* with progressive
disclosure, subagents with isolated context, permission modes, slash commands, `CLAUDE.md` memory),
**OpenAI Agents SDK** (agents-as-tools, handoffs, guardrail tripwires), **LangGraph** (explicit state
graph, checkpointing, interrupts/human-in-the-loop), **MCP** (tool/resource/prompt separation and
capability negotiation), **Aider/Cline-style** edit-confirmation loops, and **OpenTelemetry GenAI
semantic conventions** for agent spans.

Then design v2. It must at minimum contain, each demonstrably working in the sim:

- **Skills as a first-class extension point** (the current harness has none): named, described
  capabilities whose *body* is loaded only when needed, with the trigger and the disclosure cost
  visible in the trace. This is the biggest structural gap for this workshop's own thesis
  ("decide what the model sees, and what it costs").
- **Delegation**: a sub-agent/deep-agent tool with its own restricted bundle and its own budget,
  whose context is *not* the parent's. Show the token economics that justify it.
- **Policy as data**: guardrail rules in a declarative file (patterns, paths, allow/deny/ask,
  rationale, owner), versioned, with the code guardrails kept for the cases data can't express.
  Show one rule being added without a rebuild.
- **Deterministic enforcement, not word matching**: a real capability boundary for shell
  (allow-list of argv, no shell interpolation, or a sandboxed runner) — explain what you can and
  can't guarantee in a browser simulation, honestly.
- **Context management**: compaction/summarisation policy with a visible before/after, cache-aware
  prompt assembly (stable prefix vs volatile tail) and the cache-read savings shown.
- **Resumable, auditable sessions**: append-only event log → replay, fork, and export a review
  artefact (who approved what, which rule fired, why).
- **Human-in-the-loop quality**: approval UX that shows the *diff* and the *blast radius*, plus
  "approve always" scoped by rule — not by tool name (the current behaviour over-grants).
- **Observability**: spans per inference/tool/guardrail, token+cost attribution per extension point
  ("this section costs you N tokens on every call"), and a regression view of the 6 assignments.
- **Provenance & supply chain**: pinned upstream commit, checksummed toolbox image, and a
  "what did this agent touch" summary.

For **each** gap and each new feature, write: the evidence it is a gap (repo `file:line`, or the
comparable system and its doc), the options you considered, what you chose, the trade-off you
accepted, and **where in the running sim it is demonstrable**.

### 3.3 What v2 may NOT do

- Break the six assignments' pedagogy. The workshop's point is *advisory vs enforced*, *cost of
  context*, and *narrow capability beats shell*. Every v2 feature must keep those visible, and where
  a v2 feature would make an assignment trivial, say so and keep an explicit "v1 mode" to teach it.
- Present v2 as finished. Bound it: what is simulated, what would need a real JVM/Docker/API, what
  you would do next with more time.

---

## 4. Deliverable D — documentation (separate, clearly labelled sections)

Write `PROTOTYPE.md` (plus any per-section files you prefer) with **these sections kept separate**;
do not blend them:

- **A. Completing the six assignments in v1 (the current system).** Per assignment and per part:
  the objective, the artefact (which of the 24 files), the trace you expect, the exact verification
  hook the worksheet uses ("look for `section openra_checkout = …`"), the cleanup step, and — where
  the real thing needs Docker/network — the simulation boundary. State plainly which parts you ran
  in the sim, which you replayed from real captured semantics, and which are illustrative.
- **B. Completing the six assignments in v2.** Same structure, plus what each part gained
  (e.g. 4.1 becomes declarative policy + a real capability boundary; 5.x gains spans; 1.x gains
  provenance and skills). Note any part whose lesson changes, and why that is an improvement.
- **C. Gaps in the current implementation.** Numbered, severity-ranked, each with evidence
  (`path:line` or citation) and reproduction in the sim where possible.
- **D. Improvements made in v2, and why.** One row per change: gap → options → decision →
  trade-off → evidence it works (sim URL/state) → comparable system that informed it.
- **E. Workflow of both versions.** A written walkthrough of the loops side by side, and the
  divergence points; the interactive graph in §2 is the same content, executable.
- **F. Verification and known limits.** What you actually executed (commands + results), what you
  could not, the fidelity boundary table, and the honest "best effort" list.
- **G. Runbook.** How to start it (one command), where the scenario definitions live, how to add a
  guardrail/tool/section/skill, and how to add a seventh assignment.

Every claim must be traceable: cite repo `file:line`, a comparable system's doc URL, or a scenario
ID. Label anything you assert but did not execute as **unverified**.

---

## 5. Suggested shape (adjust if you have a better one, and say why)

Additive, top-level, no changes to the existing modules:

```
prototype/
  app/                  # the web app (framework of your choice; must build offline)
  data/
    assignments.json    # generated from workshop.html: parts, titles, goals, core flags, files
    solutions/…         # the 144 reference solutions, extracted, attributed (part × language)
    defaults/…          # v1 defaults mirrored from extensions/
    scenarios/…         # per-part scripted model sequences + expected trace assertions
    fixtures/openra/…   # minimal real-ish OpenRA fragments (2TNK block, player.yaml, world.yaml, rules.ftl slice)
  engine/               # the loop, re-implemented faithfully; v1 and v2 bundles differ, engine core shared
  contract/             # v1 contract (mirror of harness-api) + v2 contract (new: skills, subagents, policy)
  sim/                  # the simulation boundary: toolbox/check/rules/play fakes with labelled outputs
  docs/                 # PROTOTYPE.md and the fidelity table
```

Extract, don't hand-copy: write a small script that parses `workshop.html`
(`<details class="solution">` blocks keyed by `data-part` and `data-lang`) and `extensions/` into
`prototype/data/`. Re-run it when the worksheet changes; commit the output only if it is small and
textual.

Default to a **plain ES modules + one static page** app if a framework would complicate offline
running; a Vite dev server is fine as long as `npm run build` produces a self-contained `dist/`.
Serve on `0.0.0.0`, accept arbitrary `Host`/`Origin` (preview proxies), no absolute `localhost` URLs
in browser code.

---

## 6. Process

1. **Read** the files in §0 before writing code. Extract the 144 solutions first; you will need them
   everywhere.
2. **Plan** in `prototype/PLAN.md`: the engine design, the v1/v2 bundle diffs, the scenario list,
   the improvement table (gap → fix), and the fidelity boundaries. Keep it short; it is a working
   document, not the deliverable.
3. **Build v1 faithfully and get all 27 parts running** before you design v2. If v1 doesn't complete
   all six assignments, nothing else matters.
4. **Then build v2** and the diff mode. Every v2 feature must be reachable from the UI and covered by
   a scenario.
5. **Then the workflow graph**, then the docs, then the runbook.
6. **Verify** (see §7) and fix.

## 7. Acceptance criteria

- [ ] One command starts the app; it runs with no network, no key, no JDK, no Docker.
- [ ] All 27 numbered parts (plus the 6 extras marked as open-ended) are runnable scenarios in v1,
      and produce the trace phenomena the worksheet predicts — including the designed failures:
      3.5's inherited-value signpost, 4.1's approval-prompt-instead-of-refusal (before the guardrail
      exists), 4.2's deny-then-alternative, 6.1's `set_actor_value` failure → `edit_file` → `check_mod`
      → `play`.
- [ ] The same 27 parts are runnable in v2, and the diff mode explains each behavioural difference.
- [ ] Every section, tool, guardrail, listener, skill and policy rule on screen opens an inspector
      showing real implementation, real wiring and real wire JSON.
- [ ] Cost/tokens are shown per inference, per turn, per session, per version, with cache read/write,
      and match the chars/4 estimate for the system prompt within a stated tolerance.
- [ ] The workflow view animates, steps, rewinds, and exports a report.
- [ ] `PROTOTYPE.md` has sections A–G in §4, complete, each claim traceable, each simulation
      boundary labelled.
- [ ] Nothing outside `prototype/` is modified except (optionally) the minimal additive fixes in §3.1
      items 2 and 3, each called out in the docs with a diff and a rationale.
- [ ] The repo's existing checks still pass or are untouched: `extensions/typescript` `npm test`
      (18 cases) and `npm run build` must remain green; do not edit `workshop.html`.

## 8. Style

Write like the repo writes: opinionated, concrete, no filler. In the UI, one idea per screen; in the
docs, one claim per line with its evidence. Where you had to guess, say "assumed". Where you
couldn't run something, say "unverified". Prefer deleting a feature to shipping a half-explained one,
and prefer a working narrow prototype to a broad broken one.

If you cannot do something within your constraints, do not silently downgrade: implement the
closest honest version, label it, and put the rest in §F ("known limits") with what you would need.
