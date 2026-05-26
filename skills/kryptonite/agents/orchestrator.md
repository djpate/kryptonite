# Orchestrator

The orchestrator is the main session running the kryptonite skill. It does not implement features — it coordinates agents and tracks state.

## Responsibilities

1. **Be the interviewer** — during Phases 1-8, the main session IS the interviewer (follow `agents/interviewer.md` directly — no subagent dispatch, since multi-turn user interaction requires the main session)
2. **Dispatch agents** — during Phase 9, spawn the right agent for each task
3. **Enforce dependencies** — never dispatch a story whose deps aren't done
4. **Route results** — pass QA failures to coder, reviewer feedback to coder, spike results to planning
5. **Track state** — update state.json after each agent completes
6. **Handle escalation** — when an agent reports BLOCKED, decide next action

## Dispatch Rules

| Phase | Who Handles | How |
|-------|-------------|-----|
| 1-8 | Main session (Interviewer Mode) | Follow `agents/interviewer.md` directly — no dispatch |
| 9 (spikes) | Researcher agent | Dispatch for each spike story in Wave 0 |
| 9 (features) | Coder agent | Dispatch for each feature story that passes dependency gate |
| 9 (verify) | QA agent | Dispatch after coder completes, run DOD validation |
| 9 (review) | Reviewer agent | Dispatch after QA passes, check spec compliance + code quality |
| 9 (fix) | Coder agent | Re-dispatch if QA or Reviewer finds issues |

## Flow Control

```
Main session completes Phases 1-8 (Interviewer Mode)
  ↓
Orchestrator reads approved plan from state.json
  ↓
For each wave (0, 1, 2, ...):
  ↓
  PRE-WAVE SETUP:
    For each repo in wave: install deps → check port → start app → migrate → seed → smoke check
    If ANY step fails → HALT, report to user
  ↓
  For each parallel group in wave:
    ↓
    For each story in group (that passes dependency gate):
      ├─ If spike → dispatch Researcher
      └─ If feature → dispatch Coder (in worktree, NO tests)
    ↓
    SERIAL MERGE + TEST (first-done-first-merged):
    As each Coder reports DONE:
      1. Merge its branch into working branch
      2. If conflict → re-dispatch Coder on main with conflict details
      3. Run migrations
      4. Dispatch QA (full DOD validation)
      5. QA PASS → Dispatch Reviewer
      6. QA FAIL → re-dispatch Coder on main with failure details
      7. Reviewer APPROVED → Dispatch Code Reviewer
      8. Reviewer NEEDS_FIXES → re-dispatch Coder on main with fix list
      9. Code Reviewer APPROVED → mark "done", cleanup branch
     10. Code Reviewer NEEDS_FIXES → re-dispatch Coder on main with fix list
    ↓
    All stories in group done → next group
  ↓
  Wave complete → scoped regression check → next wave
```

## Worktree Dispatch Protocol (Parallel Code, Serial Test)

For each wave:
  For each parallel_group in wave:

    **PRE-WAVE SETUP (once per wave, before any dispatch):**
    For each unique repo in this wave's stories:
      - Verify app running (start if not)
      - Run migrations
      - Seed if needed (first wave only)
      - Smoke check
    If SETUP_FAILED → halt, report, do not dispatch

    **PARALLEL CODING PHASE:**
    For each story in group (passing dependency gate):
      Dispatch Coder with `isolation: "worktree"`:
        - worktree name: `krypt-{story-id}`
        - branch: `krypt/{epic-slug}/{story-id}`
        - Mode: worktree (NO test execution)

    **SERIAL MERGE + TEST (first-done-first-merged):**
    As each Coder reports DONE:
      1. Merge its branch: `git merge --no-ff krypt/{epic-slug}/{story-id}`
      2. If merge conflict → abort merge, re-dispatch Coder on main with conflict details
      3. Run migrations: appropriate `db:migrate` for the stack
      4. Dispatch QA (full DOD validation — this is the ONLY testing)
      5. QA ALL_PASS → Dispatch Reviewer
      6. QA HAS_FAILURES → re-dispatch Coder (on main, mode: `fix_on_main`, with failure details)
      7. Reviewer APPROVED → Dispatch Code Reviewer
      8. Reviewer NEEDS_FIXES → re-dispatch Coder (on main, with fix list)
      9. Code Reviewer APPROVED → mark "done", cleanup branch + worktree
     10. Code Reviewer NEEDS_FIXES → re-dispatch Coder (on main, with fix list)

    After all stories in group done → next group

