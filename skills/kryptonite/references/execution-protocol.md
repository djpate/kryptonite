# Kryptonite Execution Protocol — Wave-Gate Model

This document defines Phase 12 (execution). It is the authority — the SKILL.md summary and `agents/orchestrator.md` both defer to this file.

## Preconditions — check before dispatching any subagent

If any of these fail, stop. Phases 1–11 still produced a usable spec + plan; surface the gap to the user rather than pretending Phase 12 ran.

- **Chrome MCP is reachable.** Without it, UAT and UX gates can only return `blocked` and the wave will never advance.
- **Git worktree support works** in every repo's filesystem — *only required for repos in `worktree_parallel` mode*. Some FUSE / network filesystems silently break `git worktree add`; a repo that can't support worktrees (or mounts only its main worktree into a container) should declare `execution_mode: single_mounted_serial` (see "Execution modes").
- **`repos.json` has a `testing` block** for every repo that needs a running service. A missing testing block skips that repo's gate checks with a warning, and the user is on the hook for manual verification.
- **`plan.json` waves have `user_journeys[]` populated.** UAT and UX have nothing to walk otherwise.

## State Machine

Each wave has two phases.

### Wave statuses
- `pending` — not yet started
- `in_progress` — Phase A coding underway
- `gates_running` — Phase B validation underway
- `complete` — all gates passed, advanced to next wave
- `blocked` — either (a) a gate returned `status: "blocked"` because its infrastructure (Chrome MCP, service start) is unavailable, or (b) the fix loop exhausted `max_fix_attempts` on a code-defect failure. In both cases the orchestrator pauses and waits for user input.

### Story statuses
- `pending` — not yet dispatched
- `in_progress` — Coder dispatched, code being written
- `merged` — story patch applied onto apply_target (git am --3way onto wave-N in worktree_parallel, or onto the main branch in single_mounted_serial). No per-story branch exists.
- `done` — wave passed all gates; set retroactively when wave completes
- `blocked` — wave failed gates and user chose to defer this story
- `cancelled` — user cancelled
- `deferred` — moved to a later wave

## Execution modes

Each repo declares `repos.json[].execution_mode` (default `worktree_parallel`). The mode decides ONLY the `apply_target` for sub-phase A2 (where patches are applied) — A1 patch generation is identical in both modes (parallel, one `../patchgen-*` detached checkout per story). The wave/story state machine is **identical** either way; only the physical apply target differs.

- **`worktree_parallel`** (default) — `apply_target` is a dedicated `wave-N` worktree on a `wave-N` branch (created in Phase A step 3). A2 applies each story's patch onto `wave-N`; Phase B merges `wave-N` into the main working branch.
- **`single_mounted_serial`** — `apply_target` is the main worktree's branch directly; there is NO `wave-N` worktree or branch. A2 applies each story's patch straight onto the main branch in order. Required when the dev env mounts only the main worktree into a container (every DOD runs `docker exec` against that one mount, so sibling-worktree code is invisible and untestable) — which is exactly why verification (Phase B) runs serially on that single mount.

**Mode selection.** The orchestrator reads the `execution_mode` of every repo a wave touches. If they agree, use that mode. If they differ, fall to `single_mounted_serial` for the wave (the safe subset) and log why. In BOTH modes A1 patch generation runs in parallel and A2 apply is serial — the modes differ only in whether A2 applies onto a `wave-N` worktree or the main mount.

## Phase A — Code Production (A1 parallel patch-gen → A2 serial apply)

Phase A has two sub-phases. **A1 generates patches in parallel** (no container, no DB, no tests — pure source editing, so it is identical in both execution modes). **A2 applies them serially** onto the wave's mount. This is why the two execution modes collapse into one pipeline: the only mode-dependent variable is `apply_target` (the wave-N worktree vs. the main mount). All verification is Phase B; A1 verifies nothing.

