# Mocks (Two-Phase) and Cross-Repo Auto-Split

This document covers two pieces of Phase 8 (DOD & Mocks) that need more detail than fits in the main skill body: the two-phase mock workflow, and how stories that touch multiple repos get auto-split.

## Two-Phase Mock Workflow

Mocks are produced in two strict phases. The reason: an app's visual DNA (shell, navigation, layout grid) is shared across most pages, and approving it once and reusing it is faster, more consistent, and less prone to drift than designing every page in isolation.

### Identify visual stories

Mark visual stories with `"has_mock": true` in `state.json`. Then classify each into one of two phases:

#### Phase A — Foundational Mocks (sequential)

Pages that establish the visual DNA. They define the shell, navigation, and primary layout patterns that all other pages inherit. Typical foundational pages:
- App shell / layout frame (sidebar, top nav, footer)
- Main dashboard or landing view
- Primary list/index page pattern
- Primary detail/show page pattern

Classify a story as foundational if other visual stories would need to inherit its layout, navigation, or structural patterns. Usually 2-4 stories max.

#### Phase B — Detail Mocks (parallel)

All remaining visual stories. These pages live INSIDE the foundational shell and must conform to the approved foundational direction.

Mark each visual story with `"mock_phase": "foundational"` or `"mock_phase": "detail"`.

### Phase A execution

1. Dispatch Designer agents for foundational stories **one at a time** (not parallel) — each subsequent foundational mock inherits from the previous approval
2. Open the **`/compare`** view for the user — fullscreen side-by-side previews with click-to-pick
3. User picks their preferred option
4. Orchestrator reads selections from `/api/selections`
5. After all foundational mocks are approved, record the **design system summary** in `state.json`: colors, typography, spacing, component patterns, nav style, layout grid
6. Lock direction automatically after foundational phase completes

### Phase B execution

1. Provide every Detail Designer agent with the full set of approved foundational mocks + the design system summary as mandatory context
2. Dispatch Designer agents in parallel per batch (these pages all conform to the locked direction)
3. Open `/compare` view for user approval
4. Detail mocks must reuse the foundational shell exactly — only the page content area varies

**Do NOT start Phase B until all Phase A mocks are approved.** The foundational approvals are the source of truth for visual direction.

### Mock storage

- Approved mocks: `<skill-path>/data/{PROJECT}/{EPIC}/mocks/{story-id}.html`
- Pre-approval variants: `<skill-path>/data/{PROJECT}/{EPIC}/mocks/{story-id}-option-a.html`
- Screenshots: `<skill-path>/data/{PROJECT}/{EPIC}/mocks/{story-id}.png`

See `agents/designer.md` for the per-mock production protocol (same-page constraint, mock inheritance, design direction state).

## Cross-Repo Story Auto-Split

When a story touches multiple repos, **auto-split it** into linked sub-stories. The reason: each sub-story gets its own Coder dispatched into one repo's worktree, with one set of validation commands resolved against one `${APP_URL}`. Mixing repos in a single story means an agent has to context-switch and the orchestrator can't resolve a single working directory.

### Detect

When writing DOD for a story, if validation commands reference multiple repos (e.g., curl hits the API but chrome_mcp tests the frontend), flag it:
> "This story touches both the **api** and **web** repos. I'll split it into linked stories so each agent works in one repo."

### Split

Create sub-stories with a suffix notation:
- `US-005a` — the API part (`repo: "api"`)
- `US-005b` — the frontend part (`repo: "web"`)
- `US-005b` depends on `US-005a` (API must exist before frontend can consume it)

### Link

Both sub-stories share the same parent statement but have repo-specific acceptance criteria, DOD, and estimated complexity.

### DOD commands are repo-scoped

Each sub-story's validation commands use `${APP_URL}` resolved from that repo's `testing.app_url` (see `references/repos-schema.json`).

### When NOT to split

If a story only touches one repo, it stays as-is with a simple `repo` field.

## Story IDs after split

The original story ID (`US-005`) becomes a logical grouping — the sub-stories (`US-005a`, `US-005b`) are what gets executed. The schema in `references/story-schema.json` allows the suffixed form via the `^US-\d{3,}[a-z]?$` pattern.
