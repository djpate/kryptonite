---
name: kryptonite
description: "Use when the user describes something they want to build, says 'let's build / I want to build / new project / spec this out / gather requirements / plan this', asks for user stories, acceptance criteria, definition of done, or mocks before code, or wants to go from idea to implementation. Use even when no spec is mentioned and the user just describes a problem they want solved. Use also when resuming a partially specified project or when the user pushes back on writing a spec at all."
---

# Kryptonite — Spec-Driven Development

Turn ideas into structured specs and implementation plans through user-story gathering, party definition, and technical scoping. Produces a branded HTML spec, a story-grouped implementation plan with parallel execution waves, and tracks every story's state from definition through completion.

In this document, `<skill-path>` resolves to the directory containing this `SKILL.md` at runtime.

## References — load when relevant

Don't read these upfront. Pull each in when its phase or task arrives.

| When | File |
|------|------|
| Starting a workflow / resume detection | `references/storage-protocol.md` |
| Writing or validating any story | `references/story-schema.json` |
| Phase 8 mocks or cross-repo split | `references/mocks-and-cross-repo.md` |
| Phase 9 schema gate; before any phase advance | `references/phase-gates.md` |
| Phase 10 spec generation, comments, amendments | `references/spec-versioning.md` |
| Phase 12 execution loop | `references/execution-protocol.md` + `agents/orchestrator.md` |
| State transitions or commit rules | `references/state-machine.md` |

## When NOT to use

- One-off scripts or throwaway snippets where there are no users or parties.
- Bug fixes inside an existing project that already has a spec.
- Tasks where the user has explicit, line-level instructions and just needs them executed.
- Live infrastructure / production incident response.

If the user is in one of these cases, don't run the workflow — just do the task.

## Compressed run

When the user pushes back ("just prototype it", "I'm in a hurry", "skip the phases"), don't silently capitulate and don't refuse — surface the tradeoff and offer a compressed run. The shape:

- **Collapse Phases 1–3 into one turn.** Ask for description + stories together; do gap analysis inline with best-guesses the user can correct in one pass instead of one-at-a-time probing.
- **Skip Phase 5 (spikes)** if the user names no unknowns. Note it explicitly so they can override.
- **Skip Phase 8 mocks** if there's no UI surface, or accept ASCII/sketch-level mocks.
- **Keep DOD validation, schema gate, and Phase 12 wave gates intact.** These are the parts that make the difference between "a plan" and "a prototype that demonstrably works" — compressing them removes the value of running kryptonite at all.

Tell the user what you're collapsing and why. If they want to also drop the gates, that's their call, but it's a different request — say so and let them confirm before you start.

## Why phases run in order

Each phase narrows ambiguity the next one depends on:

- Stories you skip clarifying in Phase 3 become acceptance criteria nobody can verify in Phase 8.
- Spike findings from Phase 5 reshape the story list — writing DODs first means redoing them.
- A spec generated before mocks are approved misrepresents what the user actually wants.
- A plan generated before DODs exist can't tell what "done" looks like.

Skipping ahead to code is the most common way kryptonite projects fail — agents implement the wrong thing because the right thing was never specified.

## Phases at a glance

1. General description
2. User-story braindump
3. Gap analysis & clarification
4. Party definition
5. Spikes
6. Re-scope from spike findings
7. Technical guidance + repo registration
8. DOD & mocks
9. Schema validation gate
10. Spec generation + Spec Critic
11. Implementation plan + Plan Critic
12. Wave-gate execution

The visual companion is available throughout Phases 1–9 (see "Visual Companion" below).

## Agent architecture

