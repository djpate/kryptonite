# State Machine, Tracking, and Commit Rules

This document defines what gets persisted to `state.json` and which states are legal. The orchestrator (`agents/orchestrator.md`) and the wave-gate execution loop (`references/execution-protocol.md`) both rely on these rules.

## State File Location

`<skill-path>/data/{PROJECT}/{EPIC}/state.json` — resolved from the active epic via `active.json` (see `references/storage-protocol.md`).

## State Machines

### Story states

```
pending → in_progress → merged → done
                                ↘ blocked   (wave gate failed and user deferred this story)
pending → cancelled / deferred
```

### Wave states

```
pending → in_progress (Phase A coding) → gates_running (Phase B gates) → complete
                                                                       ↘ blocked   (gate returned blocked, or fix loop exhausted)
```

### Illegal transitions

- `in_progress → done` directly. A story must reach `merged` first, then promotes to `done` only when its wave reaches `complete`.
- A wave reaching `complete` while any of its four gates has status `fail` or `blocked` in the latest gate run.

### Invariants (checked before every state write)

1. A story's `done` status only sets when its wave's status is `complete`.
2. A wave only reaches `complete` when all four gate reports in the latest gate run have `status: "pass"`.
3. A wave with any gate `status: "blocked"` pauses for the user — no fix loop, no advance.
4. A story cannot enter `in_progress` until all its dependencies have `merged` or `done` status.

## What Gets Tracked Per Story

Every story conforms to `references/story-schema.json` plus these execution-time fields:

- `wave` / `parallel_group` — wave assignment from Phase 11. **`state.json` is the source of truth for `story.wave`** — `plan.json` describes intent (where the planner placed the story), `state.json` describes execution. The two must agree at plan-approval time; `scripts/validate-plan.js` enforces this when invoked with the optional `state.json` argument. If they drift mid-execution (e.g. amendment moved a story to a later wave), update `state.json` and regenerate the plan.
- `status` — see story states above
- `commit_sha` — from Coder's report
- `merged_at` — ISO timestamp when the story's patch was applied onto the apply_target (git am --3way; the wave-N worktree in worktree_parallel, or the main branch in single_mounted_serial)
- `implemented_by` — agent model used
- `started_at` / `completed_at` — timestamps
- `amended` / `amendment_history` — tracks mid-execution changes
- `attempts` — number of fix-loop cycles for this story across all gates (escalates per the adaptive retry policy in `references/execution-protocol.md`)

## What Gets Tracked Per Wave

Per `references/execution-protocol.md`, each wave in `state.json.waves[]` includes:

- `status` — see wave states above
- `branch` — the wave branch name
- `merged_to_main_at` — ISO timestamp
- `gate_runs[]` — immutable history of gate attempts. Each entry contains the four gate statuses (`pass`/`fail`/`blocked`) with `report_path`, plus `issues[]` with `fix_attempts[]` for adaptive retry tracking

## Dashboard

The `/dashboard` route (served by `scripts/comment-server.js`) renders a live view of `state.json`: progress bar, wave breakdown, latest gate statuses (UAT/UX/spec compliance/code review with pass/fail/blocked), commit SHAs, agent attribution, and amendment markers.

## Commit Rules

Only CODE commits go into repos. Kryptonite state lives in the plugin folder and is never committed to any project repo.

### Story Commits (in the story's assigned repo)

| When | Commit Message |
|------|---------------|
| Coder implements story | `feat({story-id}): {short description}` |
| Coder fixes QA failure | `fix({story-id}): address QA feedback` |
| Coder fixes review feedback | `fix({story-id}): address review feedback` |
| Coder re-applies after merge conflict | `feat({story-id}): re-apply after conflict with {other-story}` |
| Story fully validated (done) | No extra commit — the last fix/feat commit is the final one |

### Rules

- **Only Coder agents commit to repos.** The orchestrator never commits state files.
- **State tracking is file-based.** `state.json` changes are persisted via writes to the plugin data folder (with the backup protocol in `references/storage-protocol.md`), not via git.
- **For multi-repo stories:** each repo gets its own commit independently. `state.json` records both SHAs.
- **Never commit secrets.** `testing_notes` in `repos.json` may reference credentials but those should come from env vars or a vault.
