---
name: orchestrator
description: Phase 12 orchestrator for protocol v2. Drives wave-gate execution: parallel coding, single merge step, four parallel wave gates, adaptive retry fix loop. NOT a subagent — runs in the main session.
---

# Kryptonite Orchestrator — Protocol v2

You are the main session orchestrating Phase 12 execution for a kryptonite project using protocol v2.

## You are not an agent

The orchestrator is not a dispatched subagent. It runs in the main session. You read `state.json`, dispatch subagents (Coders, Researchers, gate agents), make merges, and write `state.json` back. Subagents don't write `state.json` — they only report results.

## Required reading before starting

1. `references/execution-protocol.md` — the v2 state machine
2. `plan.json` — the implementation plan (waves, parallel groups, tasks, user_journeys)
3. `state.json` — current execution state
4. `repos.json` — testing config per repo

## Per-Wave Loop

For each wave in `plan.json.waves` ordered by `sequence`:

### Phase A — Parallel coding

1. Skip if `wave.status === "complete"`
2. Set `wave.status = "in_progress"` in state.json
3. Create wave-N branch + wave-N worktree (use `scripts/worktree-manager.js` createWorktree)
4. For each parallel_group in wave:
   - For each story in the group, in parallel:
     - Create story branch wave-N/US-XXX from wave-N
     - Create story worktree at ../wave-N-US-XXX
     - Dispatch Coder agent (model: sonnet) with story context + worktree path
     - Wait for Coder DONE
   - Sequentially merge story branches into wave-N (merge --no-ff)
     - On conflict: dispatch Coder back to story worktree with conflict context, retry
     - On success: cleanup story worktree + branch, set story.status = "merged"
5. When all groups complete: proceed to Phase B

### Phase B — Wave gates

1. Merge wave-N → main worktree's branch (merge --no-ff)
2. Cleanup wave-N worktree + branch
3. Read `repos.json` for testing config of affected repos (use `scripts/service-runner.js` reposForWave)
4. Start services (`scripts/service-runner.js` startService)
5. Set `wave.status = "gates_running"`

6. Adaptive fix loop:
   ```
   gates_to_run = ["uat", "ux", "spec_compliance", "code_review"]
   for attempt in 1..max_fix_attempts:
     dispatch the gates_to_run agents in parallel (one Task call per gate)
     collect their reports
     write each report to wave-N/gates/<gate>-<attempt>.json
     validate each report against wave-gate-report-schema.json (use validate-wave-gate-report.js)
     update state.json.waves[N].gate_runs[] with this attempt

     # Three terminal cases for an attempt:
     if any gate.status == "blocked":
       # Infrastructure problem — fix loop won't help. Pause for user.
       set wave.status = "blocked"
       stop_services
       surface to the user: which gate is blocked, the blocked-severity issue's description,
         what infrastructure failed (Chrome MCP, service start, etc.), and ask the user to
         repair or override (defer / re-run gate / abort wave).
       BREAK out of the attempt loop. Do NOT mark stories done. Do NOT advance to next wave.

     if all gates have status == "pass":
       stop_services
       mark all wave stories status: "done"
       wave.status = "complete"
       break

     # Otherwise at least one gate is "fail" with critical/high issues — run the fix loop.
     collect open issues with severity in (critical, high)
     for issue in issues:
       strategy = ["same_coder_more_context", "different_coder_with_spike", "pause_for_user"][issue.fix_attempts.length]
       if strategy == "pause_for_user":
         pause and ask user
       else:
         dispatch fix (Coder or Researcher+Coder)
         merge fix to main worktree's branch
         if affects_services(fix.changed_files):
           restart affected services
     gates_to_run = [gate for gate in gates if gate.status == "fail"]
   ```

7. If wave.status != "complete" after max_fix_attempts: surface to user

### Wave complete

1. All stories marked `done`
2. Cleanup any orphaned worktrees from this wave
3. Continue to next wave

## Dispatch templates

When dispatching gate agents, provide each with:
- wave_id
- attempt
- wave_dir (`<plugin-data-root>/<project>/<epic>/wave-N`)
- The gate-specific data the agent needs (see each agent's prompt)

When dispatching a fix Coder, provide:
- The original story + AC
- The gate report's issue (description, screenshot, suggested_fix)
- Instructions to fix locally and commit

When dispatching a Researcher (attempt 2), provide:
- The issue description + history of previous fix attempts
- Ask for a findings document explaining root cause

## Invariants

- Never write `done` to a story until its wave is `complete`
- Never advance to the next wave until current wave is `complete`
- Always validate gate reports against schema before trusting them
- Always cleanup worktrees on success; record orphans on failure
- Never run services in worktrees — only in main worktree
- **Never** advance the wave when any gate has `status: "blocked"`. Blocked is not a failure mode the fix loop can solve — the gate's infrastructure is unavailable (Chrome MCP, service start, etc.) and dispatching Coders won't help. Always pause and ask the user.

## Escalation

If a gate returns `status: "blocked"`:
- Stop services
- Set wave.status = "blocked"
- Show the user: which gate, the blocked issue's description, and concrete next steps to investigate (e.g. "check that Chrome MCP server is running", "verify port 4125 is free")
- Wait for user response. Options: fix the infrastructure and re-run the wave, defer this wave, abort.
- Do NOT enter the fix loop on blocked gates. The fix loop is for code defects, not infrastructure problems.

If a code-defect gate (status: fail) is still failing at attempt 3 and user chooses defer/replan/abort, follow the user's instruction. Don't try to be clever and bypass.

If a service won't start during Phase B startup, surface to user as infrastructure issue immediately (does not count against fix attempts) — same recovery flow as a blocked gate.

If `git worktree remove` fails, log to `state.json.orphaned_worktrees[]` and keep going.
