# Kryptonite Storage Protocol

This document defines where kryptonite stores data, how project IDs are computed, the safe-write protocol for `state.json`, and how legacy `.kryptonite/` directories are migrated.

## Why plugin-folder storage

All kryptonite data lives in the **plugin folder** — never in the project repo. This keeps repos clean, avoids polluting git history, and keeps the workflow invisible to teammates who aren't using kryptonite.

**Storage root:** `<skill-path>/data/`

Each project is identified by a 12-char hash derived from its git remote URL (or repo path if no remote). In path references below:
- `{PROJECT}` = the project's 12-char ID
- `{EPIC}` = the active epic's slug

```
<skill-path>/data/
├── registry.json                      (global: project-id → project metadata; conforms to registry-schema.json)
├── active.json                        (global: project-id → active epic slug; conforms to active-schema.json)
└── {PROJECT}/
    ├── project.json                   (source, path, name, created_at)
    ├── repos.json                     (project-level repo registry; conforms to repos-schema.json)
    └── {EPIC}/
        ├── epic.json                  (epic metadata: name, description, parties)
        ├── state.json                 (stories, waves, execution state)
        ├── state.json.bak             (backup — last known good state)
        ├── comments.json              (persisted review comments)
        ├── spec.html                  (branded spec document)
        ├── plan.html                  (implementation plan)
        ├── spec-versions.json         (versioned spec history; see Spec Versioning)
        ├── spikes/
        │   └── US-000-topic.md
        └── mocks/
            ├── US-003.html
            ├── US-003.png
            ├── US-005.html
            └── US-005.png
```

## Project Identification

On startup, compute the project ID:
1. Try: `git remote get-url origin` → SHA-256 first 12 chars of the URL
2. Fallback: SHA-256 first 12 chars of the absolute repo root path

Store the mapping in `registry.json` (see `references/registry-schema.json`):

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

## State Write Protocol (Backup & Recovery)

Before every `state.json` write:
1. Copy current `state.json` → `state.json.bak`
2. Write new content to `state.json.tmp`
3. Validate JSON parse of the tmp file
4. Rename `state.json.tmp` → `state.json` (atomic)

On load:
1. Parse `state.json` — if valid, use it
2. If corrupt: restore from `state.json.bak`, warn the user
3. If both corrupt: halt, report to user (manual recovery needed)

This same protocol applies to `epic.json`, `comments.json`, and `spec-versions.json` — anything kryptonite writes mid-workflow that would lose state if truncated.

## Migration from `.kryptonite/`

If `.kryptonite/` exists in the project root (legacy location):
1. Inform user: "Found existing data in `.kryptonite/`. Migrating to plugin storage."
2. Compute project-id, create `data/{PROJECT}/`
3. Copy epic directories and `repos.json` to the new location
4. Verify by loading state from the new location
5. Ask user: "Remove `.kryptonite/` from your repo?" (offer git rm + commit)

## Resume Detection

Before starting any workflow, check plugin data for the current project:

1. Compute project-id from current working directory
2. Look up in `<skill-path>/data/active.json`
3. **No entry** → fresh start, ask "What do you want to build?"
4. **Has active epic** → read the epic's `epic.json`, show story counts, offer resume or new epic
5. **Entry but no active epic** → all epics archived, offer to start a new one

If resuming: read `epic.json` → `current_phase` tells you exactly where to pick up. No inference needed. Show context relevant to that phase and continue.

### Phase 12 resume — self-heal then digest

When `current_phase` is 12, before dispatching anything the orchestrator runs two routines, then
prints a digest. All three operate from on-disk state — nothing is carried in the resume prompt.

**1. Self-heal (`reconcileState`).** Both steps log what they changed (surfaced in the digest) and
use the safe-write protocol.

- *Materialize the next wave.* If `plan.json` defines the next wave to run (`wave-N` with
  `parallel_groups` + `user_journeys`) but `state.json.waves[]` has no entry for it, create one —
  `{ id, name, stories, status: "pending", gate_runs: [] }` — mirroring an existing wave entry, and
  set those stories' `status` to `pending`. Materialize **only the next wave**, never all remaining
  waves: materializing unreached waves invents state for not-yet-detailed work and would make the
  Phase-12 gate see phantom pending waves.
