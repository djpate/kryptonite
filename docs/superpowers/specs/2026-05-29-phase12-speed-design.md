# Phase 12 Speed — Decoupled Codegen + Cheaper Fix Loop

**Date:** 2026-05-29
**Status:** Design approved, pending implementation plan
**Scope:** kryptonite Phase 12 (execution) wall-clock, no correctness regression

## Context

Phase 12 is "painfully slow — hours per wave." A diagnostic workflow (5 parallel profilers → synthesis → adversarial review) and a design workflow (2 designs → judge/merge → 3 adversarial verifiers) produced a ranked latency model and a safety-checked design.

The non-negotiable constraint: **the wave gates (UAT, UX, spec-compliance, code-review) and adversarial critics are kryptonite's entire value.** Field feedback proved they caught 100% of cross-story breakage that coder self-reports missed. A faster Phase 12 that lets any bug past a gate is a regression, not a win. Every change here was adversarially checked against the gate guarantees and the orchestrator invariants.

### Ranked wall-clock sinks (per wave, biggest first)

1. **Fix-loop volume** — dominant under failure. Driven by issue *count* per wave (one real wave had ~60), not retry depth. Every wave hits the loop because self-reports are optimistic. 10–30× first-pass time on bad waves.
2. **Serial coding in `single_mounted_serial`** — the largest *fixed* sink on clean waves, and the common case. N stories code one-at-a-time = N× coder latency.
3. **Chrome-MCP browser walks (UAT/UX)** — sets the gate-phase floor every attempt. Essential, irreducible.
4. **Per-issue service restarts** — ~30s boot each, churned across fixes.
5. Blocking-group barrier, 700KB state re-reads, coarse gate re-runs, per-wave merge/boot.

### Key insight

Today's protocol serializes **both** codegen and verification in `single_mounted_serial`. But only **verification** needs the serial mount (the container mounts only the main worktree; the shared test DB races under parallel verification). **Codegen is pure source editing — it can fan out in parallel regardless of mode.** Decoupling the two is safe because gates still run against the identical fully-integrated artifact.

### Honest ceiling

Decoupling cuts ~35–40% off a *clean* wave. On a wave that loops (the common case today), the **serial verify floor dominates** and the codegen win is small. That floor is correctness-load-bearing and stays. So this design must attack *both* codegen serialization (sink #2) and the fix loop (sink #1) — neither alone is sufficient.

## Design

### Part 1 — Decouple codegen from verification; collapse the two modes

Split Phase A into two sub-phases:

- **A1 — parallel patch generation.** For each parallel group (blocking groups first), fan out N coders concurrently — in **both** execution modes. Each coder works in a throwaway detached checkout (`git worktree add --detach`) at the same `base_sha`, write-only, runs **nothing** (no container, no DB, no tests), and returns `files_changed[]` + a `patch_path` (`git format-patch base_sha..HEAD`). Barrier: wait for all coders in the group.
- **A2 — serial apply + integrate.** Apply each group's patches onto the apply target **one at a time**, in deterministic plan order (blocking owners first), via `git am --3way`. On non-clean apply, the **patch-conflict path** (= today's merge-conflict path) fires: orchestrator resolves trivially inline, else re-dispatches the coder in rebase mode against the current tip. Set `story.status = "merged"`; remove that story's detached checkout.

**The two execution modes collapse into one pipeline** with a single switch: `apply_target` = wave-N worktree (`worktree_parallel`) or the main mount (`single_mounted_serial`). A1 is identical in both. `single_mounted_serial` loses its codegen penalty entirely and stops being a second protocol.

**Patch representation:** `git format-patch base_sha..HEAD` — a portable mailbox file preserving the story-ID commit message. Applied with `git am --3way` (blob-context 3-way; non-overlapping edits to the same file apply cleanly; overlapping fall to the conflict path). This is strictly better than today's `--no-ff` story-branch merge for the same-file case and preserves the commit graph shape gates see.