```
1.  wave.status = "in_progress"
2.  Resolve execution_mode (decides apply_target ONLY, not A1)
3.  apply_target =
      worktree_parallel     → create branch wave-N from main worktree's branch; create wave-N worktree at ../wave-N
      single_mounted_serial → the main worktree's branch (no wave-N worktree)
    base_sha = current HEAD of apply_target's branch
3.3 Provision shared test DB ONCE (before any coder is dispatched):
     If any story in this wave touches the DB and the repo has conventions.test_db_setup:
       - Run conventions.test_db_setup once, up front
       - On failure: set wave.status = "blocked", surface as infrastructure (no fix loop), stop
     A1 never touches the DB, so this is the only DB-provision point and the parallel-migrate race is structurally impossible.
3.6 Order parallel groups: blocking groups (blocking: true) FIRST, then non-blocking.
     A blocking group fully clears A2 (its patches applied + merged onto apply_target) BEFORE the
     next group's A1 dispatches, so leaf coders' base_sha already contains the shared surface
     (models, base classes, enums, schema). Re-read base_sha from apply_target HEAD before each
     group's A1 — never cache it from wave start.
4.  For each parallel_group (blocking groups first, per 3.6):
    --- A1: generate patches (PARALLEL, both modes) ---
      For each story in group, concurrently:
        - createDetachedCheckout ../patchgen-wave-N-US-XXX @ base_sha
          (git worktree add --detach; no branch, no container, no DB)
        - Dispatch Coder in write-only mode with the slim per-story view
          (story + AC + DOD + repo conventions + owned/reused shared_artifacts[].canonical_representation)
        - Coder edits source, commits, runs NOTHING
        - Coder reports DONE + files_changed[] + patch_path (git format-patch base_sha..HEAD)
      BARRIER: wait for all coders in the group.
    --- A2: apply + integrate (SERIAL, both modes; deterministic plan order, blocking owners first) ---
      For each story's patch, IN ORDER:
        - applyPatch(apply_target, patch_path)   # git am --3way
        - On conflict (applyPatch returns conflict: true):  [PATCH-CONFLICT path = today's merge-conflict path]
            orchestrator resolves inline if trivial, ELSE re-dispatch Coder in rebase mode
            ("your patch no longer applies onto current tip; here is the hunk; re-emit against current HEAD"),
            then retry applyPatch. This is a Phase A retry — NOT counted against max_fix_attempts.
        - story.status = "merged"
        - Remove that story's detached checkout (../patchgen-wave-N-US-XXX)
4.5 End-of-wave actions (run AFTER all story merges onto apply_target, BEFORE merging wave-N into main):
     For each entry in plan.waves[N].end_of_wave_actions[] (order preserved):
       - Resolve cwd: apply_target (or repo path within it if `repo` is set)
       - Run `command`
       - On non-zero exit:
           - Set wave.status = "blocked"
           - Surface the failed action name + stderr to user
           - Do NOT proceed to Phase B; do NOT enter fix loop (this is infrastructure-class)
           - BREAK
       - Stage and commit any resulting changes with `End-of-wave: <name>`
     For each plan.waves[N].shared_registry_files[] entry with kind in {"merge", "regenerate"} that wasn't already covered by an explicit end_of_wave_actions[] entry:
       - Run `regenerated_by` command in the same way; same failure handling
     If wave.status == "blocked": stop here.
5.  When all groups complete and step 4.5 succeeded: Phase A done
```

**Why this is safe.** A2's apply order is deterministic (plan order, blocking owners first) — identical to today's serial commit order. Conflicts are forced through rebase re-dispatch, never silently dropped. `git am --3way` preserves each story's commit (story ID in the message), so the integrated commit graph Phase B verifies is the same shape as today. Phase B runs every gate against the fully-integrated running system, unchanged.

**Guardrail — intra-group source dependencies (G1).** Parallel A1 means a coder cannot read a sibling story's not-yet-generated code (every checkout is at the same `base_sha`). A true intra-group source dependency MUST be expressed as a blocking-group split (the owner lands first, in an earlier group), per `references/plan-assembly.md`. Do not place two stories where one reads the other's new code in the same non-blocking group.

## Phase B — Wave Validation

