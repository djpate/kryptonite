# Execution Protocol (Phase 12)

Full execution procedures for the orchestrator during Phase 12.

## State Machine (ENFORCED)

Stories follow a strict state machine. **Illegal transitions are not allowed regardless of what agents report.**

```
LEGAL TRANSITIONS:
  pending       → in_progress    (when dispatched to Coder)
  in_progress   → qa_validation  (when Coder reports DONE — automatic, orchestrator dispatches QA)
  qa_validation → in_progress    (when QA reports HAS_FAILURES — back to Coder)
  qa_validation → in_review      (when QA reports ALL_PASS — only transition if dod_validation.all_passed === true)
  in_review     → in_progress    (when Reviewer reports NEEDS_FIXES — back to Coder)
  in_review     → done           (when Reviewer reports APPROVED)
  pending       → cancelled
  pending       → deferred
  in_progress   → blocked        (when Coder reports BLOCKED)
  in_progress   → cancelled

ILLEGAL (never allowed):
  in_progress   → done           (SKIPS QA — forbidden)
  qa_validation → done           (SKIPS Reviewer — forbidden)
  pending       → done           (SKIPS everything — forbidden)
  ANY           → done           (unless dod_validation.all_passed === true AND review_status === "approved")
```

### Invariants (checked before EVERY state write)

Before writing any status change to state.json, verify these invariants. If ANY invariant is violated, **HALT and do not write the change**:

```
INVARIANT 1: Cannot mark "done" without passing DOD
  story.status === "done" REQUIRES:
    story.dod_validation !== null
    story.dod_validation.all_passed === true
    story.dod_validation.items_passed === story.dod_validation.items_total

INVARIANT 2: Cannot mark "done" without review approval
  story.status === "done" REQUIRES:
    story.review_status === "approved"

INVARIANT 3: Cannot enter "in_review" without passing QA
  story.status === "in_review" REQUIRES:
    story.dod_validation.all_passed === true

INVARIANT 4: Cannot dispatch without dependencies met
  story.status === "in_progress" REQUIRES:
    ALL story.dependencies have status "done" OR "cancelled"/"deferred"
```

If the orchestrator finds itself about to violate an invariant, it means something went wrong upstream. **Stop. Do not proceed. Report the illegal state.**

### Decision Logic (read state, not agent reports)

The orchestrator decides what to do next by READING state.json — not by trusting what an agent said:

```
For each story in the current wave:
  READ story.status from state.json

  if status === "pending" AND dependencies met:
    → dispatch Coder, set status = "in_progress"

  if status === "in_progress" AND Coder has reported:
    → set status = "qa_validation", dispatch QA

  if status === "qa_validation":
    READ story.dod_validation from state.json
    if dod_validation.all_passed === true:
      → set status = "in_review", dispatch Reviewer
    if dod_validation.all_passed === false:
      → set status = "in_progress", re-dispatch Coder with failures

  if status === "in_review":
    READ story.review_status from state.json
    if review_status === "approved" AND dod_validation.all_passed === true:
      → set status = "done"
    if review_status === "needs_fixes":
      → set status = "in_progress", re-dispatch Coder with fix list

  if status === "done":
    → skip (already complete)

  if status === "blocked":
    → escalate (count attempts, halt after 3)
```

---

## Dependency Gate

Before dispatching ANY story, the orchestrator MUST verify:

```
For story X about to be dispatched:
  1. Read X.dependencies from state.json
  2. For each dependency ID:
     - Check state.json: is that story's status === "done"?
     - If ANY dependency is NOT done (and not "cancelled"/"deferred") → BLOCK. Do not dispatch X.
     - If a dependency is "cancelled" or "deferred" → evaluate whether X actually needs it. If yes, BLOCK and escalate to user. If no, treat as satisfied.
  3. Only when ALL dependencies are satisfied → dispatch X
```

This is a hard gate, not a suggestion. A story with unmet dependencies must not be dispatched regardless of wave assignment. If a wave contains stories with inter-dependencies, they run in dependency order within that wave.

## Spike Execution (Wave 0)

Spikes execute first. For each spike:
1. Dispatch **Researcher** agent (`agents/researcher.md`) with the spike's acceptance criteria
2. Researcher produces findings document at the path specified in the DOD
3. Dispatch **QA** agent to validate via `file_exists` method
4. If the Researcher's findings include implications for dependent stories, update those stories' acceptance criteria and DOD in state.json before proceeding to Wave 1

## Parallel Agent Dispatch (Waves 1+)

For each wave, execute stories that can run in parallel simultaneously:

