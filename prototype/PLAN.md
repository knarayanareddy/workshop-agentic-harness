# PLAN (working document — the deliverable is docs/PROTOTYPE.md)

**Engine.** `engine/agent.ts` is a line-by-line port of Agent.kt (async only because tools/approvals may await). One engine for v1 and v2; v2 only passes options (approval scope, denial text).
**Execution.** Real TS defaults + real reference solutions (extracted from workshop.html) run unmodified; `@harness/api` is a local package mirroring harness.ts verbatim.
**Bundles.** `engine/bundles.ts` is the single composition point. v1 = index.ts + the worksheet's registration steps. v2 = v1 + (policy, argv run_command, skills, delegate, compaction, provenance, upstream-ack, audit).
**Scenarios.** 27 parts + 6 extras + 9 v2 labs (`scenarios/index.ts`); plan = function of the transcript (replay-safe, forkable), seeded improvisation; assertions per version.
**Improvement table (gap → fix).** C1 shell hole → argv runner + allow-list; C2 over-grant → rule-scoped approvals; C3 upstream AGENTS.md → pin + upstream_policy + ack; C4 build-file/edit_file → rule P-build-files; C6 sessions → audit log + fork + delegate; C7 context → compaction; C8 audit → hash-chained log + spans; C11 supply chain → real sha256 manifest.
**Fidelity boundaries.** model, git, docker, openra-*, fixtures, billing, delegation counterfactual (docs §F2).
**Order of work.** extract → engine → v1 scenarios (27 parts green) → v2 layer → labs → graph/diff → docs → verify.
