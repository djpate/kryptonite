# Wave-Gate Execution Model

## Problem

The current Phase 12 execution model has tight per-story gates (QA + Reviewer + Code Reviewer) that run sequentially after each merge. In practice:

- The serial merge-then-three-gates loop bottlenecks parallel work
- DOD validation reliability is poor — agents "give up" after 3 attempts
- UAT is documented in `execution-protocol.md` but never actually dispatched
- No UX review exists despite mocks being approved
- No security review exists at all
- Wave completion is implicit (all stories done) rather than gated by user-meaningful validation

The result is slow execution that still ships bugs because the validation happens at the wrong granularity.

## Solution

Replace per-story gates with **wave-level gates**. Stories merge fast with no validation. At wave end, four agents validate the wave in parallel: UAT, UX, spec compliance, and full code review. Issues are fixed individually with adaptive retry. The wave advances only when all gates pass.

## Design Decisions

- **Eliminate per-story gates** — no QA, Reviewer, or Code Reviewer agents during code production
- **Four parallel wave gates** — UAT, UX, spec compliance, code review run concurrently at wave end
- **Adaptive retry with strategy escalation** — same Coder + context → Researcher + new Coder → user
- **Worktree per story for coding, wave worktree for integration, main worktree for testing**
- **Merge (not rebase) on conflict** — preserves history, dispatches Coder to resolve
- **Repo registry owns testing setup** — kryptonite is infrastructure-agnostic
- **User journeys defined in plan.json** — plan-time, plan-validated, executable
- **Issue-by-issue fix loop** — only failed gates re-run, not all four
- **Clean break** — new projects use protocol v2; old projects continue with v1

---

## Execution Flow

Each wave has two phases.

### Phase A — Code Production

```
Create wave-N branch from current main worktree's branch
Create wave-N worktree at ../wave-N

For each parallel_group in wave.parallel_groups:
  For each story in group (parallel within group):
    Create story branch wave-N/US-XXX from wave-N
    Create story worktree at ../wave-N-US-XXX
    Dispatch Coder to story worktree
    Coder writes code + commits
    Coder reports DONE

  After all coders in group report DONE:
    For each story branch in group:
      Merge story branch → wave-N branch (merge commit, no fast-forward)
      On conflict:
        Dispatch Coder back to story worktree with conflict context
        Coder pulls wave-N, resolves conflict locally, commits
        Retry merge
      On successful merge:
        Remove story worktree
        Delete story branch
        Mark story status: merged

When all parallel_groups in wave have completed:
  Phase A complete — proceed to Phase B
```

### Phase B — Wave Validation

```
Merge wave-N branch → main worktree's working branch (merge commit)
Remove wave-N worktree
Delete wave-N branch

Read repos.json for testing config of repos affected by wave
Run start_command for each affected repo (in main worktree)
Wait for ready_signal or health_check pass

attempt = 1
loop while attempt <= max_fix_attempts:
  Identify which gates need to run:
    - First attempt: all four gates
    - Subsequent attempts: only gates that failed previously
  
  Dispatch in parallel:
    - wave-uat-agent
    - wave-ux-agent
    - wave-spec-compliance-agent
    - wave-code-review-agent
  
  Collect reports, write to wave-N/gates/<gate>-<attempt>.json
  
  If all gates pass:
    Mark wave status: complete
    Mark all wave stories status: done
    Break
  
  Collect open issues across failing gates (deduped by gate-specific key)
  
  For each open issue:
    Determine fix strategy from attempt count:
      attempt 1 → same_coder_more_context
      attempt 2 → different_coder_with_spike
      attempt 3 → pause_for_user
    
    If pause_for_user:
      Surface issue + history to user
      Wait for response (fix manually | defer | replan | abort)
    Else:
      Dispatch fix per strategy
      Fix branch merges back to current branch
      Restart affected services if testing config changed
  
  attempt += 1

If wave.status != "complete" after max attempts:
  Surface to user for decision
```

---

## Schema Changes

### `plan-schema.json` additions

**`waves[].user_journeys`** (new required field):

```json
"user_journeys": [{
  "id": "UJ-001",
  "name": "string",
  "stories_covered": ["US-001"],
  "steps": [{
    "action": "navigate | click | fill | assert_text | assert_visible | assert_url | screenshot | wait",
    "url": "optional",
    "selector": "optional",
    "value": "optional",
    "expect": "optional",
    "timeout_ms": "optional"
  }]
}]
```

Validated by plan-schema. Step structure mirrors existing `definition_of_done.validation.command` chrome_mcp format.

**`wave_gate_config`** (new optional top-level field):