1. **Dependency check** — for each story in the wave's parallel group, verify all dependencies are "done" in state.json. Skip any that aren't ready yet.
2. **Dispatch Coder** agents in parallel (`agents/coder.md`) — one per story that passes the dependency check. Each Coder is dispatched with `isolation: "worktree"` and mode `worktree`. **Include the story's `repo` field** so the Coder knows which repo to work in (path, stack, run/test commands from `epic.json`). Coders do NOT run tests in worktree mode.
3. **Serial merge + test** (first-done-first-merged): as each Coder reports DONE, the orchestrator merges its branch and runs the verification pipeline serially:
   - **Merge**: `git merge --no-ff krypt/{epic-slug}/{story-id}` into the working branch
   - **If merge conflict**: abort merge, re-dispatch Coder on main with conflict details (mode: `fix_on_main`)
   - **Run migrations**: appropriate `db:migrate` for the repo's stack
   - **Dispatch QA** (`agents/qa.md`) — runs every DOD item's validation command. ALL must pass.
   - **Dispatch Reviewer** (`agents/reviewer.md`) — checks spec compliance + code quality
4. **QA is a hard gate** — if any DOD validation fails:
   - QA reports HAS_FAILURES with details (expected vs actual per item)
   - Orchestrator re-dispatches Coder on main (mode: `fix_on_main`) with the failure details
   - After Coder fixes, re-dispatch QA
   - Repeat until QA reports ALL_PASS
   - Only THEN dispatch Reviewer
5. **Reviewer is a hard gate** — if NEEDS_FIXES:
   - Orchestrator re-dispatches Coder on main with the fix list
   - After Coder fixes, re-dispatch QA (full DOD re-check), then Reviewer
   - Repeat until Reviewer reports APPROVED
6. **Update state** only after ALL gates pass:
   - Set status to "done"
   - Record commit SHA (from Coder's last commit in the story's repo)
   - Record test results (pass/fail + details per DOD item)
   - Record which agent implemented it
   - Record DOD validation results
   - **Cleanup**: delete the story's worktree branch
   - **Commit state change**: orchestrator commits `.kryptonite/` state update in the project repo
7. **Sequential stories** within a wave run after their dependencies finish

## Worktree Isolation Protocol

### Why

Parallel Coder agents sharing one repo corrupt each other's database via
migrations and concurrent spec runs. Worktree isolation separates the coding
phase (parallel, no tests) from the testing phase (serial, on main).

### Rules

1. ALL Coder agents in a parallel group are dispatched with worktree isolation
2. Coders do NOT run tests, migrations, static checks, or anything that touches shared state
3. Coders ONLY write code and commit to their isolated branch
4. The orchestrator merges branches one at a time into the working branch
5. QA runs on main after each merge (serial — only one QA at a time)
6. Fix cycles happen on main (NOT back in the worktree)

### Merge Order

First-done-first-merged within a parallel group. When multiple Coders finish
simultaneously, merge in order: dependency order > priority > story ID.

### State Tracking

Per-story fields added during execution:
- `branch`: `krypt/{epic-slug}/{story-id}`
- `coding_complete`: true/false (set true when Coder reports DONE, before merge)
- `merge_status`: `pending` | `merged` | `conflict`

The state machine transitions remain unchanged. `in_progress → qa_validation`
still happens when QA is dispatched — which is now post-merge, not post-code.

### Single-Story Parallel Groups

If a parallel group contains only ONE story, worktree isolation is still used
for consistency. The merge is trivially fast-forward.

### Coder Feedback Formats

When QA fails post-merge, re-dispatch Coder with:
```json
{
  "feedback_type": "qa_failure",
  "story_id": "US-005",
  "mode": "fix_on_main",
  "repo": { "path": "...", "test": "bundle exec rspec" },
  "failures": [
    {
      "description": "POST /tickets returns 201",
      "method": "test_suite",
      "expected": "exit 0",
      "actual": "exit 1",
      "error_detail": "NoMethodError: undefined method 'priority' for Ticket...",
      "spec_file": "spec/requests/tickets_spec.rb:45",
      "possible_interaction": null
    }
  ],
  "merged_before": ["US-003", "US-004"],
  "instruction": "Fix the failing specs. You are on the main branch. Run only the specific failing specs to verify."
}
```

When a merge conflict occurs, re-dispatch Coder with:
```json
{
  "feedback_type": "merge_conflict",
  "story_id": "US-005",
  "mode": "fix_on_main",
  "repo": { "path": "..." },
  "conflicting_files": ["db/migrate/20260526_add_priority.rb", "app/models/ticket.rb"],
  "conflict_context": "US-003 (merged earlier) added a 'status' column to tickets. Your migration also modifies the tickets table.",
  "your_branch_diff": "... (summary of what you changed)",
  "instruction": "Apply your changes manually on top of current main. Do not merge — implement directly."
}
```

## Commit Protocol

### Coder Commits (in story's repo)
The Coder agent commits in the story's assigned repo:
- `feat({story-id}): {description}` — initial implementation
- `fix({story-id}): address QA feedback` — after QA failure
- `fix({story-id}): address review feedback` — after Reviewer rejection

