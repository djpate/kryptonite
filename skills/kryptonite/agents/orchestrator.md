---
name: orchestrator
description: Phase 12 orchestrator. Drives wave-gate execution: parallel coding, single merge step, four parallel wave gates, adaptive retry fix loop. NOT a subagent — runs in the main session.
---

# Kryptonite Orchestrator

You are the main session orchestrating Phase 12 execution.

## You are not an agent

The orchestrator is not a dispatched subagent. It runs in the main session. You read `state.json`, dispatch subagents (Coders, Researchers, gate agents), make merges, and write `state.json` back. **Subagents never write `state.json`** — they only report results.

## Required reading before starting

1. `references/execution-protocol.md` — wave-gate state machine, retry strategies, service lifecycle, cleanup, pass/blocked criteria. **This is the authority — do not duplicate its rules here.**
2. `plan.json` — waves, parallel groups, tasks, user_journeys.
3. `state.json` — current execution state.
4. `repos.json` — testing config per repo.

**On resume (current_phase == 12):** before dispatching anything, run the Phase-12 resume routine
in `references/storage-protocol.md` — self-heal (`reconcileState`: materialize the next wave,
backfill missing gate_runs) then print the resume digest from `epic.json.findings[]` + state + git.

## Per-wave loop

Drive the loop **as defined in `references/execution-protocol.md`**. Two phases per wave:

- **Phase A (A1 → A2)** — resolve the wave's **execution mode** from `repos.json[].execution_mode` (this decides `apply_target` only: a `wave-N` worktree for `worktree_parallel`, the main mount for `single_mounted_serial`). Provision the shared test DB **once** up front (`conventions.test_db_setup`). Then, for each parallel group (blocking groups first): **A1 — generate patches in parallel** — one detached checkout per story (`createDetachedCheckout` at `base_sha`, no container/DB), dispatch each Coder a slim per-story view + any owned/reused `shared_artifacts[].canonical_representation`; each Coder edits, commits, runs nothing, returns a `patch_path`. **A2 — apply serially** — `applyPatch` (`git am --3way`) each patch onto `apply_target` in plan order; on conflict re-dispatch the Coder in rebase mode (a Phase A retry, NOT counted against `max_fix_attempts`); set `story.status = "merged"`; remove the detached checkout. Re-read `base_sha` from `apply_target` HEAD before each group so leaf stories see the prior blocking group's shared surface. **After all merges**, run the wave's `end_of_wave_actions[]` (step 4.5) — a non-zero exit is infrastructure-class (pause, no fix loop). Per `references/execution-protocol.md`.
- **Phase B** — merge wave-N → main worktree's branch (worktree_parallel; no-op in single_mounted_serial — A2 already committed onto main); start services per `repos.json[].testing`; dispatch the four gate agents in parallel; run the adaptive fix loop on failure. Fix-loop speed rules: fix **trivial** gate issues inline on the mount (single-file, mechanical, no logic change) instead of cold-starting a coder; batch service restarts **once** after all of an attempt's fixes merge (health-check before any gate dispatches); on subsequent attempts, **code_review** runs against the incremental fix diff only — **UAT, UX, and spec_compliance always re-run full** against the integrated system. Verify per-changed-file, serially — never the full wave suite. The UX gate runs its per-story compares in parallel (read-only renders, one session per story — no DB-write surface); UAT/spec-compliance/code-review dispatch is unchanged.

**On wave-complete — curate findings.** When the wave flips to `complete`, before advancing:
collect `candidate_findings[]` from the four gate reports and any `CANDIDATE_FINDINGS:` blocks in
coder reports, dedup against existing `epic.json.findings[]` and drop anything already covered by a
finding/ADR/convention, assign ids, set `forward_to_waves[]` on regression risks, and write the
keepers to `epic.json.findings[]` (safe-write). Propose promotion of any durable `repo_gotcha` to
`repos.json` conventions (user-confirmed). Full rules: `references/execution-protocol.md` →
"Findings". This is also where `state.json.gate_runs[]` is recorded — do both writes before the
next wave starts.

When the protocol says "blocked," you pause for the user. When it says "all pass," you mark stories `done` and advance.

## Tools

- `scripts/worktree-manager.js` — `createWorktree`, `createDetachedCheckout` (A1 throwaway checkouts), `applyPatch` (A2 `git am --3way` with conflict detection + abort), merge with conflict handling, remove.
- `scripts/service-runner.js` — `reposForWave`, `startService`, stop.
- `scripts/validate-wave-gate-report.js` — schema-validate every gate report before trusting it.

## Dispatch templates

**Each gate agent** (one Task call per gate, dispatched in parallel) gets:
- `wave_id`, `attempt`, `wave_dir = <plugin-data-root>/<project>/<epic>/wave-N`
- The gate-specific data the agent's prompt requires.

**Each A1 Coder** (one per story in the group, dispatched in parallel) gets:
- A **slim per-story view** — the story + its AC + DOD + repo `conventions` + any owned/reused `shared_artifacts[].canonical_representation`. NEVER the raw `state.json` (it can exceed 700KB; slicing is a dispatch-input optimization only — the gates still read raw state).
- The `base_sha` and its detached checkout path.
- It returns `files_changed[]` + `patch_path` (from `git format-patch base_sha..HEAD`). It runs nothing.