```json
"wave_gate_config": {
  "uat_enabled": true,
  "ux_enabled": true,
  "spec_compliance_enabled": true,
  "code_review_enabled": true,
  "max_fix_attempts": 3,
  "fix_strategies": ["same_coder_more_context", "different_coder_with_spike", "pause_for_user"]
}
```

Defaults to all gates enabled with 3-attempt adaptive retry.

### `repos.json` additions

**`testing`** field per repo (optional, but required for wave gates to run):

```json
{
  "id": "main-app",
  "name": "main-app",
  "stack": "Node.js",
  "path": "/path/to/repo",
  "testing": {
    "start_command": "npm run dev",
    "stop_command": "npm run stop",
    "health_check": "curl -s http://localhost:3000/health",
    "app_url": "http://localhost:3000",
    "ready_signal": "Listening on port 3000"
  }
}
```

If a repo has no `testing` block, wave gates for that repo's stories are skipped with a warning.

### `state.json` changes

**`waves[]`** gains:

```json
{
  "id": "wave-0",
  "status": "pending | in_progress | gates_running | complete | blocked",
  "branch": "wave-0",
  "merged_to_main_at": "ISO timestamp or null",
  "gate_runs": [{
    "attempt": 1,
    "started_at": "ISO timestamp",
    "completed_at": "ISO timestamp or null",
    "uat": { "status": "pass | fail | running | skipped", "report_path": "wave-0/gates/uat-1.json" },
    "ux": { "status": "pass | fail | running | skipped", "report_path": "wave-0/gates/ux-1.json" },
    "spec_compliance": { "status": "pass | fail | running | skipped", "report_path": "wave-0/gates/spec-compliance-1.json" },
    "code_review": { "status": "pass | fail | running | skipped", "report_path": "wave-0/gates/code-review-1.json" },
    "issues": [{
      "id": "ISSUE-001",
      "gate": "uat | ux | spec_compliance | code_review",
      "dedup_key": "string — gate-specific composite key",
      "description": "string",
      "affected_stories": ["US-001"],
      "severity": "critical | high | medium | low",
      "fix_attempts": [{
        "attempt": 1,
        "strategy": "same_coder_more_context | different_coder_with_spike | pause_for_user",
        "coder_id": "string",
        "started_at": "ISO",
        "completed_at": "ISO or null",
        "result": "fixed | still_failing",
        "commit_sha": "optional"
      }],
      "status": "open | fixing | resolved | blocked",
      "blocked_reason": "string or null"
    }]
  }],
  "orphaned_worktrees": ["string"]
}
```

### `story-schema.json` simplifications

Story state machine simplifies. Remove these fields (no longer used):

- `dod_validation`
- `review_status`
- `code_review_status`
- `qa_status`

Story keeps: `id`, `type`, `party`, `repo`, `statement`, `acceptance_criteria`, `definition_of_done`, `priority`, `dependencies`, `estimated_complexity`, `has_mock`, `mock_phase`, `mock_approved`, `wave`, `parallel_group`, `status`, `commit_sha`, `started_at`, `merged_at`, `completed_at`, `attempts`, `implemented_by`.

New status enum: `pending | in_progress | merged | done | blocked | cancelled | deferred`. Old `qa_validation`, `in_review`, `code_review` values dropped.

### Top-level versioning

Add to `state.json`:

```json
"execution_protocol_version": "2.0"
```

Old projects without this field, or with `"1.0"`, run the legacy protocol. New projects start with `"2.0"`.

---

## Wave Gate Agents

Four agents, each producing a structured JSON report validated against `wave-gate-report-schema.json`. All four can run in parallel.

### `wave-uat-agent.md`

**Purpose:** Verify user journeys defined in the wave's `user_journeys[]` work end-to-end.

**Input:**
- Wave's `user_journeys[]` from plan.json
- App URLs from `repos.json[].testing.app_url`
- Affected stories list

**Behavior:** For each journey, walk through `steps[]` using Chrome MCP. Capture screenshot per step. Assert expectations. Record actual vs. expected.

**Output:** `wave-N/gates/uat-<attempt>.json`

```json
{
  "status": "pass | fail",
  "journeys": [{
    "id": "UJ-001",
    "name": "string",
    "status": "pass | fail",
    "stories_covered": ["US-001"],
    "steps": [{
      "step_index": 0,
      "action": "navigate",
      "passed": true,
      "actual": "string",
      "screenshot": "wave-0/gates/uat-1/UJ-001-step-0.png"
    }],
    "failure_reason": "string or null"
  }],
  "issues": [{
    "id": "ISSUE-NNN",
    "gate": "uat",
    "dedup_key": "UJ-001:3",
    "journey_id": "UJ-001",
    "step_index": 3,
    "description": "string",
    "affected_stories": ["US-002"],
    "severity": "critical",
    "screenshot": "string"
  }]
}
```

