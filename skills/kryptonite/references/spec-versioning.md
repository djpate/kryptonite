# Spec Versioning, Comments, and Revisions

This document defines how the spec is versioned, how user comments are persisted and resolved, and how revisions are triggered. The goal: every change to the spec is auditable, the user can always see what changed and why, and resolved comments don't disappear into the void.

## Phase 10 generator inputs

The spec is built from two kinds of sources: **lift sections** (verbatim copy from upstream slots) and **synthesis sections** (derived from stories + ADRs by an LLM pass). Don't conflate them — the rules differ.

### Lift sections (mapper)

These have a 1:1 upstream slot in `epic.json` or `state.json`. Lifting is mechanical.

| `spec.json` section                  | Source                                   |
|--------------------------------------|------------------------------------------|
| `architecture.decisions[]` (ADRs)    | `epic.json.decisions[]` (drop the extension fields `source_phase`, `related_stories` when shaping for `spec-schema.json`) |
| `open_questions[]`                   | `epic.json.open_questions[]` (drop `source_phase`) |
| `parties[]`                          | `epic.json.parties[]` (id passed through verbatim — see party-id note below) |
| `nfrs` and related sections          | `epic.json.technical_context.non_functional` |
| `technical_constraints` / patterns   | `epic.json.technical_context.patterns`   |
| `design_direction`                   | `epic.json.design_direction` (the structured `shell_summary` populates `color_system`, `typography`, etc. — see `references/spec-schema.json`) |
| `risks[]`                            | `epic.json.risks[]` if present, otherwise empty |
| `preflight_requirements[]`           | `plan.json.preflight_requirements[]` (lifted into the spec for visibility) |
| Scope evolution narrative            | `epic.json.scope_history[]`              |
| `stories[]`                          | `state.json.stories[]`                   |
| `spike_findings[]`                   | `state.json.stories[]` (where `type === "spike"`) + `data/.../spikes/<id>-*.md` |

If a lift section's upstream slot is empty, that's a Phase 3/7/8 gate failure that slipped through — bail out and tell the user, don't fabricate. **Party ids:** `^[a-z][a-z0-9_-]*$` is permitted; whatever shape Phase 4 captured (e.g. `account_admin` or `account-admin`) is reused verbatim in `stories[].party`. There is no underscore→hyphen remap.

### Synthesis sections (derived)

These are not stored anywhere upstream — they are derived from stories + ADRs + technical_context by an LLM synthesis pass before the spec is rendered. Each is its own subagent dispatch (parallel where independent).

| `spec.json` section                  | Synthesis inputs                         |
|--------------------------------------|------------------------------------------|
| `architecture.components[]`          | `state.json.stories[]`, `epic.json.decisions[]`, `repos.json[].conventions`, `epic.json.technical_context.infrastructure` |
| `architecture.interactions[]`        | the resolved `architecture.components[]` + `state.json.stories[]` (must dispatch after components) |
| `data_model.entities[]`              | `state.json.stories[]` (data nouns), `epic.json.decisions[]` (storage choices) |
| `api_boundaries[]`                   | `state.json.stories[]` (endpoints implied by AC + DOD), `repos.json[].conventions.directory_layout` |

If a synthesis section comes back empty, the LLM pass failed — re-run, do not paper over. If a synthesis section *cannot* be derived from stories+ADRs (the inputs are themselves missing), the upstream slot is missing — bail out and tell the user, just like a lift section.

## Version Lifecycle

Every spec generation creates a versioned copy. The lifecycle:

1. **Initial generation** (Phase 10) → `spec-v1.html`, `spec.html` = copy of v1
2. **Spec Critic fixes** (if `NEEDS_REVISION`) → `spec-v2.html`, `spec.html` updated
3. **User comment resolution** (user says "apply comments") → next version
4. **Mid-execution amendment** (story changes during Phase 12) → next version

## Version Registry

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

## Revision Triggers

| Trigger | Automatic? | When |
|---------|-----------|------|
| Spec Critic `NEEDS_REVISION` | Yes | After Phase 10 initial generation |
| User says "apply comments" / "update the spec" | User-initiated | During spec review or Phase 12 |
| Story amendment during Phase 12 | Automatic | After amendment written to `state.json` |

## Revision Flow

When revision is triggered:
1. Archive current spec: copy `spec.html` → `spec-v{N}.html`
2. Regenerate `spec.html` incorporating accepted comments or amendments
3. Append a version entry to `spec-versions.json`
4. Mark resolved comments with `applied_in_version: N+1`
5. Dispatch Spec Critic in re-validation mode (only checks changed sections)

## Comment Resolution

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

Resolution statuses:
- `"accepted"` — incorporated into the spec
- `"rejected"` — acknowledged, not changing
- `"deferred"` — valid, for a later epic

## "Apply Comments" Command

When the user says "apply comments" or "update the spec":
1. Read `comments.json` — find all unresolved comments
2. For each: propose resolution (accept/reject/defer) to user
3. Batch-resolve all accepted
4. Trigger spec revision
5. Show diff summary: "Spec updated to v{N}: [changes]"

## Why version everything

Specs evolve during a multi-day project. Without versioning, the user can't tell what they originally agreed to vs. what got slipped in mid-execution. The version registry + comment resolution log produce a paper trail: every change has a trigger, a timestamp, and a list of which comments it answered.

Mid-execution amendments are the most dangerous case — a story's acceptance criteria changing while a Coder is mid-implementation. Versioning + the `amendment_history` field on each story (see `references/story-schema.json`) make those changes visible in the spec, in the dashboard, and in the gate reports.
