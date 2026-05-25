# Changelog

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