**Dedup key:** `(journey_id, step_index)`

**Pass criterion:** All journeys pass.

### `wave-ux-agent.md`

**Purpose:** Verify implemented UI matches approved mocks.

**Input:**
- Wave's stories with `has_mock: true`
- Approved mock files in `mocks/`
- App URLs

**Behavior:** For each mocked story, navigate to its UI, screenshot the implemented version, compare side-by-side to approved mock. Flag visual drift across categories: missing elements, wrong colors, wrong layout, broken responsive behavior.

**Output:** `wave-N/gates/ux-<attempt>.json`

```json
{
  "status": "pass | fail",
  "comparisons": [{
    "story_id": "US-002",
    "mock_path": "mocks/US-002-approved.html",
    "implementation_screenshot": "wave-0/gates/ux-1/US-002-actual.png",
    "status": "match | drift | broken",
    "drift_categories": ["colors", "layout", "missing_element", "responsive"],
    "notes": "string"
  }],
  "issues": [{
    "id": "ISSUE-NNN",
    "gate": "ux",
    "dedup_key": "US-002:colors",
    "affected_stories": ["US-002"],
    "description": "string",
    "severity": "critical | minor"
  }]
}
```

**Dedup key:** `(story_id, drift_category)`

**Pass criterion:** No `critical` drift. Minor drift reports but doesn't fail.

### `wave-spec-compliance-agent.md`

**Purpose:** Verify each story's `acceptance_criteria` are actually satisfied — including AC items not exercised by user journeys.

**Input:**
- Wave's stories with their `acceptance_criteria[]`
- Diff between wave-N and main
- App URLs

**Behavior:** For each story, for each AC item, decide a verification method (read code, curl, test_suite, chrome_mcp) and execute it. Record results.

**Output:** `wave-N/gates/spec-compliance-<attempt>.json`

```json
{
  "status": "pass | fail",
  "story_results": [{
    "story_id": "US-001",
    "ac_results": [{
      "ac_index": 0,
      "ac_text": "string",
      "verification_method": "curl | test_suite | chrome_mcp | code_inspection",
      "verification_details": "string",
      "passed": true,
      "actual": "string",
      "expected": "string"
    }],
    "all_passed": true
  }],
  "issues": [{
    "id": "ISSUE-NNN",
    "gate": "spec_compliance",
    "dedup_key": "US-001:1",
    "story_id": "US-001",
    "ac_index": 1,
    "description": "string",
    "severity": "critical"
  }]
}
```

**Dedup key:** `(story_id, ac_index)`

**Pass criterion:** Every story's `all_passed === true`.

### `wave-code-review-agent.md`

**Purpose:** Catch issues UAT and spec compliance can't see — security, correctness, error handling, dead code, performance.

**Input:**
- Diff between wave-N and main
- Changed files

**Behavior:** Full code review covering:
- **Security** — injection, XSS, CSRF, auth bypass, secrets, dangerous defaults, input validation
- **Correctness** — race conditions, off-by-one, null handling
- **Error handling** — silent catches, swallowed errors, missing retries
- **Dead code** — unreachable branches, unused exports
- **Performance** — N+1 queries, sync I/O in hot paths, missing indexes
- **Style** — only egregious cases, no nitpicks

May reuse the existing `/code-review` skill internally.

**Output:** `wave-N/gates/code-review-<attempt>.json`

```json
{
  "status": "pass | fail",
  "findings": [{
    "id": "FINDING-NNN",
    "category": "security | correctness | error_handling | dead_code | performance | style",
    "severity": "critical | high | medium | low",
    "file": "src/path.ts",
    "line": 42,
    "description": "string",
    "suggested_fix": "string"
  }],
  "issues": [{
    "id": "ISSUE-NNN",
    "gate": "code_review",
    "dedup_key": "src/path.ts:42:security",
    "affected_stories": ["US-005"],
    "description": "string",
    "severity": "critical | high"
  }]
}
```

**Dedup key:** `(file, line, category)`

**Pass criterion:** No `critical` or `high` severity findings. Medium/low report but don't fail.

---

## Adaptive Fix Loop

When a gate fails, issues fix individually using progressive escalation. Only the failed gate(s) re-run.

### Strategy Tiers

**Attempt 1: `same_coder_more_context`**
- Re-dispatch the original Coder for the affected story
- Provide: original story + AC, the gate report excerpt, screenshots, suggested fix
- Coder fixes locally, commits, merges

