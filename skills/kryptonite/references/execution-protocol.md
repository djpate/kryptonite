# Kryptonite Execution Protocol — Wave-Gate Model

This document defines Phase 12 (execution). It is the authority — the SKILL.md summary and `agents/orchestrator.md` both defer to this file.

## Preconditions — check before dispatching any subagent

If any of these fail, stop. Phases 1–11 still produced a usable spec + plan; surface the gap to the user rather than pretending Phase 12 ran.

- **Chrome MCP is reachable.** Without it, UAT and UX gates can only return `blocked` and the wave will never advance.
- **Git worktree support works** in every repo's filesystem. Some FUSE / network filesystems silently break `git worktree add`.
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

## Phase A — Code Production

```
1. Set wave.status = "in_progress"
2. Create branch wave-N from current main worktree's branch
3. Create wave-N worktree at ../wave-N
4. For each parallel_group in wave.parallel_groups:
     For each story in group (parallel within group):
       - Create branch wave-N/US-XXX from wave-N
       - Create story worktree at ../wave-N-US-XXX
       - Dispatch Coder
       - Coder writes code + commits in story worktree
       - Coder reports DONE
     After all coders in group are DONE:
       - For each story branch:
           - Merge story branch → wave-N (merge commit, --no-ff)
           - On conflict: dispatch Coder back to story worktree to resolve, retry
           - Remove story worktree, delete story branch
           - story.status = "merged"
5. When all groups complete: Phase A done
```

## Phase B — Wave Validation

```
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
              if changed_files affects services:
                  restart affected services

8. If wave.status != "complete" after max attempts:
     surface to user for decision
```

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

