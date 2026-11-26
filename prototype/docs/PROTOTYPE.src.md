# PROTOTYPE.md — an end-to-end, inspectable prototype of the workshop harness (v1 + improved v2)

> **Generated** by `npx vite-node prototype/scripts/gen-docs.ts` from `PROTOTYPE.src.md` + the real scenarios (sections A and B are machine-written from actual runs; C–G are hand-written). Do not edit `PROTOTYPE.md` by hand.

**What it is.** One offline web app (`npm run build` → `dist/index.html`, single file; `npm run dev` for development). A version switch runs the **real loop** (a line-by-line TypeScript port of `Agent.kt`) with a **deterministic mock model**, executing the repo's **real TypeScript defaults and the real reference solutions** extracted from `workshop.html`. Everything on screen is clickable and opens an inspector (source, wiring, wire JSON).

**Status, plainly.** v1 runs all 27 numbered parts + 6 extras. v2 runs the same 33 scenarios plus 9 v2-only labs. The model is simulated, Docker/git/OpenRA are simulated (labelled in the UI, §F), Kotlin/Java reference solutions are shown but **not compiled or executed** (unverified).

**Deviations from the brief (all deliberate, all flagged):**

| # | Brief said | What I did | Why |
|---|---|---|---|
| 1 | "work inside a checkout of the repo, on a branch" | The sandbox project is a Vite template, not a checkout. I cloned `knarayanareddy/workshop-agentic-harness` read-only into `/tmp` (commit `0b82165`), ran the extractor against it, and put everything in the new top-level `prototype/`. Nothing in the repo was modified; no branch was created. | The existing Gradle modules, `workshop.html`, `presentation/` were never writable here. |
| 2 | "`REVIEW.md` … a prior review pass" | **`REVIEW.md` does not exist in the cloned repo** (`ls` of the checkout). I could not reuse it. Every gap in §C was re-derived from source and carries `path:line` evidence; the ten gaps listed in the brief are marked *verified*, *partly verified* or *unverified*. | Honest provenance. |
| 3 | "144 reference solutions" | The extractor finds **72 solution files** (24 files × 3 languages) plus **72 registration snippets** (the "In `index.ts`: …" blocks) = 144 code blocks. Both are stored. | The count in the brief seems to include registration snippets. |
| 4 | Layout `prototype/{app,data,engine,contract,sim,docs}` | Same, plus `scenarios/`, `v2/`, `policy/`, `scripts/`. The Vite entry stays in `src/` (it must: `vite.config.ts` may not be edited); `src/App.tsx` is a one-line re-export of `prototype/app/App.tsx`. | `@harness/api` is resolved by `npm install ./prototype/contract/v1` (a symlink in `node_modules`, recorded in `package.json` by npm, not edited by hand). |
| 5 | §3.1 items 2 and 3 "minimal additive fix" | **Applied**: the `build-file` deny now covers `edit_file` in TS/Kotlin/Java (with a test), and the clone URL in `workshop.html:356` points at this fork. Diffs in Appendix 1. | Java/Kotlin compiled only if a JDK is present; JS/TS path fully verified. |

---

<!--A-->

---

<!--B-->

---

## C. Gaps in the current implementation

Severity: **H** = can cause real harm or silently defeats a stated guarantee; **M** = undermines a workshop lesson or operability; **L** = hygiene. "Sim" = where you can see it in the running prototype (open the scenario ID in v1).