**Attempt 2: `different_coder_with_spike`**
- Spawn a Researcher to investigate root cause
- Researcher produces a findings document
- Dispatch a *new* Coder with the findings + original issue + gate report
- New Coder fixes, commits, merges

**Attempt 3: `pause_for_user`**
- Surface the issue, all attempts so far, what was tried, gate reports, suggested next steps
- User options:
  - Fix manually
  - Defer (mark issue blocked, advance wave with known limitation)
  - Replan (split affected story or restructure wave)
  - Abort

### Issue Re-Run Logic

After a fix lands:
1. Merge fix → main worktree's working branch
2. Restart any affected services (only if testing config or service-related code changed)
3. Re-run **only** the gate(s) that produced open issues
4. Other gates' previous PASS results carry forward
5. **Exception:** If the fix touched files that a previously-passing gate validated, re-run that gate too (file-overlap detection)

### Issue Tracking

Issues are immutable once created. New attempts append to `fix_attempts[]`. Issues never re-use IDs. If a fix introduces a new issue with a different dedup key, it gets a new ID.

A blocked wave (user chose "defer") records the issue with `status: "blocked"` and `blocked_reason`. Blocked issues surface in the milestone audit at the end of the milestone.

---

## Worktree Management

The skill is infrastructure-agnostic but does manage worktrees explicitly.

### Topology

```
{project-root}/
├── (main worktree — testing happens here)
├── ../wave-N/                    # Wave integration worktree
└── ../wave-N-US-XXX/             # Story worktree (transient)
```

### Branch Topology

