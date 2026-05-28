# Changelog

## 0.4.0 — Wave-Gate Execution + Structured Spec/Plan

This release replaces freeform HTML spec/plan generation with validated JSON, and replaces per-story validation gates with a wave-level gate model. Both are breaking changes for projects mid-execution; see Migration below.

### Spec & plan are now JSON, not HTML

The LLM no longer authors `spec.html`/`plan.html` directly. It produces `spec.json` and `plan.json` validated by `references/spec-schema.json` and `references/plan-schema.json` (composed via `$ref` with the existing `story-schema.json`). The UI fetches the JSON via `/api/spec` and `/api/plan` and renders it client-side as Alpine.js SPAs.

- New schemas: `spec-schema.json`, `plan-schema.json`, `wave-gate-report-schema.json`, `repos-schema.json`
- New validators: `validate-spec.js`, `validate-plan.js` (schema layer + 9 spec semantic checks + 8 plan cross-validation checks against spec)
- New API endpoints: `GET /api/spec`, `GET /api/plan`, `GET /api/spec/schema`, `GET /api/plan/schema`
- New SPA pages: `scripts/ui/spec.html`, `scripts/ui/plan.html` — full dark-themed renderer with sidebar nav
- Detection mode: `comment-server.js` checks for `spec.json`/`plan.json` and serves the SPA; falls back to legacy HTML for v1 projects.
- Plan now contains `user_journeys[]` per wave (required) with structured Chrome MCP steps for UAT.
- Optional `wave_gate_config` lets you tune which gates run and how many fix attempts to allow.

### Phase 12 wave-gate execution (protocol v2)

Per-story QA / Reviewer / Code Reviewer gates are gone. They produced a serial bottleneck after every merge, and agents would give up under it. Replaced with four wave-level gate agents that run in parallel after the entire wave merges:

- **wave-uat-agent** — walks `user_journeys[]` via Chrome MCP
- **wave-ux-agent** — screenshots implementation vs approved mocks, compares
- **wave-spec-compliance-agent** — verifies each story's `acceptance_criteria` (catches what UAT doesn't exercise)
- **wave-code-review-agent** — full diff review (security, correctness, error handling, dead code, performance, style)

Story state machine simplified: `pending → in_progress → merged`, with `done` set retroactively when the wave completes. Wave statuses: `pending → in_progress → gates_running → complete | blocked`.

Adaptive retry replaces "give up after 3 attempts": same Coder + more context → Researcher + new Coder → pause for user. Only failed gates re-run after a fix; passed gates carry forward.

Service lifecycle is now driven by `repos.json[].testing` (`start_command`, `stop_command`, `health_check`, `app_url`, `ready_signal`). The plugin is infrastructure-agnostic — works with marengo, docker-compose, foreman, npm, anything.

### Gates cannot fake passing

This shipped late in the release after eval testing surfaced the issue. Gates have a third status: `blocked`. When Chrome MCP isn't reachable or a service won't start, UAT and UX must report `blocked` (not `pass`) — they cannot substitute code inspection or curl and call themselves passed. The orchestrator pauses the wave and surfaces the infrastructure issue to the user instead of entering the fix loop. Issue severity gains a `blocked` value alongside critical/high/medium/low.

The eval that caught this: with-skill agent ran Phase 12 against a fixture where Chrome MCP had a browser-profile lock; it reported all gates passing via "code inspection" and marked the wave complete on a lie. Iteration 2 with the new instructions correctly used Chrome MCP for real (12/12 assertions passed, including the new substitution detector).

### New files
- `agents/wave-uat-agent.md`, `agents/wave-ux-agent.md`, `agents/wave-spec-compliance-agent.md`, `agents/wave-code-review-agent.md`
- `references/spec-schema.json`, `references/plan-schema.json`, `references/wave-gate-report-schema.json`, `references/repos-schema.json`
- `scripts/validate-spec.js`, `scripts/validate-plan.js`, `scripts/validate-wave-gate-report.js`
- `scripts/worktree-manager.js` — create/remove/merge with conflict handling for wave + story branches
- `scripts/service-runner.js` — start/stop services per repos.json testing config
- `scripts/ui/spec.html`, `scripts/ui/plan.html` — Alpine.js SPA renderers