| # | Sev | Gap | Evidence | Sim | Status |
|---|---|---|---|---|---|
| C1 | H | **`run_command` is a shell-shaped hole.** Guardrails read *words*; globs, `$VAR`, quotes, `sh -c`, git global options all change what runs. The code admits it. | `extensions/typescript/src/guardrails/defaults/protectedPaths.ts` doc comment ("not a sandbox: it cannot see through globs, variables, quotes…"); `command.ts:3-5` (`NEVER` matches `git\s+push` so `git -C OpenRA push` slips to *Ask*); `command.ts:36` | **4.1** (before), **v2.shell** (v1: `cat .en*` reads `.env`) | verified, executed |
| C2 | H | **"Approve always" is scoped by tool name.** One `a` on `run_command` approves every later command for the session. | `harness-core/.../Agent.kt:67` (`approvedAlways = mutableSetOf<String>()`), `:239`, `:251` (`approvedAlways += call.tool.name`) | **v2.hitl** (v1: the commit runs unprompted) | verified, executed |
| C3 | H | **Upstream now ships an `AGENTS.md` forbidding agentic use**, and the workshop clones from HEAD, unpinned, with no policy for it. Text in that file is also an *instruction inside a tool result*. | Real file fetched from `OpenRA/OpenRA` (`bleed`): *"Automated agents … are not authorized to modify, analyze, or generate contributions … You MUST immediately cease processing."* (stored verbatim: `data/fixtures/upstream-AGENTS.md`); the clone is unpinned: `workshop.html` (1.2 solution) `git clone --depth 1 …` | **v2.provenance** | verified (text), policy question is the organisers' |
| C4 | M | **`build-file` guardrail only covered `write_file`.** `edit_file` could rewrite `build.gradle.kts`. **Now fixed** in TS/Kotlin/Java (Appendix 1), with a regression test. | was `buildFile.ts:15` (`if (call.tool.name !== "write_file") return allow()`); now `call.tool.name !== "write_file" && call.tool.name !== "edit_file"` | rule `P-build-files` in v2 (unchanged; it already covered both tools) | verified: 19/19 repo tests pass, incl. new "edit_file does not bypass the deny" |
| C5 | M | **Clone URL in the docs points at a different host than the repo.** | `workshop.html:356`: `git clone https://bitbucket.org/jdriven/workshop-agentic-harness` vs. this repo on `github.com/knarayanareddy/…` | docs only | verified (could be intentional for the upstream project; a fork should say so) |
| C6 | M | **No resumability / parallelism / sub-agents.** One REPL process, one `Agent`, `/clear` replaces it. | `app/.../Main.kt:39` (`newSession`), `:52` (`var agent`), `:64`; no `resume` in `Agent.kt` | **v2.resume**, **v2.delegate** | verified |
| C7 | M | **No context compaction** beyond the 30 000-char result cap and a dynamic warning; a long session only grows. | `resultCap.ts:10` (`30_000`); `iterationBudget.ts` (warn at 5) | **v2.compaction** (v1: context only grows) | verified |
| C8 | M | **No audit trail / policy-as-data / machine-readable output.** The only record is the console trace and `/report`. | `Main.kt` (`SessionRecorder` → HTML only) | **v2.resume** | verified |
| C9 | M | **Model endpoint hard-wired to a maintainer's proxy** by default. | `OpenAiModelClient.kt:40` (`baseUrl … ?: DEFAULT_BASE_URL`) — configurable by env, but the default is the proxy; I did not read the constant's value | — | partly verified |
| C10 | L | **Three-language parity by hand; registration steps omit the `import`; no CI; no licence.** | `ls` of the checkout: no `.github/`, no `LICENSE`; the worksheet's registration snippets (`registration` files in `data/solutions/*/typescript/_registration.txt`) show `index.ts` lines without the `import` | — | verified (listing), parity claim unverified |
| C11 | L | **Toolbox image is an unpinned tag; no checksum of what is built.** | `workspace/docker/Dockerfile:5` `FROM mcr.microsoft.com/dotnet/sdk:10.0` | **v2.provenance** (real sha256 of the five toolbox files) | verified |
| C12 | M | **Prompt-injection and secret filters are regex lists** (cheap, bypassable) — the lesson is correct (filters are the last line), but nothing says what follows. | `promptInjection.ts` patterns in solution 4.3 | **4.3**, **4.4** | verified |
| C13 | L | **`edit_file`, `write_file` never ask inside `OpenRA/`** — only outside `src/` for `write_file`. A human is never shown a diff. | `buildFile.ts:19-21` (`ask` only when path is outside `src/`; irrelevant for OpenRA); `ConsoleApprovalHandler.kt` shows tool name, reasons, raw input only | **v2.hitl**, **v2.policy** | verified |

**Gaps in my own work are in §F (known limits).**

---

## D. Improvements made in v2, and why