- `main` (or whatever the project's main branch is) — production
- `wave-N` — wave integration branch, branches from current main
- `wave-N/US-XXX` — story branch, branches from `wave-N`

### Lifecycle

**Wave start:**
- Create `wave-N` branch from main worktree's current branch
- Create wave-N worktree

**Story start:**
- Create `wave-N/US-XXX` branch from `wave-N`
- Create story worktree
- Dispatch Coder

**Story complete:**
- Merge story branch → wave-N (merge commit, `--no-ff`)
- On conflict: dispatch Coder to story worktree to resolve, retry
- Remove story worktree
- Delete story branch

**Phase A complete (all stories merged):**
- Merge wave-N → main worktree's branch (merge commit)
- Remove wave-N worktree
- Delete wave-N branch

**Phase B (gates running):**
- Gates run against main worktree
- Fixes happen on main worktree's branch directly (small fixes) or in temporary story worktrees re-created from wave-N base (complex fixes)

**Wave complete:**
- All stories status: merged → done
- Advance to next wave

### Cleanup Guarantees

| Trigger | Action |
|---------|--------|
| Story merged | Remove story worktree + delete story branch |
| Wave complete | Remove wave worktree + delete wave branch |
| User aborts execution | Remove all non-main worktrees |
| Cleanup command | Remove orphaned worktrees from `state.json.orphaned_worktrees[]` |

If `git worktree remove` fails (uncommitted changes, lock file), record in `state.json.orphaned_worktrees[]` and continue. The cleanup command sweeps these later.

---

## Service Lifecycle

The orchestrator controls service start/stop based on `repos.json[].testing`.

### Phase B startup

For each repo affected by the wave (derived from `task.file_paths` matched against `repos[].path`):
1. Run `testing.start_command` (foreground or background per repo)
2. Wait for `testing.ready_signal` in stdout, or poll `testing.health_check` until success, or default 30s timeout
3. Record service status in `state.json.waves[N].services[]`

### Between fix attempts

- If fix only changed UI/template files: skip restart
- If fix changed any code in `src/`, server, or config: restart affected service(s)
- File-to-service mapping derived from repo path containment

### Phase B complete

Run `testing.stop_command` for each started service. If `stop_command` is missing, skip (user is responsible).

### Missing testing config

If a repo affected by the wave has no `testing` block in `repos.json`:
- **UAT gate:** skipped for journeys that touch this repo's stories. Log warning per skipped journey.
- **UX gate:** skipped for stories in this repo that have `has_mock: true`. Log warning per skipped comparison.
- **Spec compliance gate:** runs, but AC items requiring `chrome_mcp` or `curl` verification are auto-failed with reason "no testing config — manual verification required". AC items verifiable by `code_inspection` or `test_suite` still run.
- **Code review gate:** runs unaffected (diff inspection only).
- User can add testing config and re-run gates without re-doing code production.

---

## Orchestrator Loop

Pseudocode:

```
for wave in plan.waves:
  if wave.status == "complete": continue
  
  # Phase A
  wave.status = "in_progress"
  create_branch_and_worktree("wave-N")
  
  for parallel_group in wave.parallel_groups:
    dispatch_coders_concurrently(parallel_group)
    wait_for_all_done()
    for story in parallel_group:
      merge_with_conflict_handling(story.branch, "wave-N")
      cleanup_story_worktree(story)
      story.status = "merged"
  
  # Phase B
  wave.status = "gates_running"
  merge_with_conflict_handling("wave-N", main_branch)
  cleanup_wave_worktree()
  
  start_services_for_affected_repos(wave)
  wait_for_services_ready()
  
  attempt = 1
  failing_gates = ["uat", "ux", "spec_compliance", "code_review"]
  
  while attempt <= max_fix_attempts:
    reports = dispatch_gates_in_parallel(failing_gates)
    write_reports_to_disk(wave, attempt, reports)
    
    failing_gates = [g for g in reports if g.status == "fail"]
    
    if not failing_gates:
      stop_services()
      wave.status = "complete"
      mark_all_wave_stories_done()
      break
    
    open_issues = collect_issues(reports)
    
    for issue in open_issues:
      strategy = retry_strategy(len(issue.fix_attempts))
      if strategy == "pause_for_user":
        result = ask_user(issue, history=wave.gate_runs)
        handle_user_decision(result)  # fix | defer | replan | abort
      else:
        dispatch_fix(issue, strategy)
        merge_fix_to_main_branch()
        if affects_services(fix.changed_files):
          restart_affected_services()
    
    attempt += 1
  
  if wave.status != "complete":
    surface_to_user(wave)
  
  cleanup_wave_branch()
```

---

## Files to Create / Modify

### New Files
- `skills/kryptonite/agents/wave-uat-agent.md`
- `skills/kryptonite/agents/wave-ux-agent.md`
- `skills/kryptonite/agents/wave-spec-compliance-agent.md`
- `skills/kryptonite/agents/wave-code-review-agent.md`
- `skills/kryptonite/references/wave-gate-report-schema.json` — validates all four gate report formats
- `skills/kryptonite/references/repos-schema.json` — validates repos.json structure including the new optional `testing` block (`start_command`, `stop_command`, `health_check`, `app_url`, `ready_signal` — all strings)

### Modified Files
- `skills/kryptonite/references/plan-schema.json` — add `waves[].user_journeys`, `wave_gate_config`
- `skills/kryptonite/references/story-schema.json` — drop `dod_validation`, `review_status`, `code_review_status`, `qa_status`; update status enum
- `skills/kryptonite/agents/orchestrator.md` — full rewrite for new flow
- `skills/kryptonite/references/execution-protocol.md` — full rewrite for protocol v2
- `skills/kryptonite/SKILL.md` — Phase 12 instructions rewritten
- `skills/kryptonite/scripts/validate-plan.js` — add semantic checks for `user_journeys` referencing wave's stories

### Removed/Deprecated Files
- `skills/kryptonite/agents/qa.md` — replaced by wave-uat-agent + wave-spec-compliance-agent
- `skills/kryptonite/agents/reviewer.md` — replaced by wave-spec-compliance-agent
- `skills/kryptonite/agents/code-reviewer.md` — replaced by wave-code-review-agent

Old projects continue to use these via protocol v1 detection.

### Unchanged
- `skills/kryptonite/agents/coder.md` — Coder still writes code in worktrees
- `skills/kryptonite/agents/researcher.md` — used for spike research and the attempt-2 fix strategy
- `skills/kryptonite/agents/designer.md` — Phase 5 only, not execution
- `skills/kryptonite/agents/spec-critic.md`, `plan-critic.md` — Phase 10/11 only
- `scripts/comment-server.js` — UI continues to render the same data (with new wave gate reports added to dashboards)

---

## Migration

**Detection:** `state.json.execution_protocol_version`. Missing or `"1.0"` → legacy protocol. `"2.0"` → new protocol.

**No conversion tooling.** Old projects continue with their existing model. New projects start fresh with v2.

**Rollout:** Update SKILL.md so new projects default to v2. Update `/gsd:execute-phase` and related commands to read the version field and dispatch the right protocol.

---

## Observability Note

The adaptive retry's "Researcher + new Coder" tier is the most experimental part of this design. Instrument it from day one:

- Track success rate per strategy tier in `state.json.waves[N].gate_runs[].issues[].fix_attempts[].result`
- After several projects, analyze which tiers actually resolve issues vs. which are wasted attempts
- Tune `max_fix_attempts` and `fix_strategies` order based on data, not intuition

This data also feeds into deciding whether to add more strategies (e.g., "rollback the offending story" as a tier) or simplify back to fewer attempts.
