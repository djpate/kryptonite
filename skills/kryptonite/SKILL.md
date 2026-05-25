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

All kryptonite data lives at `.kryptonite/` in the project root. Each epic is a separate directory. Only one epic is active at a time.

In path references below, `{EPIC}` = the active epic's slug (read from `.kryptonite/active`).
For example, if the active epic is "user-management", then `.kryptonite/{EPIC}/state.json` = `.kryptonite/user-management/state.json`.

```
.kryptonite/
├── repos.json                         (project-level repo registry — shared across all epics)
├── active                             (file containing slug of active epic)
├── user-management/                   (epic slug — kebab-case)
│   ├── epic.json                      (epic metadata: name, description, parties)
│   ├── state.json                     (stories, waves, execution state)
│   ├── comments.json                  (persisted review comments)
│   ├── spec.html                      (branded spec document)
│   ├── plan.html                      (implementation plan)
│   └── mocks/
│       ├── US-003.html
│       ├── US-003.png
│       ├── US-005.html
│       └── US-005.png
├── notification-system/               (another epic — archived)
│   ├── epic.json
│   ├── state.json
│   ├── spec.html
│   ├── plan.html
│   └── mocks/
└── ...
```

### repos.json (project-level)

The repo registry is shared across ALL epics — define repos once, use them everywhere. Lives at `.kryptonite/repos.json`:

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

When a new epic starts, the existing `repos.json` is already available — no need to redefine repos. Phase 6 only asks about repos if `repos.json` doesn't exist yet or the user wants to add a new one. Use the `repos` skill (`/repos`) to manage the registry independently.

### epic.json

Each epic stores its own context:
- `name`, `slug`, `description`
- `status` — `active` / `completed`
- `current_phase` — integer (1-12) indicating which phase the epic is in. Updated as you progress. Resume reads this directly.
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
2. Create `.kryptonite/{EPIC}/`
3. Write `active` file pointing to the new slug
4. Proceed to Phase 1

### Archiving an Epic

When an epic completes (all stories done) or the user starts a new one:
1. Set `"status": "completed"` and `"completed_at"` in the old epic's `epic.json`
2. Update `active` to point to the new epic (or remove it if none active)

## Resume Detection

Before starting, check for `.kryptonite/` in the project root:

1. **No `.kryptonite/`** → fresh start, ask "What do you want to build?"
2. **Has `active` file** → read the active epic, show story counts, offer resume or new epic
3. **No `active` file** → all epics archived, offer to start a new one

If resuming: read `epic.json` → `current_phase` tells you exactly where to pick up. No inference needed. Show context relevant to that phase and continue.

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
│ 12. Execution (self-contained, parallel agents/wave)    │
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
| **Coder** | `agents/coder.md` | Feature implementation: TDD, commit, self-review | Feature stories in Waves 1+ |
| **QA** | `agents/qa.md` | DOD validation + UAT: run automated checks and per-wave user flow testing | After Coder reports DONE (DOD mode) and after wave completion (UAT mode) |
| **Reviewer** | `agents/reviewer.md` | Spec compliance + code quality review | After QA passes ALL checks |
| **Spec Critic** | `agents/spec-critic.md` | Review spec for gaps, contradictions, weak DODs | After Phase 10 (spec generation) |
| **Plan Critic** | `agents/plan-critic.md` | Review plan for conflicts, ordering issues, infra gaps | After Phase 11 (plan generation) |

### Orchestrator Responsibilities (read `agents/orchestrator.md`)

1. During Phases 1-11, the main session IS the interviewer — follow `agents/interviewer.md` instructions directly
2. After plan approval, execute waves by dispatching Researcher/Coder/QA/Reviewer
3. Enforce dependency gate before every dispatch
4. Route fix feedback: QA failure → Coder, Reviewer rejection → Coder
5. Update state.json after every agent completes
6. Escalate to user after 3 failed attempts on same story

### Execution Loop Per Story

