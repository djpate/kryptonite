# Spec Versioning, Comments, and Revisions

This document defines how the spec is versioned, how user comments are persisted and resolved, and how revisions are triggered. The goal: every change to the spec is auditable, the user can always see what changed and why, and resolved comments don't disappear into the void.

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