### Modified files
- `references/story-schema.json` — dropped `dod_validation`, `review_status`, `code_review_status`, `qa_status`; status enum now `pending|in_progress|merged|done|blocked|cancelled|deferred`; added `merged_at`
- `references/execution-protocol.md` — full rewrite for v2
- `references/plan-schema.json` — added `waves[].user_journeys` (required) and `wave_gate_config` (optional)
- `agents/orchestrator.md` — full rewrite for v2; explicit blocked-gate handling
- `scripts/comment-server.js` — JSON API endpoints + JSON detection mode for `/spec`, `/plan`
- `scripts/validate-gate.js` — protocol-version detection, branches Phase 12 logic on `state.json.execution_protocol_version`
- `scripts/phase-gates/10.json`, `11.json` — accept `spec.json`/`plan.json` alongside legacy HTML
- `SKILL.md` — Phase 12 section rewritten for v2

### Bug fixes
- `scripts/ui/assets/nav.html` — phase badge was reading the wrong field name (`currentPhase` → `current_phase`)

### Migration

Old projects keep working unchanged. Phase 12 detection reads `state.json.execution_protocol_version`:
- Missing or `"1.0"` → legacy protocol (per-story QA/Reviewer/CodeReview)
- `"2.0"` → wave-gate protocol

**To migrate a project mid-flight to v2:**
1. Set `execution_protocol_version: "2.0"` in `state.json`
2. Update story statuses from `qa_validation`/`in_review` to `merged` (the closest v2 equivalent for stories that had passed coding but not yet been validated)
3. Add `user_journeys[]` to each remaining wave in `plan.json` (required by the new plan schema)
4. Optionally add a `testing` block to each repo in `repos.json` that needs running services for UAT/UX gates. Repos without a testing block will have UAT/UX gates skipped with a warning; spec compliance and code review still run.

**To start a fresh project on v2:** nothing to do. New projects default to v2.

The two example projects under `data/` (`agendadeck-launch`, `readiness-mvp`) were not migrated — they're mid-execution under v1 and the protocol-version detection keeps them working as-is.

---

## 0.1.0 — Initial Release

### Skills
- **kryptonite** — 12-phase spec-driven development workflow
- **repos** — standalone repo registry management with auto-detection

### Workflow (12 Phases)
- Phase 1-4: Structured requirements gathering (description, stories, gap analysis, parties)
- Phase 5-6: Spike execution and re-scoping (research before planning)
- Phase 7: Technical guidance with multi-repo support
- Phase 8: DOD with automated validation methods + visual mock generation
- Phase 9: Schema validation gate
- Phase 10: Spec generation with Spec Critic review
- Phase 11: Implementation plan with Plan Critic review
- Phase 12: Parallel agent execution with state machine enforcement

### Agents (9)
- Orchestrator, Interviewer, Designer, Researcher, Coder, QA, Reviewer, Spec Critic, Plan Critic

### Multi-Repo
- Project-level `repos.json` shared across epics
- Auto-detection of stack, run, and test commands
- Cross-repo story auto-splitting with dependency links
- Per-repo testing notes (credentials, URLs, seed commands)

### State Machine
- Strict status transitions: pending → in_progress → qa_validation → in_review → done
- Invariants enforced on every state write (cannot skip QA or review)
- 3-strike escalation on persistent failures

### DOD Validation
- 4 methods: `curl`, `chrome_mcp`, `test_suite`, `file_exists`
- Structured chrome_mcp format with 8 action types
- `${APP_URL}` placeholder resolved per-repo at runtime
- Every DOD must be automatable — vague items get rewritten

### Comment Server
- Branded HTML spec/plan with inline commenting
- Persistent comments (survives server restarts)
- Live dashboard with wave progress
- Mocks gallery with approved/pending status
- Fullscreen compare view for mock selection (click-to-pick)
- Navigation bar across all pages

### Mocks
- Batch mock generation grouped by design context
- Progressive direction locking (3 options → 2 → 1 as direction is established)
- Designer agent builds on previously approved mocks for consistency
- Compare view with iframe previews and keyboard navigation

### Epics
- One active at a time, stored at `.kryptonite/{slug}/`
- `current_phase` tracking for reliable resume
- Archiving on completion or new epic start
- Fully independent (own parties, context, design direction)

### Commits
- Granular: after each phase transition, spike, validated story, wave completion
- Phase commits in project repo: `kryptonite({epic}): ...`
- Story commits in assigned repo: `feat({story-id}): ...`
- Multi-repo: independent commits, state.json links SHAs

### Per-Wave UAT
- QA agent runs in UAT mode after each wave passes
- Tests end-to-end user flows via Chrome MCP
- Multi-repo UAT starts all relevant services
- UAT failure blocks next wave
