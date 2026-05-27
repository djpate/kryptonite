---
name: kryptonite
description: "Spec-driven development through structured user story gathering. Use this skill whenever the user wants to plan a project, define requirements, write user stories, create a spec, or says 'let's build', 'I want to build', 'new project', 'spec this out', 'gather requirements', or 'plan this'. Also trigger when they mention user stories, acceptance criteria, definition of done, or want to go from idea to implementation plan. Even if they just describe what they want to build without explicitly asking for a spec, this skill applies."
---

# Kryptonite — Spec-Driven Development

Turn ideas into structured specs and implementation plans through user story gathering, party definition, and technical scoping. Produces a branded, commentable HTML spec, a story-grouped implementation plan with parallel execution waves, and tracks every story's state from definition through completion.

<HARD-GATE>
Do NOT write any code, scaffold any project, or invoke any implementation skill until:
1. All user stories are gathered and analyzed
2. Parties are defined
3. Definition of Done is confirmed for every story
4. Technical guidance is collected
5. The spec HTML is generated and reviewed
6. The implementation plan is produced and approved

This applies regardless of perceived simplicity.
</HARD-GATE>

## Announce

"I'm using the kryptonite skill to guide you from idea to implementation plan."

## File Structure

All kryptonite data lives in the **plugin folder** — never in the project repo. This keeps repos clean, avoids polluting git history, and is invisible to teammates.

**Storage root:** `<skill-path>/data/`

Each project is identified by a 12-char hash derived from its git remote URL (or repo path if no remote). In path references below:
- `{PROJECT}` = the project's 12-char ID
- `{EPIC}` = the active epic's slug

```
<skill-path>/data/
├── registry.json                      (global: maps project-ids to metadata)
├── active.json                        (global: maps project paths to active epics)
└── {PROJECT}/
    ├── project.json                   (source, path, name, created_at)
    ├── repos.json                     (project-level repo registry)
    └── {EPIC}/
        ├── epic.json                  (epic metadata: name, description, parties)
        ├── state.json                 (stories, waves, execution state)
        ├── state.json.bak             (backup — last known good state)
        ├── comments.json              (persisted review comments)
        ├── spec.html                  (branded spec document)
        ├── plan.html                  (implementation plan)
        ├── spikes/
        │   └── US-000-topic.md
        └── mocks/
            ├── US-003.html
            ├── US-003.png
            ├── US-005.html
            └── US-005.png
```

### Project Identification

On startup, compute the project ID:
1. Try: `git remote get-url origin` → SHA-256 first 12 chars of the URL
2. Fallback: SHA-256 first 12 chars of the absolute repo root path

Store the mapping in `registry.json`:
```json
{
  "projects": {
    "a3f9c2d81b4e": {
      "name": "my-app",
      "path": "/Users/dev/work/my-app",
      "source": "git@github.com:org/my-app.git",
      "source_type": "git_remote",
      "created_at": "2026-05-26T10:00:00Z"
    }
  }
}
```

### State Write Protocol (Backup & Recovery)

Before every `state.json` write:
1. Copy current `state.json` → `state.json.bak`
2. Write new content to `state.json.tmp`
3. Validate JSON parse of the tmp file
4. Rename `state.json.tmp` → `state.json` (atomic)

On load:
1. Parse `state.json` — if valid, use it
2. If corrupt: restore from `state.json.bak`, warn the user
3. If both corrupt: halt, report to user (manual recovery needed)

### Migration from `.kryptonite/`

If `.kryptonite/` exists in the project root (legacy location):
1. Inform user: "Found existing data in `.kryptonite/`. Migrating to plugin storage."
2. Compute project-id, create `data/{PROJECT}/`
3. Copy epic directories and repos.json to new location
4. Verify by loading state from new location
5. Ask user: "Remove `.kryptonite/` from your repo?" (offer git rm + commit)

### repos.json (project-level)

The repo registry is shared across ALL epics — define repos once, use them everywhere. Lives at `<skill-path>/data/{PROJECT}/repos.json`:

```json
{
  "repos": [
    {
      "name": "api",
      "path": "~/work/my-api",
      "description": "REST API service — handles auth, business logic, database",
      "stack": "Rails 7, PostgreSQL, RSpec",
      "run": "bin/rails server -p 3000",
      "test": "bundle exec rspec",
      "testing_notes": "Admin: admin@test.com / password123\nSeed: bin/rails db:seed\nStripe test key in .env.test"
    },
    {
      "name": "web",
      "path": "~/work/my-frontend",
      "description": "Customer-facing SPA — renders UI, calls API",
      "stack": "Next.js 14, TypeScript, Tailwind",
      "run": "npm run dev",
      "test": "npm test",
      "testing_notes": "Requires API running on :3000\nTest user auto-created by API seed"
    }
  ]
}
```