### Orchestrator Commits (in project repo where .kryptonite/ lives)
The orchestrator commits `.kryptonite/` state changes at these points:
- After each spike completes: `kryptonite({EPIC}): spike {story-id} complete`
- After each story reaches "done": `kryptonite({EPIC}): {story-id} validated`
- After UAT passes for a wave: `kryptonite({EPIC}): wave {N} complete`
- After epic completion: `kryptonite({EPIC}): epic complete`

### Multi-Repo
Each repo gets its own commits independently. `state.json` records the commit SHA from each repo — that's the only cross-repo link. No git-level coordination (tags, submodules, etc.).

## Automated DOD Validation

For each DOD item on a story, run its validation:

```
For each item in story.definition_of_done:
  method = item.validation.method
  command = item.validation.command
  expected = item.validation.expect

  if method === "curl":
    Run the curl command, capture output
    Assert output matches expected (status code, body pattern, etc.)

  if method === "chrome_mcp":
    Execute the structured command steps (see DOD Validation Methods in SKILL.md)
    Assert all steps pass

  if method === "test_suite":
    Run the test command
    Assert exit code 0 and output contains expected pattern

  if method === "file_exists":
    Check the file path exists and is non-empty

  Record: { item, passed: true/false, actual_output, expected }
```

A story is NOT done until every DOD item's validation passes. No exceptions.

## Between Waves

After a wave completes:

**Scoped regression checks** (not full regression — that's too expensive):
- Re-run DOD validations for stories that share modified files with the just-completed wave
- Re-run DOD validations for stories that have dependencies in the just-completed wave
- Full regression (all stories) only happens at final verification

Rationale: full regression after every wave causes O(n^2) validation cost as epics grow. Scoped checks catch real regressions while keeping execution fast.

Additional between-wave steps:
- Run the full test suite (per repo) to verify no regressions
- Update the dashboard (state.json is the source of truth)
- Show a wave completion summary with DOD pass/fail per story
- If a regression is detected (previously passing DOD now fails), STOP and fix before continuing
- Then proceed to **UAT** before the next wave

## User Acceptance Testing (Per Wave)

After a wave passes all automated checks (QA + Reviewer + scoped regression), run UAT before proceeding to the next wave. UAT is done by the **QA agent** in a different mode — it drives the app through user flows and reports findings.

### UAT Process

1. **Identify testable flows** — from the wave's stories, derive the end-to-end user journeys that should now work. Example: Wave 1 completed "create post" and "publish post" → UAT flow: "author creates a post, saves draft, publishes it, reader can see it on the feed."

2. **Dispatch QA in UAT mode** — the QA agent uses Chrome MCP to walk through each flow:
   - Navigate the app as each relevant party
   - Execute the happy path for each story in the wave
   - Check that cross-story flows work together (not just individual DODs)
   - Screenshot each key state for evidence
   - **For multi-repo stories**: verify the integration between services (e.g., API returns data, frontend renders it)

3. **UAT Report**:
   ```json
   {
     "status": "PASS",
     "wave_id": 2,
     "flows_tested": [
       {
         "name": "Author publishes post, reader sees it",
         "steps": ["Navigate /editor", "Create post", "Publish", "Switch to reader", "Check feed"],
         "passed": true,
         "screenshots": ["uat-wave2-flow1-step3.png"]
       }
     ],
     "issues": []
   }
   ```

4. **If UAT finds issues**:
   - Issues that violate a story's DOD → this means QA automated checks missed something (file a fix, re-run DOD)
   - Issues that are cross-story integration problems → create a new story or amend an existing one
   - Report to orchestrator, who decides: fix now (re-dispatch Coder) or note for next wave

5. **UAT PASS** → proceed to next wave. **UAT FAIL** → fix issues, re-run UAT, then proceed.

### Multi-Repo UAT

For waves that span multiple repos:
- Start all relevant services (using `run` commands from each repo in `epic.json`)
- Test the integration points: API serves data, frontend renders it, admin panel consumes it
- Verify that cross-repo contracts hold (e.g., frontend expects the shape the API returns)

## On Completion

When all waves are done:
- Final verification: re-run ALL DOD validations across all stories
- Kill the comment server
- Update state.json: `"phase": "complete"`
- Present final summary: all commit SHAs, DOD validation results, test results

## Mid-Execution Amendments

If a story's requirements need to change during execution:
1. Pause execution (don't dispatch new stories)
2. Update the story's acceptance_criteria and/or definition_of_done in state.json
3. Set `"amended": true` on the story and append to `amendment_history`
4. If DOD validation commands changed, mark the story as "pending" (re-do it)
5. If the change affects wave ordering (new dependency), re-plan remaining waves
6. Resume execution

The dashboard shows amended stories with a visual indicator.

Amendment tracking fields on each story:
```json
{
  "amended": false,
  "amendment_history": []
}
```

When an amendment occurs, append:
```json
{
  "changed_at": "ISO timestamp",
  "fields_changed": ["acceptance_criteria", "definition_of_done"],
  "reason": "User requested additional validation for edge case"
}
```
