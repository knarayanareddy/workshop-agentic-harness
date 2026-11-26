# v2 — the harness improvements, in the real harness

v2 is **opt-in**: `HARNESS_V2=1 HARNESS_LANGUAGE=typescript ./gradlew :app:run`, optionally with
`HARNESS_MODE=plan|acceptEdits`. v1 is untouched and stays the default, because the workshop teaches v1.
Every v2 addition is labelled where it appears.

## What v2 adds, and what it cost to add

The point of v2 is that most of it needs **no change to the loop**. The four v1 extension points
(section, tool, guardrail, listener) turn out to be enough for almost everything:

| Feature | How it is built | Core change |
|---|---|---|
| **Policy as data** | `policy/*.json` + a `beforeToolUse` guardrail (`src/v2/policy.ts`) | none |
| **argv runner** | a `Tool` whose input is `argv[]`, no shell (`runCommandArgv`) | none |
| **Skills** | a static catalog section + a `load_skill` tool | none |
| **Compaction** | `beforeInference` returning `ProceedWith`, which v1 already has | none |
| **Audit log** | a listener + hash chain (`AuditLog`) | none |
| **Provenance** | a static section + an `Ask` guardrail (`upstreamAck`) | none |
| **Scoped approvals** | `ApprovalScope` + `Guardrail.approvalScope` | **yes — `Agent.kt`** |
| **Delegation / sub-agents** | `AgentRuntime.subAgentRunner` → a nested `Agent` | **`Agent.kt`, `SubAgentLoops.kt`** |
| **`acceptEdits`** | `AgentRuntime.approveEditsFor`, consulted after every guardrail | **`Agent.kt`** |
| **A budget that can stop the loop** | `AgentRuntime.interruptCheck`, between iterations | **`Agent.kt`** |

Scoped approvals needed core because v1 recorded `approvedAlways += call.tool.name`: one `a` on
`run_command` approved every later command in the session (REVIEW C2). A guardrail cannot fix what the
loop remembers — only the loop can. `Agent.kt` now remembers a **scope key** (`tool:`, `argv:`,
`dir:`), supplied by the asking guardrail; a guardrail that supplies nothing gets `WholeTool`, i.e.
exactly v1's behaviour, so existing bundles cannot regress.

## The two policies

`policy/00-workshop.json` is the base: secrets, build files, C# engine edits, `git push`, shells and
interpreters, paths outside the workspace. `policy/10-project.json` is the project layer; it can only
**tighten**. Evaluation: first matching rule per layer wins, then the strictest verdict across layers
(deny > ask > allow); no match falls back to the layer's `defaults` for that tool, then to deny.

Matching is **structural**, never a regex over a shell string: `argv` is parsed, and git's global
options are skipped so `git -C OpenRA push` is still `push`. That is the whole point of C1.

## Delegation: a nested loop, and what actually isolates it

A sub-agent is an `Agent` run **inside a tool call**. It cannot be an extension, because a bundle cannot
nest the loop it is already running inside. The split:

| Half | Who owns it | Where |
|---|---|---|
| Which agents exist, what the model is told, what comes back | the bundle | `delegation.ts`, `index.ts` |
| Running one, with its own context and budget | the loop | `SubAgentLoops.kt` |
| Handing the bundle a `ctx.delegate` that reaches that loop | the bridge | `JsRuntime.kt`, `TypeScriptExtensions.kt` |

The isolation is **enforced, not described**, and each claim has a test:

- **Its own tools.** The child's tool list is built from its spec alone, so a tool it does not name is
  unknown to the model, not merely denied. A spec naming a tool the bundle does not register is a *load*
  error — otherwise the child would silently have fewer tools than its description promises.
- **Its own transcript.** A fresh `Agent`, so nothing crosses in either direction. What the child read
  never appears in the parent; only its answer and its call count do.
- **It cannot ask a human.** Its approval handler only denies. A sub-agent that could prompt would hang
  the parent forever.
- **It is judged by the same guardrails.** The child gets the bundle's guardrails, including the policy,
  so a delegated run is bound by the same rules rather than by a second copy of them.
- **It cannot delegate further.** Its runtime is empty, so its own `subAgentRunner` returns null.
- **It cannot outlive its budget.** `maxIterations` is per child; the loop stops it.

The trace is the parent's. The child's events go nowhere, so delegating does not double every line.

## acceptEdits: why it could not be a guardrail

A guardrail may only *tighten* a decision. "Skip the prompt" loosens one, so the loop consults
`approveEditsFor` **after** every guardrail has decided and **only** for calls that produced an ASK. A
DENY has already returned by then. The bundle decides scope (v2: `edit_file` and `write_file`), and a
check that throws asks as usual rather than approving.

`HARNESS_MODE=plan|acceptEdits` selects the mode; the policy's own `modes` rules still apply, so plan
mode denies writes regardless.

## Honest limits

- **A sub-agent starts from a task, not a conversation.** It cannot read the parent's history, so a task
  that says "fix the thing we discussed" fails. That is the trade for isolation, not an oversight.
- **Delegation needs a model.** Without `MODEL_API_KEY` there is no runner, `ctx.delegate` is not
  advertised, and `delegate` says so plainly instead of doing the work in the parent's context.
- **The runner's allow-list is a design, not a sandbox.** It stops the model naming a program, and it
  removes shell metacharacter expansion by not using a shell. It does not stop `git` itself doing
  something surprising, and it is not a syscall boundary.
- **Compaction is lossy by construction** and it restarts the prompt cache; the loop emits its own
  warning when a guardrail rewrites history, and that warning is correct.
- **The audit chain is not tamper-proof.** `cyrb53` is not cryptographic; anyone who can rewrite every
  entry can recompute the chain. It detects accidental edits and naive tampering, which is what it
  claims. It detects removals from the middle *and* the end, which a bare chain cannot.
- **Skills are seed data.** Two skills ship as examples; they are not a complete catalogue of OpenRA
  knowledge, and the model must choose to load them.

## Tests

- `test/v2/` — **107** tests: glob/argv matching, fail-closed parsing, layered evaluation, the runner's
  refusals, skills, compaction, the audit chain (middle and end deletion), delegation's refusals and the
  budget boundary, the assembled bundle, and the **built artefact** (`dist/extension-v2.js`) loaded the way
  the JVM loads it.
- `RuntimeTest.kt` (harness-core) — the nested loop, `acceptEdits` ordering, and the interrupt check.
- `DelegationBridgeTest.kt` (harness-typescript) — the whole chain across the language boundary with a
  scripted model: no API key, no network. This is the test that makes "delegation works" a fact.

**A bug this found:** `load_skill` was denied by the default-deny from the day v2 shipped. The bundle
advertised progressive disclosure and refused every call to it, because the policy had no rule for v2's
own tools. The guardrail tests passed because they only exercised the paths they were written for; running
the *real* policy JSON against the *real* tool list is what caught it.
## Tests

`test/v2/` — 68 tests: glob/argv matching, fail-closed parsing, layered evaluation, the runner's
refusals, skills, compaction, the audit chain (including middle and end deletion), the assembled bundle,
and the **built artefact** (`dist/extension-v2.js`) loaded the way the JVM loads it.