`testing_notes` is free-form — credentials, URLs, seed commands, API keys, env vars, external service configs, anything agents need when working in this repo.

When a new epic starts, the existing `repos.json` is already available — no need to redefine repos. Phase 7 only asks about repos if `repos.json` doesn't exist yet or the user wants to add a new one. Use the `repos` skill (`/repos`) to manage the registry independently.

### epic.json

Each epic stores its own context:
- `name`, `slug`, `description`
- `status` — `active` / `completed`
- `current_phase` — integer (1-12) indicating which phase the epic is in. Updated as you progress. Resume reads this directly.
- `kryptonite_version` — the version of kryptonite that created this epic (from `package.json`). Used to determine which schema features were available at creation time and whether migration is needed.
- `created_at`, `completed_at`
- `parties` — array of {name, description, auth}
- `technical_context` — shared patterns, non-repo-specific config
- `design_direction` — {locked, established_from, notes, approved_mocks}

Repos are NOT stored per-epic — they come from the project-level `repos.json`.

### state.json

Contains stories and execution state (same schema as before, minus the fields now in epic.json).

### Starting a New Epic

When starting fresh (no active epic, or user says "new epic"):
1. Ask for the epic name/slug
2. Compute project-id (from git remote or path)
3. Create `<skill-path>/data/{PROJECT}/{EPIC}/`
4. Initialize `epic.json` with `kryptonite_version` read from `<skill-path>/../../package.json` (the plugin's root package.json)
5. Update `active.json` to map this project path to the new epic
6. Proceed to Phase 1

### Archiving an Epic

When an epic completes (all stories done) or the user starts a new one:
1. Set `"status": "completed"` and `"completed_at"` in the old epic's `epic.json`
2. Update `active.json` to point to the new epic (or remove the entry if none active)

## Resume Detection

Before starting, check plugin data for the current project:

1. Compute project-id from current working directory
2. Look up in `<skill-path>/data/active.json`
3. **No entry** → fresh start, ask "What do you want to build?"
4. **Has active epic** → read the epic's `epic.json`, show story counts, offer resume or new epic
5. **Entry but no active epic** → all epics archived, offer to start a new one

If resuming: read `epic.json` → `current_phase` tells you exactly where to pick up. No inference needed. Show context relevant to that phase and continue.

**Legacy migration:** If `active.json` has no entry but `.kryptonite/` exists in the project root, trigger migration (see "Migration from `.kryptonite/`" above).

---

## Process Overview

```
┌─────────────────────────────────────────────────────────┐
│  1. General Description                                 │
│  2. User Story Braindump (gently guide format)          │
│  3. Gap Analysis & Clarification (always thorough)      │
│  4. Party Definition                                    │
│  5. Spikes (identify & execute research tasks NOW)      │
│  6. Re-scope (integrate spike findings, add/change stories) │
│  7. Technical Guidance                                  │
│  8. DOD & Mocks (informed by spike results + tech)      │
│  9. Schema Validation Gate                              │
│ 10. Spec Generation (everything finalized)              │
│ 11. Implementation Plan (story-grouped parallel waves)  │
│ 12. Execution (worktree isolation, serial merge+test)   │
└─────────────────────────────────────────────────────────┘
```

At any point during phases 1-9, offer the visual companion when a question would benefit from showing alternatives visually. See the "Visual Companion" section below.

---

## Agent Architecture

During Phases 1-11, the main session follows `agents/interviewer.md` directly (no subagent dispatch — multi-turn user interaction requires the main session). This is called "Interviewer Mode."

Only Phase 9 dispatches subagents. All communication is hub-and-spoke: agents never talk to each other directly.

| Agent | Prompt | Handles | Dispatched When |
|-------|--------|---------|-----------------|
| **Designer** | `agents/designer.md` | Visual mockups: propose options, iterate, produce HTML + screenshots | During Phase 5 for visual stories |
| **Researcher** | `agents/researcher.md` | Spike tasks: investigate options, produce decision documents | Wave 0 execution |
| **Coder** | `agents/coder.md` | Feature implementation: write code in worktree (no tests), commit to story branch | Feature stories in Waves 1+ |
| **QA** | `agents/qa.md` | DOD validation + UAT: run automated checks and per-wave user flow testing | After Coder reports DONE (DOD mode) and after wave completion (UAT mode) |
| **Reviewer** | `agents/reviewer.md` | Spec compliance: acceptance criteria met, nothing extra, nothing missing | After QA passes ALL checks |
| **Code Reviewer** | `agents/code-reviewer.md` | Code quality: runs /code-review, flags complexity and security issues | After Reviewer approves |
| **Spec Critic** | `agents/spec-critic.md` | Review spec for gaps, contradictions, weak DODs | After Phase 10 (spec generation) |
| **Plan Critic** | `agents/plan-critic.md` | Review plan for conflicts, ordering issues, infra gaps | After Phase 11 (plan generation) |

### Orchestrator Responsibilities (read `agents/orchestrator.md`)

1. During Phases 1-11, the main session IS the interviewer — follow `agents/interviewer.md` instructions directly
2. After plan approval, execute waves by dispatching Researcher/Coder/QA/Reviewer/Code Reviewer
3. Enforce dependency gate before every dispatch
4. Route fix feedback: QA failure → Coder, Reviewer rejection → Coder
5. Update state.json after every agent completes
6. Escalate to user after 3 failed attempts on same story

### Execution Loop Per Story

Phase 12 uses **worktree isolation**: Coders write code in parallel on isolated branches without running tests. The orchestrator merges branches one at a time and runs QA serially to avoid database conflicts.

```
Orchestrator checks dependencies → all done?
  ↓ yes
Dispatch Coder in worktree (NO tests, isolated branch)
  ↓
Coder reports DONE with branch name
  ↓
Orchestrator merges branch into working branch (serial, one at a time)
  ↓ (if conflict → re-dispatch Coder on main to resolve)
Run migrations, dispatch QA → run all DOD validations
  ↓
QA ALL_PASS? → Dispatch Reviewer
QA HAS_FAILURES? → Re-dispatch Coder on main with failure details
  ↓
Reviewer APPROVED? → Dispatch Code Reviewer
Reviewer NEEDS_FIXES? → Re-dispatch Coder on main with fix list
  ↓
Code Reviewer APPROVED? → Update state, mark "done", cleanup branch
Code Reviewer NEEDS_FIXES? → Re-dispatch Coder on main with fix list
  ↓
(Loop until approved or escalate after 3 attempts)
```

---

## Phase 1: General Description

Ask the user to describe what they want to build in broad terms:

> "Describe what you want to build — the problem it solves, who it's for, and roughly what it should do. Don't worry about details yet, just the big picture."

Listen. Don't ask follow-ups yet. Acknowledge what you heard and transition to stories.

---

## Phase 2: User Story Braindump

Invite the user to dump all their user stories:

> "Now let's capture user stories. Tell me everything you can think of — who needs to do what, and why. Any format works. When you're done, just say 'done' or 'that's it'."

**While stories come in:**
- Accumulate silently — don't interrupt the creative flow
- Parse each story to extract: the actor (party), the action, the goal/motivation
- Build an internal model of how the system works — which parties interact, what data flows where, what state changes occur
- If a story is unparseable, note it for later but don't stop the user

**After the first 2-3 stories**, gently show the structured format:

> "Quick note — here's how those look structured:
> - As a **[actor]**, I want to **[action]** so that **[reason]**
>
> You don't have to write them this way, but it helps me parse them accurately. Keep going!"

Only show this once. Don't nag.

**After each batch**, brief acknowledgment:
> "Got [N] stories so far. Keep going, or say 'done' when finished."

---

## Phase 3: Gap Analysis & Clarification

Once the user signals they're done, analyze everything together. This phase is always thorough regardless of how many stories there are — better to over-clarify than ship a broken spec.

**Step 1: Present understanding.** Show a structured summary of all stories grouped by actor, with your interpretation of how the system works as a whole. This is where you normalize free-form input into structured stories.

**Step 2: Identify gaps.** Look for:
- Missing error/edge cases ("what happens when X fails?")
- Incomplete flows ("user creates X, but who approves it?")
- Ambiguous scope ("manage users" — which operations exactly?)
- Missing stories for actors who clearly need them
- Security/auth boundaries not covered
- State transitions with no story
- Data that appears in one story but is never created in another
- Notification/communication flows implied but not stated
- Deletion/archival/undo scenarios
- Bulk operations implied by single-item stories

**Step 3: Probe gaps one at a time.** For each gap, propose what you think the answer might be based on context and let the user confirm or correct. Don't dump a list of 15 questions — ask them sequentially so the user can think through each one.

If the user adds new stories during this phase, integrate them and check for new gaps they might introduce.

Keep going until the picture is complete. The user can say "that's enough" to stop probing.

**Handling scope expansion during gap analysis:** If the user introduces entirely new concepts (e.g., "oh, and there should also be AI personas that respond dynamically"), this isn't a gap — it's new scope. Acknowledge it, add the new stories, but then re-assess:
> "That's a significant new capability. Let me update the story list, then we'll check if this changes what we already discussed (new dependencies, new spikes needed, stories that need splitting)."

Don't just append new stories and continue — re-evaluate the existing ones against the new context.

---

## Phase 4: Party Definition

Extract all unique actors/parties from the stories. Present your best guess:

> "Based on your stories, here are the parties I've identified:
>
> - **Admin** — [who they are, what distinguishes them, access boundaries]
> - **User** — [who they are, what distinguishes them, access boundaries]
> - **System** — [if applicable — automated actors, cron jobs, external services]
>
> Does this match your mental model? Anything to adjust?"

For each party, infer and present:
- Who they are (role, relationship to the system)
- What distinguishes them from other parties
- Permission/access boundaries
- Whether they're human actors, system actors, or external systems
- How they're authenticated/identified

Don't move on until the user confirms all parties are correctly defined.

---

## Phase 5: Spikes

Identify research questions that must be answered before implementation can be planned. Spikes run NOW — their findings shape everything that follows (stories, DODs, mocks, wave assignments).

**When to create spikes:**
- A technical choice hasn't been made (which library, which provider, which architecture)
- A complex domain needs investigation (how does X regulation work? what apps do people use?)
- Performance/feasibility is uncertain (can we handle 10k concurrent?)
- A visual approach needs exploration (how to render a graph editor? what framework?)

**Process:**
1. Present identified spikes to the user for confirmation
2. Dispatch **Researcher** agents in parallel for all spikes
3. Wait for results
4. Present findings to user

---

## Phase 6: Re-scope

After spikes return, their findings may significantly change the project. This phase integrates spike results and gets user sign-off on scope.

**Process:**
1. Present spike findings summary (recommendations, implications)
2. **Scope check** — if findings expand scope:
   > "The research suggests [X]. This would add [N] stories. Do you want to include all of this in the current epic, trim it down, or defer some to a future epic?"
3. Add/modify/remove stories based on findings
4. Re-check for new gaps introduced by the changes
5. If new parties emerged from spike findings, update party definitions
6. Confirm final story list with user before proceeding

**Never let spikes silently explode the story count.** The user decides scope.

---

## Phase 7: Technical Guidance

Ask implementation context one question at a time. Skip questions already answered by prior context:

1. **Repos** — Check if `<skill-path>/data/{PROJECT}/repos.json` already exists:
   - **If it exists**: show the registered repos and ask "Does this epic use any of these? Need to add a new one?"
   - **If not**: ask "What repos will this epic touch? For each one, I need: a short name, the path, what code it holds, its stack, and how to run/test it." Then write `repos.json`.
2. Architectural constraints or patterns to follow?
3. Existing infrastructure to integrate with (auth, API gateway, message queue)?
4. Testing approach preferences (frameworks, coverage expectations)?
5. Non-functional requirements (performance, scale, compliance)?

### Multi-Repo Support

Epics can span multiple repositories. Repos are registered once at **project level** in `<skill-path>/data/{PROJECT}/repos.json` (not per-epic). They persist across all epics so you never redefine them.

Each repo entry gives agents enough context to:
- Know WHERE to work (`path`)
- Know WHAT code lives there (`description`)
- Know HOW to build/run/test it (`stack`, `run`, `test`)

**Stories reference repos by name** via the `repo` field (see story schema). The QA agent resolves `${APP_URL}` per-repo using the `run` command's port.

### Cross-Repo Story Auto-Split

During the DOD pass (Phase 8), if a story touches multiple repos, **auto-split it** into linked sub-stories:

1. **Detect**: When writing DOD for a story, if validation commands reference multiple repos (e.g., curl hits the API but chrome_mcp tests the frontend), flag it:
   > "This story touches both the **api** and **web** repos. I'll split it into linked stories so each agent works in one repo."

2. **Split**: Create sub-stories with a suffix notation:
   - `US-005a` — the API part (repo: `api`)
   - `US-005b` — the frontend part (repo: `web`)
   - `US-005b` depends on `US-005a` (API must exist before frontend can consume it)

3. **Link**: Both sub-stories share the same parent statement but have repo-specific acceptance criteria, DOD, and estimated complexity.

4. **DOD commands are repo-scoped**: Each sub-story's validation commands use `${APP_URL}` resolved from that repo's `run` configuration.

The original story ID (US-005) becomes a logical grouping — the sub-stories (US-005a, US-005b) are what gets executed.

**When NOT to split**: If a story only touches one repo, it stays as-is with a simple `repo` field.

---

## Phase 8: DOD & Mocks

Now that spikes are done, scope is confirmed, repos are defined, and tech is decided — write the Definition of Done for each story. Mocks are produced here too since they inform visual DODs.

Every story must conform to `references/story-schema.json`. See that file for the full schema including DOD validation methods (`curl`, `chrome_mcp`, `test_suite`, `file_exists`), Chrome MCP structured format, and field descriptions.

### Step 1: Identify visual stories and classify them into two mock phases.

Mark visual stories with `"has_mock": true`. Then classify each into one of two phases:

**Phase A — Foundational Mocks** (done first, sequentially):
These are the pages that establish the visual DNA of the app. They define the shell, navigation, and primary layout patterns that all other pages inherit. Typical foundational pages:
- App shell / layout frame (sidebar, top nav, footer)
- Main dashboard or landing view
- Primary list/index page pattern
- Primary detail/show page pattern

Classify a story as foundational if other visual stories would need to inherit its layout, navigation, or structural patterns. Usually 2-4 stories max.

**Phase B — Detail Mocks** (done after foundational mocks are approved):
All remaining visual stories. These pages live INSIDE the foundational shell and must conform to the approved foundational direction.

Mark each visual story in state.json with `"mock_phase": "foundational"` or `"mock_phase": "detail"`.

#### Phase A execution (Foundational):

1. Dispatch Designer agents for foundational stories **one at a time** (not parallel) — each subsequent foundational mock inherits from the previous approval
2. Open the **`/compare`** view for the user — fullscreen side-by-side previews with click-to-pick
3. User picks their preferred option
4. Orchestrator reads selections from `/api/selections`
5. After all foundational mocks are approved, record the **design system summary** in state.json: colors, typography, spacing, component patterns, nav style, layout grid
6. Lock direction automatically after foundational phase completes

#### Phase B execution (Detail):

1. Provide every Detail Designer agent with the full set of approved foundational mocks + the design system summary as mandatory context
2. Dispatch Designer agents in parallel per batch (these pages all conform to the locked direction)
3. Open `/compare` view for user approval
4. Detail mocks must reuse the foundational shell exactly — only the page content area varies

**Do NOT start Phase B until all Phase A mocks are approved.** The foundational approvals are the source of truth for visual direction.

Mocks stored at: `<skill-path>/data/{PROJECT}/{EPIC}/mocks/{story-id}.html` (variants: `{story-id}-option-a.html`)

### Step 2: Cross-repo auto-split.

For each story, determine which repo it belongs to. If it touches multiple repos, auto-split (see Cross-Repo Story Auto-Split above).

### Step 3: Write DOD with validation methods.

For each story, propose concrete DOD items with automated validation:

> **US-001: As a customer, I want to submit a support ticket...**
> - [ ] POST /tickets with valid body → 201 with ticket JSON (`curl`)
> - [ ] POST /tickets with empty subject → 400 with error message (`curl`)
> - [ ] New ticket visible in customer's ticket list page (`chrome_mcp`)
> - [ ] Ticket persisted with status 'open' (`test_suite`)
>
> "Anything else for this one?"

For visual stories with approved mocks:
> - [ ] UI matches approved mock layout (`chrome_mcp`)

**Every DOD item must be automatable.** If it can't be verified by curl/chrome_mcp/test_suite/file_exists, rewrite it.

### Step 4: Priority, dependencies, complexity.

Batch these in a table for quick confirmation:

> | ID | Story | Priority | Dependencies | Complexity | Repo |
> |----|-------|----------|--------------|------------|------|
> | US-001 | Create ticket | high | none | simple | api |
> | US-002a | Show tickets (API) | high | US-001 | trivial | api |
> | US-002b | Show tickets (UI) | high | US-002a | simple | web |

---

## Phase 9: Schema Validation Gate

Before generating the spec, validate every story against `references/story-schema.json`:
- `id`, `type`, `repo`, `party`, `statement`, `acceptance_criteria`, `definition_of_done`, `priority`, `dependencies`, `estimated_complexity` — all populated
- DOD items have valid `validation.method` values
- Dependencies reference existing story IDs
- Party values match defined parties

> "All [N] stories pass schema validation. Moving to spec generation."

---

## Phase 10: Spec Generation

### Write the Spec

The spec is generated ONCE, after all earlier phases are complete (spikes run, mocks approved, DODs confirmed, tech guidance collected). It includes everything — don't generate it prematurely and have to regenerate later.

Produce a comprehensive project specification including:

1. **Project Overview** — refined general description
2. **Parties & Roles** — each actor with boundaries and auth model
3. **Repos** — registered repos with their purpose and stack
4. **Design Direction** — locked direction notes + links to approved mocks
5. **User Stories** — organized by party, each containing:
   - Story statement (As a... I want... So that...)
   - Acceptance criteria (testable conditions)
   - Definition of Done (from Phase 5 — already confirmed with the user)
   - Mock reference (for visual stories — link to approved mock file)
   - Repo assignment
6. **Spike Findings** — summary of research results and their impact on stories
7. **System Architecture** — high-level technical design from Phase 6
8. **Data Model** — entities, relationships, key attributes
9. **API/Interface Boundaries** — how components communicate
10. **Non-functional Requirements** — performance, security, compliance
11. **Technical Constraints** — specific implementation requirements (e.g., "use tool_use for structured Bedrock output")
12. **Open Questions** — anything still unresolved (flagged clearly)

### Initialize Epic & State

Create the epic directory and files at `<skill-path>/data/{PROJECT}/{EPIC}/`:
- **epic.json** — epic context (description, parties, tech, design direction). See schema in File Structure section above.
- **state.json** — stories array (each conforming to story-schema.json + execution fields: `has_mock`, `mock_phase` (`"foundational"` | `"detail"`), `mock_approved`, `amended`, `amendment_history`, `wave`, `status`, `commit_sha`, `dod_validation`, `test_results`, `implemented_by`, `started_at`, `completed_at`) and `waves` array.
- Update `<skill-path>/data/active.json` to map this project to the new epic slug.

### Generate Branded HTML

Polished HTML spec: dark sidebar navigation, light content area, green accent (#10b981), professional SaaS aesthetic. Every `<section>` gets `data-section="section-id"` for commenting. Sticky sidebar, responsive. Save to `<skill-path>/data/{PROJECT}/{EPIC}/spec.html`.

### Start Comment Server

```bash
node <skill-path>/scripts/comment-server.js \
  --spec-path <skill-path>/data/{PROJECT}/{EPIC}/spec.html \
  --state-path <skill-path>/data/{PROJECT}/{EPIC}/state.json \
  --port 3847
```

Routes: `/` (spec), `/dashboard`, `/plan`, `/api/comments`, `/api/state`. Comments persist to `<skill-path>/data/{PROJECT}/{EPIC}/comments.json` and survive server restarts.

Tell user: spec is at http://localhost:3847, dashboard at /dashboard, click comment icons for feedback.

### Spec Critic Review

Before showing the spec to the user, dispatch the **Spec Critic** agent (`agents/spec-critic.md`). It reviews the spec for:
- Missing dependencies, orphan stories, circular deps
- Weak or non-discriminating DOD items
- Cross-repo contract mismatches
- Ambiguity and contradictions
- Technical feasibility gaps

If the Spec Critic returns `NEEDS_REVISION`:
- Address critical issues (fix deps, strengthen DODs, resolve contradictions)
- Regenerate spec HTML with fixes
- Then show to user

If `APPROVED`:
- Show spec to user for their review
- Wait for comments, address them, regenerate if needed

### Spec Versioning

Every spec generation creates a versioned copy. The version lifecycle:

1. **Initial generation** (Phase 10) → `spec-v1.html`, `spec.html` = copy of v1
2. **Spec Critic fixes** (if NEEDS_REVISION) → `spec-v2.html`, `spec.html` updated
3. **User comment resolution** (user says "apply comments") → next version
4. **Mid-execution amendment** (story changes during Phase 12) → next version

#### Version Registry

Create `<skill-path>/data/{PROJECT}/{EPIC}/spec-versions.json` on first spec generation:

```json
{
  "current_version": 1,
  "versions": [
    {
      "version": 1,
      "generated_at": "2026-05-26T10:00:00Z",
      "trigger": "phase-10-initial",
      "spec_file": "spec-v1.html",
      "changes_from_previous": []
    }
  ]
}
```

#### Revision Triggers

| Trigger | Automatic? | When |
|---------|-----------|------|
| Spec Critic NEEDS_REVISION | Yes | After Phase 10 initial generation |
| User says "apply comments" / "update the spec" | User-initiated | During spec review or Phase 12 |
| Story amendment during Phase 12 | Automatic | After amendment written to state.json |

#### Revision Flow

When revision is triggered:
1. Archive current spec: copy `spec.html` → `spec-v{N}.html`
2. Regenerate `spec.html` incorporating accepted comments or amendments
3. Append version entry to `spec-versions.json`
4. Mark resolved comments with `applied_in_version: N+1`
5. Dispatch Spec Critic in re-validation mode (only checks changed sections)

#### Comment Resolution

Each comment in `comments.json` gains a `resolution` object when resolved:
```json
{
  "id": 4,
  "section": "us-007",
  "text": "...",
  "timestamp": 1716714000000,
  "resolution": {
    "status": "accepted",
    "resolved_at": "2026-05-26T13:45:00Z",
    "resolution_note": "Added to acceptance criteria",
    "applied_in_version": 3
  }
}
```

Resolution statuses: `"accepted"` (incorporated), `"rejected"` (acknowledged, not changing), `"deferred"` (valid, for later).

#### "Apply Comments" Command

When the user says "apply comments" or "update the spec":
1. Read comments.json — find all unresolved comments
2. For each: propose resolution (accept/reject/defer) to user
3. Batch-resolve all accepted
4. Trigger spec revision
5. Show diff summary: "Spec updated to v{N}: [changes]"

---

## Phase 11: Implementation Plan

### Story Grouping into Waves

Spikes are already executed (Phase 5) — only feature stories get wave assignments here.

Group features into waves based on: **dependencies** (hard rule: story cannot be in a wave unless ALL deps are in earlier waves), **cohesion** (same components), **testability** (each wave produces something demonstrable), **parallelizability** (no conflicts within wave), **incremental value**.

### Plan Structure

For each wave: stories included (and why grouped), DOD per story, tasks in 2-5 min steps with exact file paths/commands, test strategy, demo checkpoint, and parallelization notes.

### Update State

Write wave assignments into `state.json`. Each wave: `{ id, name, stories: [...ids], parallel_groups: [[...], [...]], status }`.

### Plan Critic Review

Before showing the plan to the user, dispatch the **Plan Critic** agent (`agents/plan-critic.md`). It reviews the plan for:
- Parallel group file conflicts (two stories modifying the same files)
- Missing infrastructure (DB setup, env vars, services needed)
- Wave ordering issues
- Unrealistic task breakdowns
- High-risk stories that should be moved earlier
- DOD commands that won't be executable

If the Plan Critic returns `NEEDS_REVISION`:
- Address critical issues (fix parallel conflicts, add infrastructure tasks, reorder)
- Regenerate plan
- Then show to user

If `APPROVED`:
- Show plan to user

### Serve the Plan

Generate plan as HTML (same branding), serve at `/plan` with inline comments. Tell user:
> "Implementation plan is ready at http://localhost:3847/plan. Dashboard at /dashboard now shows wave assignments too."

Wait for approval. Address comments. Once approved, move to execution.

---

## Phase 12: Execution

For the full execution protocol (dependency gate, spike execution, parallel dispatch, automated DOD validation, between-wave regression, completion, and mid-execution amendments), read `references/execution-protocol.md`.

### Execution Loop Per Story

The orchestrator reads `state.json` to decide what to do — never trusts agent reports alone.

```
READ story.status from state.json:

  "pending" + deps met    → set "in_progress", dispatch Coder
  "in_progress" + Coder done → set "qa_validation", dispatch QA
  "qa_validation":
    READ dod_validation.all_passed:
      true  → set "in_review", dispatch Reviewer
      false → set "in_progress", re-dispatch Coder with failures
  "in_review":
    READ review_status:
      "approved" + dod_validation.all_passed → set "done"
      "needs_fixes" → set "in_progress", re-dispatch Coder
  "blocked" → escalate after 3 attempts
```

**Every state transition checks invariants before writing.** If an invariant would be violated, HALT.

### Key Execution Rules

- **State machine is the authority** — a story's status in state.json determines what happens next, not what an agent claims
- **Cannot mark "done" without proof** — `dod_validation.all_passed === true` AND `review_status === "approved"` MUST both be in state.json
- **QA failures loop back to Coder** — there is no "move on anyway" path
- **UAT per wave** — after all stories in a wave reach "done", run UAT (user flow testing via Chrome MCP) before proceeding to next wave
- **Multi-repo aware** — Coder agents receive repo context. QA resolves `${APP_URL}` per-repo. UAT tests cross-repo integration.
- **Scoped regression between waves** — only re-check stories that could be affected, full regression at end only
- **3-strike escalation** — after 3 failed QA/review cycles on the same story, pause and ask the user

---

## Visual Companion

Available throughout Phases 1-9. Offer when a question benefits from showing rather than telling (architecture diagrams, data flows, wireframes, comparisons). Skip for text-answerable questions (scope, confirmations, trade-offs).

**Offer:** "This might be easier to show than describe — want me to open a visual companion in your browser?"

**Mechanics:** Write HTML fragments and serve at `/visual` on the comment server. If the server isn't running yet (pre-Phase 7), start in visual-only mode:
```bash
node <skill-path>/scripts/comment-server.js --visual-only --port 3847
```

---

## State Management

### State File Location

`<skill-path>/data/{PROJECT}/{EPIC}/state.json` — resolved from the active epic via `active.json`

### State Machine

Stories follow a strict state machine defined in `references/execution-protocol.md`. The key insight: **the orchestrator reads state.json to decide what to do next — it does NOT trust agent reports alone.**

```
pending → in_progress → qa_validation → in_review → done
                      ↗ (QA fails)      ↗ (Reviewer rejects)
          in_progress ←←←←←←←←←←←←←←←←
                      → blocked
pending → cancelled / deferred
```

**Illegal transitions (never allowed):**
- `in_progress → done` (skips QA)
- `qa_validation → done` (skips Reviewer)
- Any → `done` unless `dod_validation.all_passed === true` AND `review_status === "approved"`

### What Gets Tracked Per Story

Every story conforms to `references/story-schema.json` plus these execution-time fields:
- `wave` / `parallel_group` — wave assignment from Phase 11
- `status` — `pending` / `in_progress` / `qa_validation` / `in_review` / `done` / `blocked` / `cancelled` / `deferred`
- `commit_sha` — from Coder's report
- `dod_validation` — `{ all_passed, items_passed, items_total, last_run }` — written by QA
- `review_status` — `null` / `"approved"` / `"needs_fixes"` — written by Reviewer
- `test_results` — `{ passed, summary }`
- `implemented_by` — agent model used
- `started_at` / `completed_at` — timestamps
- `amended` / `amendment_history` — tracks mid-execution changes
- `attempts` — number of QA/Review cycles (escalate after 3)

Each DOD item also gains a `result` field after validation: `{ passed, actual, validated_at }`

**Invariants (checked before every state write):**
1. Cannot mark `done` without `dod_validation.all_passed === true`
2. Cannot mark `done` without `review_status === "approved"`
3. Cannot enter `in_review` without `dod_validation.all_passed === true`
4. Cannot enter `in_progress` without all dependencies met

### Dashboard

The `/dashboard` route renders a live view of state.json: progress bar, wave breakdown, DOD checklists, commit SHAs, test indicators, agent attribution, and amendment markers.

---

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

- **Only Coder agents commit to repos** — the orchestrator never commits state files
- **State tracking is file-based** — state.json changes are persisted via writes to the plugin data folder (with backup protocol), not via git
- **For multi-repo stories**: each repo gets its own commit independently. `state.json` records both SHAs.
- **Never commit secrets** — testing_notes in repos.json may reference credentials but those should come from env vars or a vault

---

## Key Principles

- **One question at a time** — never overwhelm with multiple questions
- **Accumulate then analyze** — let the user dump freely, probe gaps after
- **Guess then confirm** — always propose your best understanding, let user correct
- **Every story gets a DOD** — collaborative: propose, ask "anything else?", finalize
- **Waves must be testable** — no wave ends in a state that can't be demonstrated
- **Parallel within waves** — stories that don't conflict run simultaneously
- **Comments drive revision** — the HTML spec is a living document during review
- **State is persistent** — survives session boundaries, enables resume
- **Always thorough** — probe deeply for gaps regardless of project size
- **Self-contained** — no dependency on other plugins for core functionality
- **Server dies on execute-complete** — ephemeral review tool, not a permanent fixture
- **Stories can be cancelled or deferred mid-execution** — update state and re-evaluate any dependents
- **State machine is the authority** — DOD and review gates are enforced by state invariants, not by good intentions
- **Update `current_phase` on every phase transition** — only after phase gate validation passes
- **Phase gates are hard gates** — `node scripts/validate-gate.js` must exit 0 before `current_phase` can increment
- **Spikes before DODs, DODs before spec** — never generate artifacts from incomplete information

---

## Phase Gate Validation

Every phase transition is gated by a code-based validator. Before incrementing `current_phase` in epic.json, you MUST run:

```bash
node <skill-path>/scripts/validate-gate.js --phase <N> --data-path <epic-dir>
```

Where `<N>` is the phase being completed (the current phase, not the next one).

### Validation Flow

1. Run the validator command
2. If exit code **0** → gate passes, increment `current_phase`
3. If exit code **1** → gate fails, read the error output:
   - Fix issues you can resolve (populate missing fields, add required data)
   - Ask the user for issues that require their input
   - Re-run the validator after fixes
   - Do NOT advance until exit code 0

### What the Validator Checks

Two layers:
1. **Schema validation** (AJV) — structural correctness of epic.json, state.json, repos.json against per-phase JSON Schema definitions in `scripts/phase-gates/`
2. **Semantic validation** — cross-reference integrity (party names, repo names), no circular dependencies, wave ordering correctness, required file existence (spike findings, spec.html, plan.html)

### Error Output Format

```
FAIL: Phase 8 gate failed with 3 error(s):

  ✗ SCHEMA /state/stories/5: must have required property 'definition_of_done'
  ✗ SEMANTIC stories[US-012].party: "viewer" not found in epic.json parties
  ✗ SEMANTIC dependencies: circular dependency detected: US-003 → US-007 → US-003
```

### On Resume

When resuming an epic, validate the gate for `current_phase - 1` to confirm state is consistent. If it fails, warn the user that state may be incomplete from a prior session.

### Version Compatibility

Each epic records its `kryptonite_version` at creation. When the validator warns about a version mismatch:
1. Check `references/schema-changelog.json` for what changed between the epic's version and the current version
2. Follow the `migration.steps` for each intermediate version to bring the epic's state up to date
3. The changelog lists every added/modified field, which file it belongs to, and what the safe default is