```
0. Preflight requirements check:
     For each entry in plan.preflight_requirements[] where wave-N ∈ blocks_waves:
       - Run `verification` (same machinery as DOD validation: curl/chrome_mcp/test_suite/file_exists)
       - If verification fails:
           - Set wave.status = "blocked"
           - Surface the requirement.id, description, owner, documentation_url
           - Do NOT proceed; do NOT enter fix loop (this is human-gated, not a code defect)
           - BREAK out of Phase B
1. worktree_parallel: merge wave-N → main worktree's working branch (merge commit)
   single_mounted_serial: NO-OP — A2 already applied patches directly onto the main branch
2. worktree_parallel: remove wave-N worktree, delete wave-N branch
   single_mounted_serial: NO-OP — no wave-N worktree or branch exists in this mode
3. Read repos.json for testing config of wave's affected repos
4. Start services per repos[].testing.start_command
5. Wait for ready_signal or health_check
6. Set wave.status = "gates_running"

7. Loop attempt = 1..max_fix_attempts:
     a. Determine gates to run:
          - First attempt: all four (UAT, UX, spec_compliance, code_review)
          - Subsequent: only previously-failed gates + any whose validated files were touched by the latest fix.
            code_review on a subsequent attempt runs against the INCREMENTAL FIX DIFF only (its artifact under
            inspection IS the diff, so scoping loses nothing). UAT, UX, and spec_compliance are NEVER scoped down
            to a story↔file map — they always re-run FULL against the integrated running system, because
            cross-story regressions live precisely in the journeys such a map would skip.
     b. Dispatch the four gate agents in parallel
     c. Collect reports, write to wave-N/gates/<gate>-<attempt>.json
     d. **If any gate.status == "blocked"** (infrastructure unavailable):
          - Stop services
          - Set wave.status = "blocked"
          - Surface to user with the blocked-severity issue's description and recovery options
            (repair infrastructure and re-run, defer wave, abort)
          - Do NOT enter the fix loop — fix loop targets code defects, not infrastructure
          - Do NOT mark stories done; do NOT advance to next wave
          - BREAK
     e. If all gates pass:
          - Stop services
          - Mark all wave stories status: "done"
          - Set wave.status = "complete"
          - BREAK
     f. Otherwise (one or more gates "fail"):
        Collect open issues with severity in (critical, high) across failed gates (deduped per gate's dedup_key)
        For each open issue:
          - strategy = retry_strategy(len(issue.fix_attempts))
          - if the issue is TRIVIAL (single-file, mechanical, no logic change — e.g. a missing import,
            a typo'd selector, a lint nit):
              orchestrator fixes it inline on the mount (no fresh-coder dispatch round-trip).
              Anything ambiguous or touching logic is NOT trivial — fall through to dispatch.
          - elif strategy == "pause_for_user":
              surface to user, wait for response: fix manually | defer | replan | abort
          - else:
              dispatch fix per strategy
              merge fix → main worktree's branch
              after the fix, verify the changed code by running ONLY the spec file(s)
                for the changed code, SERIALLY — never the wave's full spec set
        After ALL of this attempt's fixes have merged:
          - If any merged fix changed service files: restart affected services ONCE (batched — not per-issue),
            and WAIT for ready_signal/health_check to pass BEFORE dispatching any gate.
            (If a later fix in the same attempt touches service files after the restart, restart again.)

8. If wave.status != "complete" after max attempts:
     surface to user for decision
```

**Verify per-changed-file, serially.** When a fix lands, run only the spec file(s) covering the changed code — not the whole wave's suite. Two reasons: (a) a full suite is minutes per pass and is the biggest wall-clock sink in a large Rails repo; (b) serial, narrow runs cut contention on the shared test DB (see step 3.3). Accumulated per-file green results ARE the wave's ground truth — there is no value in a final giant all-files run, and it actively slows the wave.

## Adaptive Retry Strategies

| Attempt | Strategy | What happens |
|---------|----------|--------------|
| 1 | `same_coder_more_context` | Re-dispatch original Coder with story + AC + gate report excerpt + screenshots + suggested fix |
| 2 | `different_coder_with_spike` | Spawn Researcher to investigate root cause; spawn new Coder with findings + original issue |
| 3 | `pause_for_user` | Surface issue + history; user picks: fix \| defer \| replan \| abort |