Phases 1–11 run in the **main session** following `agents/interviewer.md` (multi-turn user interaction can't be delegated). Phase 12 dispatches subagents under the **Orchestrator** (`agents/orchestrator.md`). Communication is hub-and-spoke — agents never talk to each other directly.

| Agent | Prompt | Dispatched when |
|-------|--------|-----------------|
| Designer | `agents/designer.md` | Phase 8 visual stories |
| Researcher | `agents/researcher.md` | Phase 5 spikes; fix-loop attempt 2 |
| Coder | `agents/coder.md` | Phase A of every wave |
| Wave UAT | `agents/wave-uat-agent.md` | Phase B of every wave |
| Wave UX | `agents/wave-ux-agent.md` | Phase B of every wave |
| Wave Spec Compliance | `agents/wave-spec-compliance-agent.md` | Phase B of every wave |
| Wave Code Review | `agents/wave-code-review-agent.md` | Phase B of every wave |
| Spec Critic | `agents/spec-critic.md` | After Phase 10 |
| Plan Critic | `agents/plan-critic.md` | After Phase 11 |

---

## Phase 1: General Description

> "Describe what you want to build — the problem it solves, who it's for, and roughly what it should do. Don't worry about details yet, just the big picture."

Listen. Don't ask follow-ups yet. Acknowledge and transition to stories.

## Phase 2: User-Story Braindump

> "Now let's capture user stories. Tell me everything you can think of — who needs to do what, and why. Any format works. Say 'done' when finished."

Accumulate silently. Parse each story for actor, action, motivation. After the first 2–3 stories, show the format **once** ("As a *[actor]*, I want to *[action]* so that *[reason]*"). Don't nag.

## Phase 3: Gap Analysis & Clarification

Always thorough regardless of project size — better to over-clarify than ship a broken spec.

1. **Present understanding.** Show stories grouped by actor with your interpretation of how the system works.
2. **Identify gaps.** Look for missing error/edge cases, incomplete flows, ambiguous scope, missing actors, security/auth boundaries, untracked state transitions, dangling data, missing notification flows, missing deletion/archival, bulk operations implied by single-item stories.
3. **Probe gaps one at a time.** Propose your best guess; let the user confirm or correct. Don't dump 15 questions.
4. **Record each resolution as it happens.** Confirmed decisions land in `epic.json.decisions[]` as ADRs (`ADR-001`, `ADR-002`, …); unresolved gaps land in `epic.json.open_questions[]` as OQs. Don't accumulate them in chat — they're load-bearing inputs to Phase 10 (the spec generator lifts them verbatim into `spec.json`). Schema in `references/epic-schema.json`.

If new stories emerge mid-phase, integrate them and re-check for gaps. New scope (entirely new concepts) is not a gap — acknowledge it, update the story list, then re-assess existing stories against the new context.

## Phase 4: Party Definition

Extract all unique actors. Present your best guess per party: who they are, what distinguishes them, permission/access boundaries, human vs. system vs. external, how they're authenticated. Don't move on until the user confirms.

## Phase 5: Spikes

Spike when a technical choice hasn't been made, a complex domain needs investigation, performance/feasibility is uncertain, or a visual approach needs exploration.

1. Present identified spikes for confirmation.
2. Dispatch **Researcher** agents in parallel.
3. Surface findings to the user.

Findings live at `<skill-path>/data/{PROJECT}/{EPIC}/spikes/<spike-id>-<topic>.md`.

## Phase 6: Re-scope

After spikes return:

1. Present findings + implications.
2. **Scope check:** if findings expand scope, ask the user whether to include all of it, trim, or defer.
3. Add/modify/remove stories. Re-check for new gaps. Update parties if new actors emerged.
4. Confirm final story list.
5. Append every scope delta to `epic.json.scope_history[]` (trigger + added/removed/modified/deferred). The current state always lives in `state.json`; this is the change log so Phase 10 can show how scope evolved and resume can explain why the story list looks the way it does.

Never let spikes silently explode the story count — the user decides scope.

## Phase 7: Technical Guidance

Ask one at a time, skipping anything already known. Each answer lands in a named slot under `epic.json.technical_context` (full schema in `references/epic-schema.json`):

1. **Repos** — if `<skill-path>/data/{PROJECT}/repos.json` exists, list the registered repos and ask which apply to this epic / whether to add new ones. For *adding, updating, or removing* repos, hand off to the `repos` skill (it owns the auto-detection, schema validation, and prompts) rather than gathering fields inline. The on-disk shape is defined by `references/repos-schema.json`.
2. **Architectural patterns** → `technical_context.patterns.{honor,avoid}`.
3. **Existing infrastructure to integrate with** → `technical_context.infrastructure.{integrate_with,do_not_integrate,gating}`.
4. **Testing approach** → `technical_context.testing.{backend,frontend,e2e}`.
5. **Non-functional requirements** (performance, concurrency, reliability, observability, security, accessibility, browser support, cost, i18n) → `technical_context.non_functional.*`.

The Phase 7 gate (on 0.6.0+ epics) requires at least one of `testing` / `non_functional` / `infrastructure` / `patterns` to be populated — small projects may legitimately not cover all four.

Repos are project-level, shared across all epics. Stories reference them by `name`. Wave-gate agents resolve `${APP_URL}` per-repo from `repos.json[].testing.app_url`.

## Phase 8: DOD & Mocks

Write the Definition of Done per story; produce mocks for visual stories. Every DOD item must be automatable: `curl`, `chrome_mcp`, `test_suite`, or `file_exists` (per `references/story-schema.json`). If a proposed DOD item can't be verified by one of those, **rewrite it** — vague items like "looks good" or "works correctly" do not ship.

Three things happen in this phase. Load `references/mocks-and-cross-repo.md` for full protocol on the first two:

- **Mocks** (two-phase: foundational sequential, detail parallel; foundational approval locks design direction). The structured design system summary lands in `epic.json.design_direction.shell_summary` (colors, typography, spacing, layout, components — see `references/epic-schema.json`). On 0.6.0+ epics, the Phase 8 gate requires `shell_summary` to be a populated object whenever `design_direction.locked === true`, so detail mocks inherit the visual DNA deterministically and the spec renders the design system as data.
- **Cross-repo auto-split** (if a story touches multiple repos, split into `US-005a` / `US-005b` along repo boundaries with explicit dependencies).
- **DOD + priority/dependencies/complexity** per story.

## Phase 9: Schema Validation Gate

Validate every story against `references/story-schema.json` before generating the spec. Run `node <skill-path>/scripts/validate-gate.js` (see `references/phase-gates.md`) — exit code 0 is required to advance.

## Phase 10: Spec Generation

Generate the spec **once**, after all earlier phases are done. Premature generation produces specs that miss spike findings, mock approvals, or DOD details.

1. Initialize epic directory + `state.json` (see `references/storage-protocol.md`).
2. Generate branded HTML spec (`spec.html`); start the comment server on port 3847; tell the user the URL.
3. Dispatch the **Spec Critic**. If `NEEDS_REVISION`, fix critical issues and regenerate before showing the user.
4. Versioning, comment resolution, and mid-execution amendments all flow through `references/spec-versioning.md`.

## Phase 11: Implementation Plan

Group stories into waves respecting hard rules (a story's deps must all be in earlier waves) and soft criteria (cohesion, testability, parallelizability, incremental value).

1. Write wave assignments to `state.json` (`{ id, name, stories, parallel_groups, status }`).
2. Dispatch the **Plan Critic**. If `NEEDS_REVISION`, fix conflicts/ordering/infrastructure gaps and regenerate.
3. Render `plan.html`, serve at `/plan`, wait for user approval.

## Phase 12: Execution

Drive the loop from `references/execution-protocol.md` and `agents/orchestrator.md` — that pair is the authority for preconditions, the per-wave Phase A / Phase B sequence, the adaptive fix-loop strategies, service lifecycle, and the pass/blocked criteria. Don't restate those rules here; they drift.

In short: each wave runs Coders in parallel worktrees (Phase A), merges, then runs the four wave gates in parallel (Phase B). All four gates must pass for stories to flip to `done`. A `blocked` gate pauses for the user — the fix loop only addresses code defects.

Tools:

- `scripts/worktree-manager.js` — create/remove worktrees + branches, merge with conflict handling.
- `scripts/service-runner.js` — start/stop services per `repos.json[].testing`.
- `scripts/validate-wave-gate-report.js` — schema-validate every gate report before trusting it.

---

## Visual Companion

Available throughout Phases 1–9. Offer when a question would benefit from showing alternatives visually (architecture, data flows, wireframes, comparisons). Skip for text-answerable questions.

> "This might be easier to show than describe — want me to open a visual companion in your browser?"

Mechanics: write HTML fragments, serve at `/visual` on the comment server. If the server isn't running yet, start in visual-only mode:

```bash
node <skill-path>/scripts/comment-server.js --visual-only --port 3847
```

## Phase gates are hard gates

Before incrementing `current_phase` in `epic.json`:

```bash
node <skill-path>/scripts/validate-gate.js --phase <N> --data-path <epic-dir>
```

Exit 0 advances. Exit 1: read errors, fix, re-run. Never increment `current_phase` without a passing gate. Full validator behavior in `references/phase-gates.md`.

---

## Discipline

The pressure to skip phases or fudge gates always sounds reasonable in the moment. The table below pairs the rationalization with what actually happens — read it when you feel the urge to cut a corner.

| Rationalization | What's actually true |
|-----------------|----------------------|
| "User said 'just prototype it' — skip the phases." | Surface the tradeoff and offer a compressed run; let the user choose. Silently capitulating builds the wrong thing faster. |
| "This DOD says 'works correctly' — close enough." | A DOD that can't be validated by `curl` / `chrome_mcp` / `test_suite` / `file_exists` is not a DOD. Rewrite it with the user or drop it. |
| "Chrome MCP is down but I can read the source — UAT passes." | UAT must report `blocked`, not `pass`. A single false pass poisons trust in every later gate. See `references/execution-protocol.md`. |
| "Splitting this cross-repo story is annoying." | The orchestrator can't resolve one working directory for a multi-repo story. The split is mechanical, not optional. |
| "I'll mark stories `done` as soon as they merge." | A story is `merged`, not `done`, until its wave is `complete`. State machine invariant — see `references/state-machine.md`. |
| "Phase gate validator is complaining about a tiny field — I'll just bump `current_phase`." | The gates exist because LLM perception drifts from actual state. Fix the field, re-run, advance. |
| "I have enough context to skip Phase 3 / Phase 5 / mocks." | Each phase narrows ambiguity the next one depends on. Skipping moves the cost forward, doesn't remove it. |
| "User keeps adding stories mid-Phase 3." | New stories ≠ gaps. Integrate them, re-assess existing stories against the new context, continue. |
| "This decision/scope-delta/NFR doesn't fit the schema — I'll write a `gap_analysis.md` / `rescope.md` / `technical_guidance.md` sidecar." | If it's load-bearing for Phase 10/11, it belongs in `epic.json` (`decisions[]`, `scope_history[]`, `technical_context`, `design_direction.shell_summary` — schema in `references/epic-schema.json`). Sidecars are invisible to the spec generator and are lost on resume. The recurring urge to add a sidecar means the schema needs a new field — propose it, don't sidestep. |

### Conversational stance

These are about how the interview *feels* to the user, not about correctness gates:

- **One question at a time.** Never batch — it overwhelms and fragments answers.
- **Accumulate then analyze.** Let the user dump freely in Phase 2; probe in Phase 3.
- **Guess then confirm.** Always propose your best understanding instead of asking from scratch.
- **Comments drive revision.** The HTML spec is a living document during review — don't argue, integrate.
- **Self-contained.** Don't reach for other plugins to do core kryptonite work.