- *Backfill gate runs.* For any wave whose `wave-K/gates/*.json` report files exist on disk but
  which has no `gate_runs[]` entry in `state.json`, reconstruct the entry from the report files
  (per-gate `status` + `report_path`, hoisting `issues[]`). Idempotent — skip waves that already
  have `gate_runs[]`.

**2. Resume digest.** After self-heal, read `epic.json.findings[]`, `state.json`, `plan.json`,
`repos.json`, and `git log`, then print a digest with these sections (omit any that are empty):

- Header — epic, phase, next wave; verified HEAD + branch, completed waves, story counts (from git/state).
- Self-heal — what `reconcileState` changed this resume.
- DECISIONS NEEDED — `findings[]` where `resolution == "open"` and audience includes `human`
  (and any `deferred_defect` worth a fix-now/defer choice).
- FORWARDED TO THIS WAVE — `findings[]` where `forward_to_waves[]` contains the next wave; show
  coder/gate-audience ones as instructions.
- REPO CONVENTIONS IN PLAY — for repos this wave touches, the headline `conventions` facts
  (test_data_gotchas, grep_gotchas, the introspection/spec commands) from `repos.json`.
- NEXT ACTION — the next wave's shape (story count, repos, mocks?) and any configured pause point.

The digest is what lets the user's resume prompt collapse to a single line (e.g. "Resume <epic>,
begin wave N"). Everything else is read from disk.

**Legacy migration:** If `active.json` has no entry but `.kryptonite/` exists in the project root, trigger migration (above).

## epic.json contents

The full shape is defined by `references/epic-schema.json`. In addition to identity fields (`name`, `slug`, `description`, `status`, `current_phase`, `kryptonite_version`, `created_at`, `completed_at`), `epic.json` is the home for **everything the conversational phases produce** other than per-story data:

- `parties[]` — Phase 4 actors (`{name, description, auth}`)
- `decisions[]` — Phase 3 ADRs, lifted into `spec.json.architecture.decisions[]` in Phase 10
- `open_questions[]` — Phase 3 OQs, lifted into `spec.json.open_questions[]` in Phase 10
- `scope_history[]` — Phase 6 scope-delta log
- `technical_context` — Phase 7 testing / non-functional / infrastructure / patterns
- `design_direction` — Phase 8 mock approval state + structured `shell_summary`
- `findings[]` — Phase 12 execution discoveries (durable lessons, deferred defects, regression
  risks). Replaces the ad-hoc `state.deferred_findings[]`. See the Findings section in
  `references/execution-protocol.md`.

If a phase produces content with no slot above, the schema needs another field. Adding load-bearing content as a sidecar `.md` file makes it invisible to the spec generator and lost on resume — see the "Discipline" rationalization table in `SKILL.md`.

Repos are NOT stored per-epic — they come from the project-level `repos.json`.

## state.json contents

Stories and execution state. Each story conforms to `references/story-schema.json` plus the execution-time fields enumerated in `references/execution-protocol.md`. The `waves[]` array follows the wave schema in the same document.

## Starting a New Epic

When starting fresh (no active epic, or user says "new epic"):
1. Ask for the epic name/slug
2. Compute project-id (from git remote or path)
3. Create `<skill-path>/data/{PROJECT}/{EPIC}/`
4. Initialize `epic.json` with `kryptonite_version` read from `<skill-path>/../../package.json` (the plugin's root `package.json`)
5. Update `active.json` to map this project path to the new epic
6. Proceed to Phase 1

## Archiving an Epic

When an epic completes (all stories done) or the user starts a new one:
1. Set `"status": "completed"` and `"completed_at"` in the old epic's `epic.json`
2. Update `active.json` to point to the new epic (or remove the entry if none active)

## Why repos live at project level, not per-epic

The repo registry is shared across ALL epics — define repos once, use them everywhere. When a new epic starts, the existing `repos.json` is already available — no need to redefine repos. Phase 7 only asks about repos if `repos.json` doesn't exist yet or the user wants to add a new one.

Use the `repos` skill (`/repos`) to manage the registry independently.

`testing_notes` in each repo entry is free-form — credentials, URLs, seed commands, API keys, env vars, external service configs, anything agents need when working in this repo.