`max_fix_attempts` is configurable in `plan.wave_gate_config.max_fix_attempts` (default 3).

## Service Lifecycle

The orchestrator reads `repos.json[].testing` to know how to start/stop services. It is infrastructure-agnostic (works with marengo, docker-compose, foreman, npm, anything).

| When | Action |
|------|--------|
| Phase B start | `start_command` for each affected repo, wait for ready |
| Between fix attempts | If any of the attempt's fixes changed service files: stop+start affected service ONCE (batched), health-check before any gate dispatches |
| Phase B complete | `stop_command` for each (skip if not provided) |
| User aborts | `stop_command` for all running services |

If a repo has no `testing` block:
- UAT skipped for journeys touching it (warning logged)
- UX skipped for stories in it with `has_mock: true`
- Spec compliance: AC items requiring chrome_mcp/curl auto-fail with reason "no testing config"; code_inspection/test_suite still run
- Code review unaffected

## Worktree Cleanup Guarantees

| Trigger | Action |
|---------|--------|
| Story patch applied (A2) | Remove that story's detached checkout `../patchgen-wave-N-US-XXX` |
| Wave merged to main (Phase B step 2, worktree_parallel) | Remove wave-N worktree + delete wave-N branch |
| A2 aborts mid-loop | Remove all remaining `../patchgen-*` detached checkouts for the wave; record any failed removal in `state.json.orphaned_worktrees[]` |
| Wave complete | (already cleaned) |
| User aborts | Remove all non-main worktrees, record orphans in state.json |
| Cleanup command | Force-remove orphaned worktrees |

If `git worktree remove` fails, record path in `state.json.orphaned_worktrees[]` and continue. Cleanup command sweeps these later.

## Issue Tracking

Issues stored in `state.json.waves[N].gate_runs[]`. Each gate_run is immutable history.

```json
{
  "attempt": 1,
  "started_at": "ISO",
  "completed_at": "ISO",
  "uat": { "status": "fail", "report_path": "wave-2/gates/uat-1.json" },
  "ux": { "status": "pass", "report_path": "wave-2/gates/ux-1.json" },
  "spec_compliance": { "status": "pass", "report_path": "wave-2/gates/spec-compliance-1.json" },
  "code_review": { "status": "pass", "report_path": "wave-2/gates/code-review-1.json" },
  "issues": [{
    "id": "ISSUE-001",
    "gate": "uat",
    "dedup_key": "UJ-001:3",
    "description": "Submit button not visible",
    "severity": "critical",
    "affected_stories": ["US-005"],
    "fix_attempts": [{
      "attempt": 1,
      "strategy": "same_coder_more_context",
      "coder_id": "anthropic-sonnet",
      "started_at": "ISO",
      "completed_at": "ISO",
      "result": "fixed",
      "commit_sha": "abc123"
    }],
    "status": "resolved"
  }]
}
```

Issue IDs are stable within a wave. Re-runs append `fix_attempts[]`. Issues never re-use IDs.

## Findings (durable execution discoveries)

Issues drive the fix loop and are wave-local. **Findings** are the durable lessons a wave teaches —
they outlive the wave and live in `epic.json.findings[]` (schema in `references/epic-schema.json`).
This is the schema slot that replaces the ad-hoc `state.deferred_findings[]`; never write findings
to `state.json` or to a sidecar file.

Five categories: `process` (fix-loop/infra lesson, "what done-right looks like here"),
`repo_gotcha` (a runtime-discovered repo trap — a promotion candidate), `spec_gap` (the spec/plan
was ambiguous and forced a live decision, including any NEEDS_CONTEXT halt), `regression_risk`
(later waves must watch this — pair with `forward_to_waves[]`), and `deferred_defect` (a real
defect intentionally left for later). Default audiences: process → [orchestrator, human];
repo_gotcha → [coder]; spec_gap → [orchestrator, human]; regression_risk → [coder, gate];
deferred_defect → [orchestrator, human]. The curator may override.

