# JSON Schema-Driven Spec & Plan Generation

## Problem

Kryptonite currently generates `spec.html` and `plan.html` as custom branded HTML documents directly from the LLM. This produces inconsistent output quality — missing sections, varying depth, unreliable structure. The UI serves these HTML files as-is with injected Alpine.js for commenting.

## Solution

Replace freeform HTML generation with JSON documents validated against JSON Schema. The LLM produces structured data conforming to strict schemas. The UI becomes a client-side renderer of that JSON. A two-layer validation system (schema + semantic) enforces quality before any spec or plan is saved.

## Design Decisions

- **Full Graph Schema** — every object has a stable ID, enabling cross-referencing and referential integrity checks across the entire spec and plan
- **Fully structured** — no freeform prose anywhere; every section has typed, queryable fields
- **$ref composition** — spec-schema.json uses JSON Schema `$ref` to compose story-schema.json where stories appear
- **Tight coupling** — semantic validation ensures 100% story coverage between spec and plan (every story appears in exactly one wave)
- **Client-side rendering** — UI fetches JSON via API, Alpine.js renders all presentation
- **Clean break** — new projects get JSON; old projects keep HTML unchanged

---

## Schema Architecture

Three schemas compose together:

| Schema | File | Purpose |
|--------|------|---------|
| `spec-schema.json` | `references/spec-schema.json` | Validates the full spec document |
| `plan-schema.json` | `references/plan-schema.json` | Validates the implementation plan |
| `story-schema.json` | `references/story-schema.json` | Validates individual stories (existing, composed via $ref) |

### Data Flow

```
LLM generates spec.json / plan.json
         |
         v
AJV validates against schema (Layer 1)
         |
         v
Semantic validator checks cross-references (Layer 2)
         |
         v
Pass? --> save to epic directory
Fail? --> structured error array fed back to LLM for correction (max 3 retries)
```

### File Layout Change

| Before | After |
|--------|-------|
| `spec.html` | `spec.json` |
| `plan.html` | `plan.json` |
| `state.json` with `waves[]` | `state.json` without waves (execution status only) |
| N/A | Waves defined in `plan.json` |
| `spec-versions.json` | Unchanged (tracks version history, points to JSON) |

---

## spec-schema.json Structure

```json
{
  "version": "1.0.0",
  "generated_at": "ISO timestamp",
  "epic_slug": "string",

  "overview": {
    "name": "string",
    "description": "string",
    "goals": ["string — 2-5 measurable project goals"],
    "non_goals": ["string — explicit exclusions"],
    "target_users": ["string"]
  },

  "parties": [{
    "id": "kebab-case-id",
    "name": "string",
    "description": "string",
    "auth": "string",
    "boundaries": "string"
  }],

  "repos": [{
    "id": "string",
    "name": "string",
    "stack": "string",
    "path": "string"
  }],

  "architecture": {
    "components": [{
      "id": "kebab-case-id",
      "name": "string",
      "type": "service | library | store | external | action",
      "responsibility": "string",
      "repo": "repo-id",
      "key_files": ["relative/path.ts"]
    }],
    "interactions": [{
      "from": "component-id",
      "to": "component-id",
      "protocol": "function_call | event | http | websocket | ipc | caldav",
      "description": "string",
      "async": false
    }],
    "decisions": [{
      "id": "ADR-NNN",
      "title": "string",
      "status": "accepted | superseded | deprecated",
      "context": "string",
      "choice": "string",
      "alternatives": [{ "option": "string", "rejected_because": "string" }],
      "consequences": ["string"]
    }]
  },

  "data_model": {
    "entities": [{
      "id": "PascalCaseId",
      "description": "string",
      "fields": [{
        "name": "string",
        "type": "string | number | boolean | Date | enum | ref",
        "constraints": ["required", "unique", "indexed", "not_null"],
        "enum_values": ["optional if type=enum"],
        "ref_target": "optional entity-id if type=ref"
      }],
      "relationships": [{
        "target": "entity-id",
        "cardinality": "one-to-one | one-to-many | many-to-one | many-to-many",
        "description": "string"
      }]
    }]
  },

  "api_boundaries": [{
    "id": "boundary-id",
    "name": "string",
    "type": "rest | graphql | caldav | sdk | ipc",
    "direction": "inbound | outbound",
    "endpoints": [{
      "id": "endpoint-id",
      "method": "GET | POST | PUT | DELETE | PROPFIND | REPORT",
      "path": "string",
      "description": "string",
      "auth": "oauth2 | api_key | app_password | none",
      "request_shape": { "fields": [{"name": "string", "type": "string", "required": true}] },
      "response_shape": { "fields": [{"name": "string", "type": "string"}] },
      "error_cases": [{ "code": "number", "meaning": "string", "handling": "string" }],
      "rate_limit": "string or null"
    }]
  }],

  "nfrs": [{
    "id": "NFR-NNN",
    "category": "performance | security | reliability | scalability | usability | privacy",
    "requirement": "string",
    "metric": "string",
    "target": "string or number",
    "measurement_method": "string"
  }],

  "technical_constraints": [{
    "id": "TC-NNN",
    "category": "platform | sdk | provider | legal | distribution",
    "constraint": "string",
    "impact": "string",
    "source": "string"
  }],

  "design_direction": {
    "locked": true,
    "style_summary": "string",
    "color_system": { "primary": "#hex", "secondary": "#hex", "surface": "#hex", "text": "#hex" },
    "typography": "string",
    "approved_mock_ids": ["US-NNN"]
  },

  "stories": ["$ref: story-schema.json — array of full story objects"],

  "spike_findings": [{
    "story_id": "US-SNNN",
    "question": "string",
    "finding": "string",
    "decision": "string",
    "evidence": "string",
    "impacts": ["story-id"]
  }],

  "open_questions": [{
    "id": "OQ-NNN",
    "question": "string",
    "context": "string",
    "proposed_answer": "string or null",
    "blocks": ["story-id or component-id"]
  }]
}
```