Each row: gap → options considered → decision → trade-off accepted → where to see it → comparable. **Comparable sources:** only the Claude Code hooks reference was fetched in this session (`https://code.claude.com/docs/en/hooks`: events `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStart/Stop`, `PreCompact/PostCompact`, `SessionStart`; matcher = tool name or regex; settings layers `~/.claude/settings.json` < `.claude/settings.json` < `.claude/settings.local.json` < managed policy, with hook entries *merging* across levels; hook handlers may be command, HTTP, MCP-tool, prompt or agent). The OpenTelemetry page I tried (`…/semconv/gen-ai/gen-ai-agent-spans/`) now only says "moved to the semantic-conventions-genai repository" — attribute names below are from memory, **unverified**. Every other comparable is cited from prior knowledge and marked *(unverified)*.

| # | Change (gap) | Options considered | Decision | Trade-off accepted | Demonstrable in sim | Comparable |
|---|---|---|---|---|---|---|
| D1 | **Skills** (no extension point for on-demand procedures) | (a) bigger static prompt; (b) RAG over docs; (c) named skills, catalog always visible, body loaded by a tool | (c) `skills_catalog` static section + `load_skill` tool (`v2/extensions.ts`) | Model must choose to load; catalog costs tokens on every call | **v2.skills**: Cost → attribution shows catalog (every call) vs body (only after load) | Claude Code Skills — `https://code.claude.com/docs/en/skills` *(unverified)* |
| D2 | **Delegation** (C6) | (a) one big context; (b) sub-agent with own context; (c) parallel agents | (b) `delegate` tool, restricted tools, own iteration + token budget, Ask→Deny inside | Lossy summary; fixed prompt cost per sub-agent; **dollars saved only after a break-even** (the lab prints it: 13 further parent calls in the shipped scenario) | **v2.delegate**: Cost → delegation economics | Claude Code subagents (`/docs/en/sub-agents`) *(unverified)*; OpenAI Agents SDK agents-as-tools, handoffs `https://openai.github.io/openai-agents-python/` *(unverified)* |
| D3 | **Policy as data** (C4, C8, part of C1) | (a) more regex guardrails; (b) a rules DSL; (c) OPA/Cedar | (b) tiny JSON rules (`id, effect, tool, path, argv{program,subcommand,…}, rationale, owner, suggest, scope, modes`), layered `00-workshop` < `10-project`, deny > ask > allow, default per tool; code guardrails stay | Own mini-DSL to maintain; no regex over shell strings by design | **v2.policy**: Assemble → project layer → *add example rule*, re-run; no rebuild | Claude Code settings layering + hook matchers (**fetched**) |
| D4 | **Deterministic enforcement** (C1) | (a) better regexes; (b) argv + allow-list, no shell; (c) container/seccomp sandbox | (b) `run_command` takes `argv` (`v2/policy.ts`), parsed structurally (git global options skipped), unknown programs default-deny, runner has its own allow-list | **A browser sim cannot enforce anything**: the guarantee comes from the runner's construction. A real boundary needs `execve` + an OS sandbox (c), which I did not build. Legacy code guardrails keep working through a `command` *view* | **v2.shell**, 4.1/4.2/4.5/4.6 | Claude Code permission rules `Bash(git *)` (**fetched**: `if` field) |
| D5 | **Context management** (C7) | (a) hard truncate; (b) LLM summary; (c) stub old tool results | (c) `compaction` guardrail returns `ProceedWith` (v1 API) | Lossy; one cache restart per rewrite — the engine's own warning says so; the sim bills it | **v2.compaction** | Claude Code `PreCompact/PostCompact` (**fetched**) |
| D6 | **Cache-aware assembly** | (a) status quo; (b) explicit stable/volatile split | Status quo was already right (static → system, dynamic → conversation). v2 keeps static sections stable-first and *shows* the split | None new | Cost tab: cache read/write per call, prefix tokens, savings vs no cache | Anthropic prompt caching *(unverified)* |
| D7 | **Resumable, auditable sessions** (C6, C8) | (a) log events; (b) log full transcript; (c) checkpointer | Append-only hash-chained log of events (+ replay by deterministic re-run, fork at approval *k*) | cyrb53 is **not cryptographic**; mid-turn resume needs `Agent.resume` — **not built** | **v2.resume**: Audit tab: verify, tamper, fork, export | LangGraph persistence/interrupts `https://docs.langchain.com/oss/python/langgraph/persistence` *(unverified)* |
| D8 | **Approval UX** (C2, C13) | (a) tool-name scope; (b) per-call only; (c) rule-scoped | (c) scope = `rule[+rule]:argv-prefix | directory`; prompt shows diff, blast radius, undo | More prompts than v1 for edits (a policy choice) | Aider/Cline edit confirmation *(unverified)* |
| D9 | **Observability** | (a) console trace; (b) spans | Spans derived from events, OTel-GenAI-style names (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.usage.*`), per-extension-point cost attribution, regression view | Virtual time; names unverified | Audit tab, Cost tab, Regression tab | OpenTelemetry GenAI conventions *(unverified: page moved)* |
| D10 | **Provenance** (C3, C11) | (a) pin only; (b) pin + ack + policy text + checksums | (b): pinned clone (same section name `openra_checkout`), `upstream_policy`, `upstream-ack` ask once, **real sha256** of the five toolbox files verified at assembly | The sim's pin is now a **real commit**, `1f594e32065615ed1847962c80ecfe6e868a11c3` (2026-10-20): verified to exist, to target `net10.0`, and to have **no `AGENTS.md`** — it is the last commit before upstream added the prohibition (`9636b63ea`, 2026-10-28). The simulated `git log` fixture reports the same commit, so the provenance section reads *matches*. The organisers still own the upstream-policy question | **v2.provenance**; Assemble → provenance | — |
| D11 | **Permission modes** | — | `plan` = read-only via rule `P-plan-mode` | Only `default` and `plan` implemented; `acceptEdits` is declared in the contract, **not implemented** | Assemble → permission mode | Claude Code permission modes *(unverified)* |
| D12 | **Fail-closed policy loading** | warn & continue / default-allow / default-deny | Invalid project layer is *ignored with a recorded error*; base layer + defaults still deny | A typo silently loses *your* rules (surfaced in Assemble notes) | verify.tsx check "invalid project layer" | — |

**Not built / considered only:** MCP-style capability negotiation (tools/resources/prompts separation `https://modelcontextprotocol.io/specification` *(unverified)*); LangGraph-style explicit state graph (the Workflow tab *visualises* the loop but the engine is still imperative); parallel sessions; structured final output beyond the JSON appendix of the report.

**Where a v2 feature would make an assignment trivial (and v1 mode keeps the lesson).** 4.2, 4.5, 4.6: with argv + allow-list, "no python / no pipe-to-shell / stay in workspace" are *not on the list* — the regex exercise disappears. Switch **argv** and **policy** off in Assemble (or use the v1 tab) to teach it. 4.4: `env` never runs in v2; secret-scan remains as the backstop for `read_file`.

---

## E. Workflow of both versions

**v1 loop (normative, `Agent.kt`):** `user` → for each iteration: **`beforeInference`** (each guardrail sees the previous rewrite; `ProceedWith` replaces history and emits the *cache restarts* warning; `Abort` ends the turn) → **dynamic sections** rendered, appended to the trailing user message only if the text changed → **inference** → `stop_reason`?
- `ToolUse` → per call: `ToolCallProposed` → **`beforeToolUse`** (first `Deny` wins and returns `Denied by guardrail '…'`; `Ask`s are collected) → if any ask: **one** approval prompt (`approvedAlways` by tool name) → **execute** → **`afterToolUse`** (`Replace` chains, first `Reject` wins) → `ToolCallCompleted` → all results as **one** user message, in call order → next iteration.
- `EndTurn` → **`beforeEndTurn`** (`Continue` bounded by `maxTurnContinuations = 3`) → `TurnEnded`.
- A throwing hook **fails closed** (Deny / Reject / Abort; `beforeEndTurn` → `AllowEnd`).

**v2 loop:** *identical nodes* — v2 adds no node. Differences are guardrails and tools at the same hooks: `compaction` (`beforeInference`), `policy` + `upstream-ack` (`beforeToolUse`), argv `run_command`, `load_skill`, `delegate` (nested loop with its own events), the audit listener, and rule-scoped `approvedAlways`.

**Divergence points** (generated per scenario in the Diff tab; examples):
1. *Before the first inference* — v2 emits `provenance` (and swaps `openra_checkout` for the pinned variant).
2. *`beforeToolUse`* — v1 code guardrail or `command`'s *Ask* → v2 policy *Deny* with rule id, owner, rationale, alternative.
3. *Approval* — v1 prompt: tool name + raw input, scope = tool; v2: diff + blast radius, scope = rule + argv/dir.
4. *`beforeInference`* — v2 compaction fires once the threshold is passed.
5. *Tool list* — v2 `run_command` has `argv`; v2 offers `load_skill`, `delegate`.

The interactive graph (Workflow tab) is this text, executable: play / pause / step / speed / rewind / scrub; the highlighted edge is the branch taken; the panel below shows the node's output (prompt text, tool input/result, verdict + reason, duration, token delta).

---

## F. Verification and known limits

### F1. What I actually executed (commands and results)

| Command | Result |
|---|---|
| `git clone https://github.com/knarayanareddy/workshop-agentic-harness` → `/tmp/wah` | commit `0b82165`; `REVIEW.md` absent |
| `(cd extensions/typescript && npm ci && npm test)` — **repo's own tests, untouched** | **18 passed** (2 files: `defaults.test.ts` 9, `helpers.test.ts` 9) |
| `npm run extract -- /tmp/wah` (`node prototype/scripts/extract.mjs`) | 39 chapters; **27 numbered parts**; **72** solution files (24×3); `assignments.json`; toolbox manifest (real sha256) |
| `npm run typecheck` (`tsc --noEmit`, strict, `noUnusedLocals`) | clean (covers `prototype/` through the import graph) |
| `npm run regress` (`npx vite-node prototype/scripts/regress.ts`) | every one of the **41** scenarios × v1/v2 runs (82 runs); **all scenario assertions pass** (see `docs/regression.json`; table below) |
| `npm run verify` (`npx vite-node prototype/scripts/verify.tsx`) | designed failures with the artefact **off**, determinism, token tolerance, v2 features, SSR of every view and **44 distinct bundle-item inspectors (56 renders** — v1 and v2 render the same items separately), report export — **all checks passed** (output reproduced below) |
| `npm run smoke` (`npx vite-node prototype/scripts/dom-smoke.tsx`) | the real `<App/>` mounted in jsdom (not a browser): tabs, scenario switch, inspector, permalink, Regression view (output reproduced below) |
| `npm run build` | `dist/index.html` single file, builds offline |

<!--VERIFY-->

**Not executed (unverified):** the Kotlin and Java reference solutions and the Kotlin/Java defaults (no JDK here; they are displayed in the inspector, not compiled); the real TypeScript-in-GraalJS bridge (my TS runs in V8/the browser, so GraalJS-specific behaviour — no `setTimeout`, JSON crossing — is not exercised); the real toolbox (`docker build`, `openra-check`, `openra-rules`, `openra-package`); a real model; a real browser session (I rendered every view server-side with `react-dom/server` and ran the engine headlessly; I did **not** click through the UI in a real browser: the jsdom smoke test drives clicks and reads the DOM, but layout, the SVG graph's appearance and the Workflow animation timing are therefore untested by eye).

### F2. Fidelity boundary

| Thing | Fidelity | Notes |
|---|---|---|
| Loop ordering, guardrail semantics, fail-closed, `maxIterations=25`, `maxTurnContinuations=3` | **real (ported)** | `engine/agent.ts` ← `Agent.kt`; `Tokens.estimate = (len+3)/4` |
| Default sections / tools / guardrails / listener (8 / 3 / 4 / 1) | **real (executed unmodified)** | `data/ts/src/**` extracted from `extensions/typescript/src` |
| **24** reference solution files (TS) across 23 code parts | **real (executed unmodified)** | extracted from `workshop.html`, body byte-identical, placed where the worksheet says. 24 files / 23 parts because 3.1 ships two artefacts (`StartToolbox` + `ToolboxStatus`) |
| Guardrail regexes, `ShellCommand` limits (120 s, 20 000 chars), result cap 30 000, `ModRules` directory names, `rules.ftl` lookup | **real** | same code / constants |
| Upstream `AGENTS.md` | **real text** | fetched from `OpenRA/OpenRA@bleed` |
| Toolbox scripts, Dockerfile | **real files** (shown, checksummed) but **not run** | |
| Wire JSON | **real shape** | mirrors `OpenAiModelClient.toMessages`; I did not read the max-tokens / model fields, so `model` is a placeholder |
| Model | **simulated** | deterministic replay + branch-on-transcript; not an LLM |
| git, docker, `openra-rules`, `openra-check`, `openra-package`, game launch | **simulated** | text imitates OpenRA's linter style; wording **unverified** |
| OpenRA fixtures (2TNK, TSLA, `player.yaml`, `world.yaml`, `rules.ftl`, shader) | **illustrative** | follow the worksheet's claims; not copied from upstream |
| Billing | **simulated** | chars/4 × seeded factor within **±8 %** (measured worst: 7.77 %); cache = longest common prefix, ≥ 1024 tokens |
| Delegation counterfactual | **analytic** | assumes the sub-agent's tool results would have been inlined |
| Audit hash | **not cryptographic** | cyrb53 |
| Time | **virtual** | `Date` is frozen inside runs; durations come from the sim |

### F3. Best-effort list (honest)

- 6.2 and 6.3 are **illustrative**: the world.yaml / shader fixtures are mine.
- The "improvise" model is a seeded branch table; seeds 1–6 on 4.2 yield **2** distinct branches, not a rich distribution.
- Interactive approvals work while the run is alive; scrubbing a finished run is replay of the recorded trace, not a re-execution.
- **Fork** re-runs the same prefix deterministically and flips the decision at approval *k*; it does not resume mid-turn from a stored transcript (needs `Agent.resume`).
- `acceptEdits` mode is typed, not implemented. No MCP, no LangGraph-style graph engine, no parallel sessions.
- The v2 runner's allow-list is a *design*; the real guarantee needs an OS sandbox.
- A policy typo in your own layer loses your rules (it fails closed on the base layer).
- I did not measure real-tokenizer drift; ±8 % is a stated tolerance of the simulation, not a measurement of any vendor.
- **Done since this was written:** CI now compiles all 48 Kotlin/Java solutions (`.github/workflows/ci.yml`, job `jvm-solutions`) and re-checks the OpenRA pin (`upstream-pin`). The simulated pin is now a real commit.
- **What I would do next:** run the real toolbox once and replace the simulated `openra-check`/`openra-rules` output with captured output; add `Agent.resume`; implement the runner on `execve` inside the toolbox container; add a LICENSE and CI; pin a real OpenRA commit.

---

## G. Runbook

```bash
npm install            # offline-capable once node_modules exists; @harness/api is a local package (./prototype/contract/v1)
npm run dev            # Vite dev server on 0.0.0.0; allows the *.e2b.app preview host (add more via VITE_ALLOWED_HOSTS=a,b)
npm run typecheck      # tsc --noEmit (strict)
npm run build          # → dist/index.html, one self-contained file (works from file://)
npm run regress        # all 41 scenarios, v1 and v2, assertions → prototype/docs/regression.json
npm run verify         # designed failures, determinism, tolerance, v2 evidence, SSR of every view
npm run smoke           # the real <App/> mounted in jsdom — tabs, scenario switch, permalink
npm run extract -- <repo>   # re-extract worksheet + defaults after workshop.html changes
npm run solutions:install  # place the 48 Kotlin/Java solutions in their exercise packages
./gradlew build            # compile them (needs JDK 17+; downloads JDK 25 + Node itself)
npm run solutions:clean    # remove them again (they are gitignored, never committed)
npm run gen-docs       # rebuild this file
```

**Where things live**

| What | Where |
|---|---|
| Scenario definitions (27 parts, 6 extras, **8** v2 labs — 41 in total) | `prototype/scenarios/index.ts` (one `add({...})` each: prompts, world, plan, approver, assertions, hook, cleanup, v2 note) |
| The loop | `prototype/engine/agent.ts` |
| Bundle composition (v1 + v2) | `prototype/engine/bundles.ts` (`ARTEFACTS` = which file is which part) |
| Mock model + DSL (`script`, `say`, `call`, seeded `pick`) | `prototype/engine/mock.ts` |
| Provider (billing, cache, wire JSON, prices) | `prototype/engine/provider.ts` |
| Simulation boundary | `prototype/sim/world.ts` (`SIM_BOUNDARY` table, git/docker/openra fakes, fixtures) |
| v2 contract / policy / skills / delegation / compaction / audit | `prototype/contract/v2/harness-v2.ts`, `prototype/v2/*.ts`, `prototype/policy/*.json` |
| Extracted data | `prototype/data/` (`assignments.json`, `solutions/`, `ts/`, `defaults/`) |

**Add a guardrail.** Write `src/guardrails/exercise/myGuard.ts` (any hook optional) under `prototype/data/ts/src/` — or, to keep it across re-extraction, add it next to the extractor's output in a separate folder and import it in `bundles.ts`; append an `ARTEFACTS` row (`kind: "guardrail"`) and its registration position in `assemble()` (order = evaluation order). For data rules instead: add a rule to `prototype/policy/10-project.json` — no code, no rebuild in the UI (Assemble → project layer).
**Add a tool.** Same, `kind: "tool"`; the name must be snake_case and unique (the engine checks, as `Agent.kt` does). **Add a section.** `kind: "section"`; static goes in the frozen system prompt, dynamic into the conversation when its text changes. **Add a skill.** Append to `SKILLS` in `v2/extensions.ts` (name, description = always paid, body = paid when loaded).
**Add a seventh assignment.** (1) Write the part in `workshop.html` (chapter with `data-part="7.1"`, a `<details class="solution">` per language) and re-run `extract.mjs`; (2) add an `ARTEFACTS` row; (3) add `add({ id: "7.1", … })` in `scenarios/index.ts` with a plan, assertions and `v2note`; (4) run `regress.ts` and `verify.tsx`; (5) `gen-docs.ts`.

**Permalinks.** *copy permalink* writes the state (scenario, version, tab, seed, artefact switch, prices, v2 options, project policy layer, forks) into the URL hash; opening it reproduces the identical trace (checked: same scenario + seed → identical events, audit head and cost).

---

## Appendix 1 — the two additive fixes the brief allows (**applied**)

Both were applied to a checkout on branch `arena/3d83f813-workshop-agentic-harness` and verified by running
the suites. They are the only changes outside `prototype/`; nothing else in the repo was touched.

**Item 3 — `build-file` guardrail also covers `edit_file`.** `workshop.html:310` already promises this
("Never lets the agent **edit** build files such as `build.gradle.kts`"), so the code, not the docs, was wrong.
Changed in all three languages (`extensions/{typescript,kotlin,java}/…/guardrails/defaults/BuildFile*`):

```diff
-    if (call.tool.name !== "write_file") return allow();
+    if (call.tool.name !== "write_file" && call.tool.name !== "edit_file") return allow();
 ...
-    if (!relative.startsWith("src/")) {
+    if (call.tool.name === "write_file" && !relative.startsWith("src/")) {
       return ask(`write outside src/: ${relative}`);
     }
```

Trade-off kept: `edit_file` outside `src/` is still not *gated* (a small reviewable diff is not "writing all
over the project") — only the build-file **deny** was broadened, so the §5.3 lesson is unchanged.
**Verified:** repo tests **19/19** pass (the new case asserts `edit_file` on `pom.xml`, `build.gradle.kts` and
`src/../package.json` is denied, that `notes.md`/`src/A.kt` still behave as in v1, and that an unrelated tool is
untouched); prototype `regress`/`verify`/`smoke` all still green after re-extraction. Kotlin/Java were **not
compiled** (no JDK here).

**Item 2 — clone URL** (`workshop.html:356`): `git clone https://bitbucket.org/jdriven/workshop-agentic-harness`
→ `https://github.com/knarayanareddy/workshop-agentic-harness` (this checkout's `origin`). One line changed,
line count unchanged (4244), and the 72 extracted solutions re-extract byte-identically. If the bitbucket URL
was deliberate for the upstream project, revert this one line — it is the only edit to `workshop.html`.

**Also fixed while verifying the above — `extract.mjs` destroyed `@harness/api`.** `prototype/scripts/extract.mjs`
did `rmSync(prototype/contract/v1)` and copied back only `kotlin/` and `harness.ts`, deleting the
`package.json` that makes `@harness/api` resolve as a `file:` dependency. Re-running the documented
"re-extract after `workshop.html` changes" command therefore broke `npm run dev`/`regress`/`verify` until an
`npm install` re-linked it. The script now clears only `kotlin/` and regenerates `package.json`, and is
idempotent (verified by running it twice).

## Appendix 2 — the 144 code blocks

`prototype/data/solutions/index.json` lists the 72 solution files with part, language, source anchor (`workshop.html#<id>`), and a 12-hex content hash; `data/solutions/<part>/<lang>/_registration.txt` holds the registration snippets. The TypeScript set is the one that executes (`data/ts/src/**/exercise/`).