### Capture — three paths, one writer

The orchestrator is the **sole writer** of `epic.json.findings[]`. Subagents never write it.

1. **Agents nominate.** Every gate report may carry an optional `candidate_findings[]` array
   (schema in `references/wave-gate-report-schema.json`). Coders nominate via a `CANDIDATE_FINDINGS:`
   block in their text report (they have no JSON schema). These are advisory.
2. **Escalations auto-capture.** Before pausing the user for any escalation (attempt-3
   `pause_for_user`, a `blocked` gate, a Coder `NEEDS_CONTEXT` halt, or an end-of-wave-action
   failure), the orchestrator writes a finding first — `category: process` (or `spec_gap` for
   NEEDS_CONTEXT), `audience: [orchestrator, human]`, `resolution: open`, `source: "escalation: <which>"`.
   This is a deterministic trigger so the highest-value lessons can't be lost.
3. **User flags inline.** "Record this as a finding" → the orchestrator writes it.

### Curation — at each wave-complete and each escalation

1. Collect `candidate_findings[]` from the four gate reports + coder `CANDIDATE_FINDINGS:` blocks.
2. **Dedup** against existing `findings[]` by (file, summary) similarity — the same instinct that
   dedups issues by `dedup_key`. If a candidate restates an existing finding on a sibling file,
   record one finding noting both files, not two.
3. **Drop noise.** A candidate already covered by an existing finding, an ADR
   (`epic.json.decisions[]`), or a repo convention (`repos.json[].conventions`) is NOT recorded
   again. Recurring restatements are a signal to consolidate, not to append — the store must stay
   small enough that the resume digest is useful.
4. Assign `id` (`WAVE<N>-FINDING-NNN`, scoped to the producing wave), set `audience` from the
   category default (override if warranted), set `resolution`.
5. For `regression_risk` findings, set `forward_to_waves[]` to the wave(s) that touch the flagged
   files (read `plan.json` wave assignments). The resume digest surfaces these to the named waves.
6. Write `epic.json` using the safe-write protocol in `references/storage-protocol.md`
   (`.bak` → `.tmp` → atomic rename).

### Promotion — durable repo facts flow to repos.json (two-tier)

A `repo_gotcha` finding that is a *durable fact about the repo* (not specific to this epic) should
be **promoted** into the shared `repos.json[<repo>].conventions`:

- Factory/test-data traps → `conventions.test_data_gotchas[]`.
- Grep false-match traps → `conventions.grep_gotchas[]`.

On promotion: append the summary to the convention array, set the finding's `resolution: "promoted"`
and `promotion_target` (e.g. `"kmsat.conventions.test_data_gotchas"`). Future epics on that repo
then inherit the fact, and Phase-7.5 no longer needs to rediscover it.

**Promotion is proposed, never silent.** `repos.json` is shared across every future epic, so
polluting it is costly. Surface the candidate to the user ("this looks like a durable repo fact —
promote it to repos.json conventions?") and write only on confirmation.

## Pass criteria

A wave is `complete` when:
- All stories in the wave have status `merged`
- The latest gate_run has all four gate statuses: `pass`
- No open `critical`, `high`, or `blocked` severity issues

A wave is `blocked` when any of the following is true:
- A gate in the latest gate_run has `status: "blocked"` (infrastructure unavailable — e.g. Chrome MCP not connected, service won't start). The orchestrator pauses immediately and does NOT enter the fix loop, because the fix loop only targets code defects.
- After `max_fix_attempts` rounds on a code-defect failure, at least one `critical`/`high` issue is still open.
- The user was paused at attempt 3 and chose not to fix/defer.

**Important:** A gate must report `status: "blocked"` (and must NOT report `pass`) when it could not perform its actual validation. UAT cannot fall back to source-code reading and call itself passed; UX cannot fall back to HTML diffing and call itself passed. The whole point of the gate is to exercise the running system. False passes are worse than blocked statuses because they let the wave advance on a lie.

