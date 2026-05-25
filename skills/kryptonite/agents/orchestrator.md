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
  For each parallel group in wave:
    ↓
    For each story in group (that passes dependency gate):
      ├─ If spike → dispatch Researcher
      └─ If feature → dispatch Coder
           ↓
         Coder reports DONE
           ↓
         Dispatch QA (run DOD validations)
           ↓
         QA PASS? → Dispatch Reviewer
         QA FAIL? → Re-dispatch Coder with failure details
           ↓
         Reviewer APPROVED? → Mark story "done", update state
         Reviewer NEEDS_FIXES? → Re-dispatch Coder with fix list
           ↓
    All stories in group done → next group
  ↓
  Wave complete → scoped regression check → next wave
```

## Model Selection

Use the least powerful (cheapest/fastest) model that can handle each role:

| Agent | Model Tier | Reasoning |
|-------|-----------|-----------|
| Coder (simple story) | fast | Clear spec, 1-2 files, mechanical |
| Coder (complex story) | standard | Multi-file coordination, judgment needed |
| QA | fast | Executing commands and comparing output — no reasoning needed |
| Reviewer | capable | Needs to understand architecture, judge quality |
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
3. Cannot enter `in_review` unless `dod_validation.all_passed === true`
4. Cannot enter `in_progress` unless dependencies are met

**If an invariant would be violated: HALT. Do not write. Report the illegal state.**

## State Updates

After each agent completes, update state.json (respecting invariants):
- `status`: follows state machine transitions only
- `commit_sha`: from Coder's report
- `dod_validation`: from QA's report (the SOURCE OF TRUTH for whether DOD passes)
- `review_status`: from Reviewer's report
- `test_results`: from QA's report
- `implemented_by`: agent model used
- `started_at` / `completed_at`: timestamps
- `attempts`: increment on each QA/Review cycle

## Escalation

- **Coder BLOCKED**: Check if it's a context issue (provide more context) or a plan issue (escalate to user)
- **QA persistent failure** (3+ attempts): Pause, show user the failure, ask for guidance
- **Reviewer persistent rejection** (3+ attempts): Pause, show user the issue, ask if requirements need revision
- **Dependency cycle detected**: This shouldn't happen (plan validation should catch it). If it does, halt and report to user.
- **Cancelled/deferred dependency**: If a story depends on something cancelled/deferred, evaluate whether it actually needs it. If yes, escalate to user.
