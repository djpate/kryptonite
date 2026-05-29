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
- `merged` — story branch merged into wave-N branch
- `done` — wave passed all gates; set retroactively when wave completes
- `blocked` — wave failed gates and user chose to defer this story
- `cancelled` — user cancelled
- `deferred` — moved to a later wave

## Execution modes

Each repo declares `repos.json[].execution_mode` (default `worktree_parallel`). The mode decides how Phase A isolates story work; the wave/story state machine is **identical** either way — only the physical isolation differs.

- **`worktree_parallel`** (default) — one git worktree per story at `../wave-N-US-XXX`; coders within a parallel group run concurrently; story branches merge into `wave-N`. This is the model the Phase A pseudocode below describes in full.
- **`single_mounted_serial`** — work directly on the **main mounted worktree**; stories applied **sequentially** (one coder at a time, commit per story); no `../wave-N-US-XXX` worktrees and no per-story branches. Required when the dev env mounts only the main worktree into a container (every DOD runs `docker exec` against that one mount, so sibling-worktree code is invisible and untestable). There is no story-branch merge step — each story is committed straight onto `wave-N` in order.

**Mode selection.** The orchestrator reads the `execution_mode` of every repo a wave touches. If they agree, use that mode. If they differ, fall to `single_mounted_serial` for the wave (the safe subset) and log why. In `single_mounted_serial`, the "parallel" in "parallel group" is nominal — groups still define ordering (blocking first), but stories within a group run one at a time.

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
1. Merge wave-N → main worktree's working branch (merge commit)
2. Remove wave-N worktree, delete wave-N branch
3. Read repos.json for testing config of wave's affected repos
4. Start services per repos[].testing.start_command
5. Wait for ready_signal or health_check
6. Set wave.status = "gates_running"

7. Loop attempt = 1..max_fix_attempts:
     a. Determine gates to run:
          - First attempt: all four (UAT, UX, spec_compliance, code_review)
          - Subsequent: only previously-failed gates + any whose validated files were touched by the latest fix
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
          - if strategy == "pause_for_user":
              surface to user, wait for response: fix manually | defer | replan | abort
          - else:
              dispatch fix per strategy
              merge fix → main worktree's branch
              after the fix, verify the changed code by running ONLY the spec file(s)
                for the changed code, SERIALLY — never the wave's full spec set
              if changed_files affects services:
                  restart affected services

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
| Between fix attempts | If fix changed code files: stop+start affected service |
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
| Story merged | Remove story worktree + delete story branch |
| Wave Phase A complete | Remove wave-N worktree + delete wave-N branch |
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