---

## plan-schema.json Structure

```json
{
  "version": "1.0.0",
  "generated_at": "ISO timestamp",
  "epic_slug": "string",
  "spec_version": "string",

  "summary": {
    "total_stories": "number",
    "total_waves": "number",
    "critical_path_depth": "number",
    "priority_breakdown": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
    "estimated_duration": "string"
  },

  "waves": [{
    "id": "wave-N",
    "name": "string",
    "sequence": "number",
    "theme": "string",
    "estimated_duration": "string",
    "prerequisites": ["wave-id"],
    "parallel_groups": [{
      "id": "wave-N/group-name",
      "name": "string",
      "domain": "string — file-domain ownership description",
      "blocking": false,
      "stories": ["US-NNN"],
      "tasks": [{
        "id": "T-NNN",
        "story_ref": "US-NNN",
        "description": "string",
        "file_paths": ["src/path.ts"],
        "commands": ["string"],
        "effort": "S | M | L | XL",
        "depends_on": ["T-NNN"]
      }]
    }],
    "demo_checkpoint": {
      "description": "string",
      "validates": ["US-NNN"],
      "criteria": ["string — testable statement"]
    },
    "post_wave_validation": [{
      "check": "string",
      "command": "string",
      "expect": "string"
    }]
  }],

  "critical_path": [{
    "story_id": "US-NNN",
    "wave": "wave-id",
    "blocks": "US-NNN",
    "reason": "string"
  }],

  "parallel_strategy": {
    "max_concurrent_agents": "number",
    "file_conflict_rules": [{
      "pattern": "glob pattern",
      "exclusive_to": "string — constraint description",
      "reason": "string"
    }],
    "worktree_strategy": "per_parallel_group | per_story"
  },

  "risks": [{
    "id": "RISK-NNN",
    "category": "external_dependency | complexity | integration | timing",
    "description": "string",
    "probability": "low | medium | high",
    "impact": "low | medium | high",
    "mitigation": "string",
    "affected_stories": ["US-NNN"]
  }]
}
```

---

## Validation System

### Layer 1: JSON Schema (AJV)

Same pattern as existing `validate-gate.js`. Scripts:

- `validate-spec.js spec.json` — schema validation only
- `validate-plan.js plan.json spec.json` — schema + needs spec for cross-reference

Exit 0 = pass, exit 1 = fail with structured error output.

### Layer 2: Semantic Validation

Programmatic checks that JSON Schema cannot express.

**Spec semantic rules:**

| Rule | Description |
|------|-------------|
| Component connectivity | Every component appears in at least one interaction |
| Repo references | `components[].repo` and `stories[].repo` match `repos[].id` |
| Party references | `stories[].party` matches `parties[].id` |
| Dependency DAG | `stories[].dependencies` forms an acyclic graph |
| Entity references | `relationships[].target` matches an `entities[].id` |
| Spike coverage | Every spike-type story has a `spike_findings[]` entry |
| Open question linkage | `open_questions[].blocks[]` references existing IDs |

**Plan semantic rules (cross-validated against spec):**