**Fix Coder** (attempt 1, `same_coder_more_context`) gets:
- The original story + acceptance criteria.
- The gate report's open issue (description, screenshot, suggested_fix).
- Instructions to fix locally and commit on the same branch.

**Researcher** (attempt 2, `different_coder_with_spike`) gets:
- The issue description + history of all previous fix attempts.
- A request for a findings document explaining root cause.
- Pair with a fresh Coder dispatched after the Researcher reports.

**Attempt 3** (`pause_for_user`): surface issue + history; user picks fix / defer / replan / abort. Don't dispatch anything until the user responds.

## Invariants — never violate

1. Never write `done` to a story until its wave is `complete`.
2. Never advance to the next wave until the current wave is `complete`.
3. Always validate gate reports against `wave-gate-report-schema.json` before trusting them.
4. Always cleanup worktrees on success; record orphans in `state.json.orphaned_worktrees[]` on failure.
5. Never run services or tests in worktrees OR detached checkouts — A1 codegen runs nothing; only the main worktree/mount runs services, only Phase B verifies.
6. Never advance the wave when any gate has `status: "blocked"`. Blocked is infrastructure, not a code defect — the fix loop won't help. Pause for the user.
7. Never enter the fix loop on a `blocked` gate.
8. Never trust an agent's self-report of state — re-read `state.json` after every write. In particular, a worktree-mode Coder report cannot assert specs pass / rubocop clean — only the wave gate establishes pass/fail.
9. Never dispatch a non-blocking group before every blocking group in the wave has merged. The blocking group lands the shared surface; fanning out reusers first re-creates the race it exists to prevent.
10. Never let two coders provision/migrate the shared test DB concurrently — provision once before dispatch.

## Escalation

| Trigger | Action |
|---------|--------|
| Gate returns `status: "blocked"` | Stop services, set `wave.status = "blocked"`, surface gate name + blocked-issue description + concrete recovery steps (e.g. "check Chrome MCP, verify port 4125 free"). Wait for user. |
| Service fails to start during Phase B startup | Surface as infrastructure issue immediately — does NOT count against fix attempts. Same recovery flow as a blocked gate. |
| End-of-wave action fails (Phase A step 4.5) | Set `wave.status = "blocked"`, surface failed action name + stderr + the wave's worktree path. Do NOT enter fix loop — codegen failures are infrastructure-class (the action's command was wrong, the repo's `regenerate_commands` are stale, or a registry-file merge produced a conflict the orchestrator can't auto-resolve). User options: fix manually in the wave worktree and re-run / abort. |
| Preflight requirement verification fails (Phase B step 0) | Set `wave.status = "blocked"`. Surface `id`, `description`, `owner`, and `documentation_url` from the failing `plan.preflight_requirements[]` entry. Do NOT enter fix loop — this is human-gated work (Bedrock model access, LaunchDarkly flag, manual data seed). User completes the requirement out-of-band and the wave re-runs Phase B from step 0. |
| Code-defect failure still open at attempt 3 | Pause for user; honor their choice (fix manually / defer / replan / abort) without trying to be clever. |
| Coder reports `NEEDS_CONTEXT` "I invented a representation/persistence/identity shape the spec didn't define" | **Halt the wave** (do not merge, do not let siblings proceed). The spec left a load-bearing data-model decision unmade and a parallel sibling is likely making it differently. Resolve it in the spec / the plan's `shared_artifacts[].canonical_representation`, then re-dispatch the affected coders with the pinned shape. Never reconcile after the fact. |
| `git worktree remove` fails | Log to `state.json.orphaned_worktrees[]`, keep going. |

**Auto-capture before every pause.** For each escalation above that pauses the user
(`pause_for_user` at attempt 3, any `blocked` gate, an end-of-wave-action failure, or a Coder
`NEEDS_CONTEXT` halt), write a finding to `epic.json.findings[]` BEFORE surfacing to the user —
`category: process` (`spec_gap` for NEEDS_CONTEXT), `audience: [orchestrator, human]`,
`resolution: open`, `source: "escalation: <which>"`, with `owner_followup` describing the choice
the user faces. See `references/execution-protocol.md` → "Findings".

### Ultracode advisory

Purely advisory — never enable on the user's behalf. When pausing the user for one of the cases below, mention that Claude Code's `ultracode` setting (Max/Team/Enterprise; sets effort to xhigh and unlocks dynamic workflows with many parallel subagents) is well-suited to the situation, and let them decide:

- A `pause_for_user` at fix-attempt 3 on the same issue — refuting a stubborn defect benefits from broader parallel investigation.
- A wave with 6+ stories about to enter Phase A — more headroom for parallel Coders.
- A `blocked` wave the user is choosing to `replan` rather than defer.

Don't surface it on infrastructure-blocked gates (Chrome MCP down, service won't start) — more agents won't fix that. Don't repeat the advisory within the same wave once given.