**Why it's safe:** A2's apply order is deterministic (= today's serial commit order), conflicts are forced through rebase (no silent drift), and `--3way` preserves per-story commits — so the integrated artifact Phase B verifies is bit-identical to today regardless of parallel generation. A1 verifies nothing, so finding #10 (sibling-worktree invisibility) is moot: A1 produces *patches*, nothing is tested in a checkout.

**Guardrails (from the invariant + edge-case audits):**
- **G1 — intra-group read-after-write.** Parallel A1 erases serial mode's "story 2 reads story 1's committed code" property. A true intra-group source dependency must be a blocking-group split (planner invariant), OR that group's A1 stays sequential-with-apply. Largely covered by the existing `shared_artifacts[]` / blocking-group discipline — enforced one notch harder.
- **G2 — detached-checkout cleanup.** Add a `patchgen-*` row to the Worktree Cleanup Guarantees table; route failed `patchgen-*` removals into `state.json.orphaned_worktrees[]`. Prevents an aborted A2 from leaking checkouts.
- **G3 — patch-conflict classification.** A patch-conflict re-dispatch is a Phase A retry, NOT counted against `max_fix_attempts` (mirrors today's merge-conflict handling).

**Invariant audit result:** 8/10 invariants UPHELD outright. Invariants 5 (no services in worktrees) and 10 (no concurrent test-DB migration) are not merely upheld but **structurally eliminated** — parallelism now lives in a phase that never opens the DB or a service. No invariant VIOLATED.

### Part 2 — Make the fix loop cheaper (the dominant sink)

All four SAFE, none weakens a gate:

- **2a — Inline trivial gate fixes.** When a gate returns a small, mechanical defect (missing import, typo'd selector, lint nit), the orchestrator patches it directly on the mount instead of cold-starting a fresh coder. Guardrail: "trivial" is bounded — single-file, mechanical, no logic change; anything ambiguous goes back to a coder.
- **2b — Batch service restarts per attempt.** Apply all of an attempt's fixes, then restart affected services **once**, then run gates — replacing today's per-issue restart. Cuts O(fixes) boots → O(attempts). Guardrail: restart + health-check must complete **before** any gate dispatches; never let a gate hit a stale process. A later fix touching service files after restart forces another restart.
- **2c — code_review re-runs on the incremental fix diff only.** The single gate-scoping allowed — code-review's artifact under inspection *is* the diff, so scoping loses nothing. **UAT, UX, and spec-compliance are NOT scoped** — they always re-run full against the integrated running system, because cross-story regressions live precisely in the journeys a story↔file map would skip.
- **2d — Lean on shipped reconciliation.** The 0.8.0 `shared_artifacts[]` manifest + "invented representation = hard halt" are the prevention half: fewer cross-story bugs → fewer loop iterations. No new code; ensure the Plan Critic and plan assembler populate `shared_artifacts[]` well.

### Part 3 — Trim fixed per-dispatch overhead

- **3a — Slim per-story dispatch views.** The orchestrator hands each coder/gate a lossless slice (story + AC + DOD + repo conventions + owned/reused `canonical_representation`), never the raw ~700KB `state.json`. Guardrail: slicer lossless on gate-relevant fields; gates themselves keep reading raw state — the slim view is a dispatch-input optimization only, never a verification input.
- **3b — Cheaper git plumbing** (free rider on Part 1): `git worktree add --detach` + `git format-patch` replaces the old per-story branch-create → worktree-add → merge → branch-delete sequence.

### Part 4 — Explicitly NOT doing (record the reasoning)

- **NOT scoping UAT/UX/spec-compliance** to a story↔journey map — cross-story regressions live in the journeys such a map would skip; it re-encodes the optimistic-isolation assumption the gates exist to defeat.
- **NOT per-story live mounting / parallel verification** — reopens the shared-test-DB race and untested-sibling hazard that forced `single_mounted_serial` to exist. Revisitable only with per-worktree DB isolation.
- **NOT downgrading any gate's model** — gates run in parallel; cheapening a non-slowest gate buys ~0 wall-clock and trades correctness margin for nothing.
- **NOT parallelizing the fix loop** — gates must see the integrated system; parallel fixes against a shared mount/DB is the exact hazard set being avoided.

## Files touched

- **`references/execution-protocol.md`** — split Phase A step 4 into A1 (parallel gen) + A2 (serial apply); add `base_sha`, `git am --3way`, rename merge-conflict → patch-conflict; delete the in-Phase-A "verify per-changed-file" note (line ~78); state modes collapse to one pipeline with `apply_target` switch; Phase B fix loop: inline trivial fixes + batched-restart-before-gates + code_review-on-fix-diff; add `patchgen-*` row to Worktree Cleanup Guarantees.
- **`agents/orchestrator.md`** — Per-wave loop Phase A bullet rewritten (parallel patch-gen → serial apply); Tools: `worktree-manager.js` gains `createDetachedCheckout` + `applyPatch`, add `slicer`; dispatch templates add slim per-story view + `patch_path`; Phase B notes inline trivial fixes + batched restart; invariants unchanged (now also cover detached checkouts); add the G2 cleanup row reference and G3 classification note.
- **`agents/coder.md`** — Worktree Mode: emit `patch_path` (git format-patch) + note checkout is throwaway/detached; status-report JSON adds `patch_path`; add a rebase-mode bullet to Merge Conflict Fix (re-emit patch onto current tip); reinforce the "cannot claim verification" rule and `tests_run: "none (worktree mode)"`, now applying to all Phase A codegen (both modes).
- **`scripts/worktree-manager.js`** — `createDetachedCheckout`, `applyPatch` (git am --3way + conflict detection), and a lossless `slicer` helper (or a sibling script).
- **Schema** — optional `patch_path` on the coder report shape. No state-machine/status-enum change (`merged` semantics identical).
- **`references/plan-assembly.md`** — reinforce G1 (no intra-group source dependency; true deps go in a blocking group).
- **CHANGELOG.md / package.json / schema-changelog.json** — version bump + entry.

## Expected outcome

- **Clean/wide waves:** ~35–40% wall-clock cut, from A1 collapsing N× codegen toward ~1×.
- **Looping waves:** meaningful but bounded — fewer and cheaper iterations (2a–2d), but the serial verify floor is correctness-load-bearing and remains. This is the honest ceiling; the next lever after this would be Phase B verification itself, which we are deliberately not weakening.
- **Bonus:** the two execution modes collapse into one pipeline — a net simplification that happens to also buy the parallelism.

## Verification (for the implementation phase)

- Schema/script parse + `node -c` on edited scripts.
- `validate-*.js` clean against the real readiness-v2 epic (no regression).
- Edge-case walk-throughs (no script test for orchestrator-LLM behavior): two parallel patches same file (clean 3-way merge vs conflict→rebase); blocking group clears A2 before next group's A1; end-of-wave codegen still after apply, before gates; clean-but-wrong patch caught by Phase B identically; both execution modes correct.
- Confirm the in-Phase-A verify note deletion is total (no residual invisible-sibling read on the mount).
