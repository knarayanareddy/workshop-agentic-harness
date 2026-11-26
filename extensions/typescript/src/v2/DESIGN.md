# v2 — the harness improvements, in the real harness

v2 is **opt-in**: `HARNESS_V2=1 HARNESS_LANGUAGE=typescript ./gradlew :app:run`. v1 is untouched and stays
the default, because the workshop teaches v1. Every v2 addition is labelled where it appears.

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
| **Delegation / sub-agents** | not implemented in the real harness (see below) | — |

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

## Honest limits

- **Delegation is not in the real harness.** A sub-agent needs a nested loop (`Agent.run` inside a
  tool), which is real work in `Agent.kt` and a change to what a tool is allowed to do. The prototype
  demonstrates it; this does not pretend to. `SubAgentRunner` is declared in `contract.ts` as the seam
  it would plug into, and nothing implements it.
- **The runner's allow-list is a design, not a sandbox.** It stops the model naming a program, and it
  removes shell metacharacter expansion by not using a shell. It does not stop `git` itself doing
  something surprising, and it is not a syscall boundary.
- **`acceptEdits` is not implemented.** `PermissionMode` declares it; only `default` and `plan` mean
  anything today.
- **Compaction is lossy by construction** and it restarts the prompt cache; the loop emits its own
  warning when a guardrail rewrites history, and that warning is correct.
- **The audit chain is not tamper-proof.** `cyrb53` is not cryptographic; anyone who can rewrite every
  entry can recompute the chain. It detects accidental edits and naive tampering, which is what it
  claims. It now also detects removals from the middle *and* the end, which a bare chain cannot.
- **Skills are seed data.** Two skills ship as examples; they are not a complete catalogue of OpenRA
  knowledge, and the model must choose to load them.

## Tests

`test/v2/` — 68 tests: glob/argv matching, fail-closed parsing, layered evaluation, the runner's
refusals, skills, compaction, the audit chain (including middle and end deletion), the assembled bundle,
and the **built artefact** (`dist/extension-v2.js`) loaded the way the JVM loads it.