| Rule | Description |
|------|-------------|
| Story coverage | Every non-deferred spec story appears in exactly one parallel group |
| No phantom stories | Every story ID in plan exists in spec |
| Wave DAG | `prerequisites` forms acyclic graph respecting `sequence` |
| Task DAG | `depends_on` references only tasks in prior waves or earlier in same group |
| File conflict | No two parallel groups in same wave share `file_paths` |
| Blocking order | `blocking: true` group completes before others in same wave start |
| Demo coverage | `demo_checkpoint.validates[]` only references stories in that wave |
| Risk linkage | `risks[].affected_stories[]` references existing story IDs |

### Error Output Format

```json
{
  "valid": false,
  "errors": [{
    "layer": "schema | semantic",
    "path": "$.architecture.components[2].repo",
    "rule": "repo_reference",
    "message": "Component 'auth-manager' references repo 'backend' which does not exist in repos[]",
    "suggestion": "Available repos: plugin, website"
  }]
}
```

The `suggestion` field gives the LLM actionable guidance for self-correction.

---

## UI Changes

### New API Endpoints

- `GET /api/spec` — returns `spec.json`
- `GET /api/plan` — returns `plan.json`
- `GET /api/spec/schema` — returns `spec-schema.json`
- `GET /api/plan/schema` — returns `plan-schema.json`

Existing endpoints unchanged: `/api/comments`, `/api/state`, `/api/epic`.

### Client-Side Rendering

Spec and plan pages become Alpine.js SPAs that fetch JSON and render all presentation client-side. The UI owns:
- Section ordering, collapsing, filtering
- Badge colors, priority pills, typography
- Comment anchoring (by object ID path, not HTML attribute)
- Future capabilities: search, cross-reference navigation, dependency graph visualization

### Comment Anchoring

| Before | After |
|--------|-------|
| `data-section="overview"` HTML attribute | Object path: `spec.overview` |
| Fragile across regeneration | Stable — IDs don't change if rendering reorders |

Comments stored with path like `spec.architecture.decisions[0]` or `plan.waves[2].parallel_groups[1]`.

---

## LLM Generation Flow

### Phase 10 (Spec Generation)

1. LLM receives `spec-schema.json` in prompt context
2. LLM produces `spec.json` conforming to schema
3. `validate-spec.js` runs (schema + semantic)
4. Fail → structured error array fed back → retry (max 3)
5. Pass → save to epic directory
6. Spec Critic agent reviews structured data
7. Version tracked in `spec-versions.json`

### Phase 11 (Plan Generation)

1. LLM receives `plan-schema.json` + `spec.json` in prompt context
2. LLM produces `plan.json` conforming to schema
3. `validate-plan.js` runs (schema + semantic + cross-ref against spec)
4. Fail → structured error array fed back → retry (max 3)
5. Pass → save to epic directory
6. Plan Critic agent reviews
7. `state.json` updated: stories get `wave` and `parallel_group` fields copied from plan

### Phase Gate Updates

- `phase-gates/10.json` — validates `spec.json` exists AND passes both validation layers
- `phase-gates/11.json` — validates `plan.json` exists AND passes both layers AND cross-validates against spec

---

## Migration Strategy

**Clean break.** Old projects with `spec.html`/`plan.html` continue working unchanged. New projects generate JSON only. No migration tooling, no dual-support in UI.

Detection: if `spec.json` exists, serve the new Alpine.js SPA renderer. If only `spec.html` exists, serve raw HTML with injected commenting (current behavior).

---

## Files to Create/Modify

### New Files
- `references/spec-schema.json` — full JSON Schema for spec
- `references/plan-schema.json` — full JSON Schema for plan
- `scripts/validate-spec.js` — AJV schema + semantic validation for spec
- `scripts/validate-plan.js` — AJV schema + semantic validation for plan
- `scripts/ui/spec.html` — Alpine.js SPA for rendering spec.json
- `scripts/ui/plan.html` — Alpine.js SPA for rendering plan.json

### Modified Files
- `scripts/comment-server.js` — add `/api/spec`, `/api/plan`, `/api/spec/schema`, `/api/plan/schema` endpoints; detect JSON vs HTML mode
- `SKILL.md` — update Phase 10 and Phase 11 instructions to produce JSON instead of HTML
- `scripts/phase-gates/10.json` — update to validate spec.json content
- `scripts/phase-gates/11.json` — update to validate plan.json content
- `agents/spec-critic.md` — update to review structured JSON
- `agents/plan-critic.md` — update to review structured JSON

### Unchanged
- `references/story-schema.json` — stays as-is, composed via $ref
- `scripts/validate-gate.js` — stays as-is (generic gate runner)
- All execution-phase code (Phase 12) — reads `state.json` which still has story status