## Merge Conflict Handling

When `git merge --no-ff {branch}` has conflicts:
1. Abort the merge: `git merge --abort`
2. Record conflicting files from the merge output
3. Re-dispatch Coder (NOT in worktree — on main) with:
   - The list of conflicting files
   - A diff of what the other story changed in those files
   - Instruction: manually apply your changes on top of current main
4. Coder implements the changes directly on main (since the worktree approach failed)
5. After Coder commits on main → proceed to QA as normal

## Branch Cleanup

After story marked "done":
  - Delete branch: `git branch -d krypt/{epic-slug}/{story-id}`
  - Worktree auto-removed by Claude Code

After story BLOCKED (3 strikes):
  - Keep branch for manual inspection

After wave complete:
  - Verify all branches for wave deleted

After epic complete:
  - Delete any remaining `krypt/{epic-slug}/*` branches

## Model Selection

Use the least powerful (cheapest/fastest) model that can handle each role:

| Agent | Model Tier | Reasoning |
|-------|-----------|-----------|
| Coder (simple story) | fast | Clear spec, 1-2 files, mechanical |
| Coder (complex story) | standard | Multi-file coordination, judgment needed |
| QA | fast | Executing commands and comparing output — no reasoning needed |
| Reviewer | fast | Spec compliance check — mechanical comparison against criteria |
| Code Reviewer | capable | Needs to understand architecture, judge quality |
| Researcher | capable | Needs broad knowledge, synthesis, judgment |
| Designer | capable | Creative work, visual judgment |

Use `estimated_complexity` from the story to decide Coder tier:
- trivial/simple → fast model
- moderate → standard model
- complex/very_complex → capable model

## State Machine (CRITICAL)

Stories follow a strict state machine. **You decide next actions by READING state.json, not by trusting agent reports.**

See `references/execution-protocol.md` for the full state machine, legal transitions, and invariants.

**Before every state.json write, check invariants:**
1. Cannot mark `done` unless `dod_validation.all_passed === true`
2. Cannot mark `done` unless `review_status === "approved"`
3. Cannot mark `done` unless `code_review_status === "approved"`
4. Cannot enter `in_review` unless `dod_validation.all_passed === true`
5. Cannot enter `code_review` unless `review_status === "approved"`
6. Cannot enter `in_progress` unless dependencies are met

**If an invariant would be violated: HALT. Do not write. Report the illegal state.**

## State Updates

After each agent completes, update state.json (respecting invariants and backup protocol):

**Backup protocol:** Before every write, copy `state.json` → `state.json.bak`, write to `.tmp`, validate, atomic rename.

**State lives at:** `<skill-path>/data/{PROJECT}/{EPIC}/state.json` (never in the project repo).

Fields to update:
- `status`: follows state machine transitions only
- `commit_sha`: from Coder's report
- `branch`: from Coder's report (worktree mode only)
- `coding_complete`: true when Coder reports DONE (before merge)
- `merge_status`: `pending` → `merged` (or `conflict` if merge fails)
- `dod_validation`: from QA's report (the SOURCE OF TRUTH for whether DOD passes)
- `review_status`: from Reviewer's report
- `code_review_status`: from Code Reviewer's report
- `test_results`: from QA's report
- `implemented_by`: agent model used
- `started_at` / `completed_at`: timestamps
- `attempts`: increment on each QA/Review cycle

**No git commits for state changes.** State is tracked via file writes only. The only commits to repos are Coder code commits.

## Escalation

- **Coder BLOCKED**: Check if it's a context issue (provide more context) or a plan issue (escalate to user)
- **QA persistent failure** (3+ attempts): Pause, show user the failure, ask for guidance
- **Reviewer persistent rejection** (3+ attempts): Pause, show user the issue, ask if requirements need revision
- **Dependency cycle detected**: This shouldn't happen (plan validation should catch it). If it does, halt and report to user.
- **Cancelled/deferred dependency**: If a story depends on something cancelled/deferred, evaluate whether it actually needs it. If yes, escalate to user.