```
Orchestrator checks dependencies → all done?
  ↓ yes
Dispatch Coder (or Researcher for spikes)
  ↓
Coder reports DONE
  ↓
Dispatch QA → run all DOD validations
  ↓
QA ALL_PASS? → Dispatch Reviewer
QA HAS_FAILURES? → Re-dispatch Coder with failure details
  ↓
Reviewer APPROVED? → Update state, mark "done"
Reviewer NEEDS_FIXES? → Re-dispatch Coder with fix list
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

1. **Repos** — Check if `.kryptonite/repos.json` already exists:
   - **If it exists**: show the registered repos and ask "Does this epic use any of these? Need to add a new one?"
   - **If not**: ask "What repos will this epic touch? For each one, I need: a short name, the path, what code it holds, its stack, and how to run/test it." Then write `repos.json`.
2. Architectural constraints or patterns to follow?
3. Existing infrastructure to integrate with (auth, API gateway, message queue)?
4. Testing approach preferences (frameworks, coverage expectations)?
5. Non-functional requirements (performance, scale, compliance)?
6. Confirm kryptonite directory location (Default: `.kryptonite/` at project root)

### Multi-Repo Support

Epics can span multiple repositories. Repos are registered once at **project level** in `.kryptonite/repos.json` (not per-epic). They persist across all epics so you never redefine them.

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

### Step 1: Identify visual stories and batch-mock them.

Mark visual stories with `"has_mock": true`. **Group by design context** (e.g., "admin screens" vs "user experience") and mock in batches:
- Dispatch **Designer** agents in parallel per batch
- Once ready, open the **`/compare`** view for the user — fullscreen side-by-side previews with click-to-pick
- User clicks their preferred option for each story (arrow keys to navigate, number keys to pick)
- Orchestrator reads selections from `/api/selections` once the user submits
- Lock direction after 3+ approvals without changes

Mocks stored at: `.kryptonite/{EPIC}/mocks/{story-id}.html` (variants: `{story-id}-option-a.html`)

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

Create the epic directory and files at `.kryptonite/{EPIC}/`:
- **epic.json** — epic context (description, parties, tech, design direction). See schema in File Structure section above.
- **state.json** — stories array (each conforming to story-schema.json + execution fields: `has_mock`, `mock_approved`, `amended`, `amendment_history`, `wave`, `status`, `commit_sha`, `dod_validation`, `test_results`, `implemented_by`, `started_at`, `completed_at`) and `waves` array.
- **active** file at `.kryptonite/active` containing the epic slug.

### Generate Branded HTML

Polished HTML spec: dark sidebar navigation, light content area, green accent (#10b981), professional SaaS aesthetic. Every `<section>` gets `data-section="section-id"` for commenting. Sticky sidebar, responsive. Save to `.kryptonite/{EPIC}/spec.html`.

### Start Comment Server

```bash
node <skill-path>/scripts/comment-server.js \
  --spec-path .kryptonite/{EPIC}/spec.html \
  --state-path .kryptonite/{EPIC}/state.json \
  --port 3847
```

Routes: `/` (spec), `/dashboard`, `/plan`, `/api/comments`, `/api/state`. Comments persist to `.kryptonite/{EPIC}/comments.json` and survive server restarts.

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

`.kryptonite/{EPIC}/state.json` — resolved from the active epic

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

Commit after every meaningful state change. This creates a traceable history of how the spec evolved and how stories were implemented.

### Phase Commits (in the project repo where `.kryptonite/` lives)

| When | Commit Message |
|------|---------------|
| Phase 4 complete (parties defined) | `kryptonite({EPIC}): define parties` |
| Phase 5 complete (spikes executed) | `kryptonite({EPIC}): complete spikes` |
| Phase 6 complete (re-scope done) | `kryptonite({EPIC}): re-scope after spike findings` |
| Phase 7 complete (tech guidance) | `kryptonite({EPIC}): technical guidance` |
| Phase 8 complete (DOD + mocks) | `kryptonite({EPIC}): define DOD and approve mocks` |
| Phase 10 (spec generated) | `kryptonite({EPIC}): generate spec` |
| Phase 11 (plan approved) | `kryptonite({EPIC}): approve implementation plan` |
| Mock approved | `kryptonite({EPIC}): approve mock for {story-id}` |
| Spike finding written | `kryptonite({EPIC}): spike {story-id} complete` |
| Epic completed | `kryptonite({EPIC}): epic complete` |

### Story Commits (in the story's assigned repo)

| When | Commit Message |
|------|---------------|
| Coder implements story | `feat({story-id}): {short description}` |
| Coder fixes QA failure | `fix({story-id}): address QA feedback` |
| Coder fixes review feedback | `fix({story-id}): address review feedback` |
| Story fully validated (done) | No extra commit — the last fix/feat commit is the final one |

### Rules

- **Phase commits go in the repo where `.kryptonite/` lives** — they track spec/plan/state evolution
- **Story commits go in the story's assigned repo** — they track code changes
- **Commit includes only relevant files** — don't commit unrelated changes alongside kryptonite state
- **For multi-repo stories**: each repo gets its own commit independently. `state.json` records both SHAs.
- **Never commit secrets** — testing_notes in repos.json may reference credentials but those should come from env vars or a vault, not be committed
- **The Coder agent commits as part of its implementation** — the orchestrator commits phase transitions

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
- **Update `current_phase` on every phase transition** — so resume always works
- **Spikes before DODs, DODs before spec** — never generate artifacts from incomplete information
