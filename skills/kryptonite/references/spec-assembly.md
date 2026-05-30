# Spec Assembly — Phase 10 Algorithm

This document is the procedural companion to `spec-versioning.md`. The versioning doc defines *what* the spec lifts vs synthesizes; this doc defines *how* the assembler turns those inputs into a `spec.json` that passes `scripts/validate-spec.js`.

There is intentionally no `generate-spec.js` script. Phase 10 is run by an LLM agent; this file is the algorithm it follows.

## Inputs

- `<epic-dir>/epic.json` — parties, decisions, open_questions, technical_context, design_direction, scope_history, risks
- `<epic-dir>/state.json` — stories[]
- `<epic-dir>/spikes/*.md` — spike findings (resolved by `state.json.stories[].id` for `type === "spike"`)
- `<project-dir>/repos.json` — repos referenced by stories (for synthesis sections)

## Output

`<epic-dir>/spec.json` conforming to `references/spec-schema.json`.

## Pseudocode

```
spec = {
  version: epic.spec_version || "1.0.0",
  generated_at: ISO_NOW,
  epic_slug: epic.slug,
  overview: { name: epic.name, description: epic.description, goals, non_goals, target_users },
  parties: lift(epic.parties, party_passthrough),
  repos: lift(repos.json filtered to those referenced by stories),
  open_questions: lift(epic.open_questions, drop ["source_phase"]),
  scope_evolution: lift(epic.scope_history),
  design_direction: lift(epic.design_direction),
  stories: lift(state.stories, story_passthrough),
  spike_findings: lift(state.stories where type === "spike") + read(spikes/*.md),
  nfrs: lift(epic.technical_context.non_functional),
  technical_constraints: lift(epic.technical_context.patterns),
  risks: lift(epic.risks ?? []),
  preflight_requirements: lift(plan.preflight_requirements ?? []),  // when plan.json already exists
  architecture: synthesize_architecture(state.stories, epic.decisions, repos, epic.technical_context),
  data_model: synthesize_data_model(state.stories, epic.decisions),
  api_boundaries: synthesize_api_boundaries(state.stories, repos)
}
validate_spec(spec)
dispatch(spec_critic, spec)
if critic.NEEDS_REVISION: apply_critical_fixes(spec, critic.report); regenerate
write(spec.json); render(spec.html); start(comment-server, port=3847)
```

## Step details

### 1. Lift sections

For every entry in the lift table in `spec-versioning.md`, copy verbatim — drop only the explicitly noted extension fields.

**Party id passthrough.** `^[a-z][a-z0-9_-]*$` is permitted. Whatever Phase 4 captured is reused verbatim in `parties[].id` and `stories[].party`. There is no underscore→hyphen remap. `validate-spec.js` enforces `stories[].party === parties[].id` exactly, so consistency upstream matters more than normalization downstream.

**Story passthrough.** `state.json.stories[]` already conforms to `story-schema.json`. Drop runtime-only fields when shaping for `spec.json` (`status`, `commit_sha`, `merged_at`, `started_at`, `completed_at`, `attempts`) — those describe execution, not specification.

**Spike findings join.** For each story where `type === "spike"`, look up `<epic-dir>/spikes/<spike-id>-*.md`. If the file is missing for a spike, surface as a Phase 10 hard error — don't silently emit an empty finding.

### 2. Synthesis sections

Each synthesis section is independent except where noted. Dispatch parallel subagents (one per section, one Task call per agent), give each only the inputs it needs (slim views — see agent guidance), and validate each return against the relevant `spec-schema.json` sub-schema before merging.

| Section | Inputs | Notes |
|---|---|---|
| `architecture.components[]` | stories, decisions, repos, technical_context.infrastructure | Each component's `id` must be referenced consistently — collisions in id are a hard error |
| `architecture.interactions[]` | resolved `architecture.components[]` + stories | Must dispatch *after* components — `from`/`to` reference component ids |
| `data_model.entities[]` | stories (data nouns), decisions (storage choices) | Foreign keys derived from stories' acceptance_criteria text + ADRs about relations |
| `api_boundaries[]` | stories, repos.json[].conventions.directory_layout (when present) | Endpoints surface from AC + DOD; method/auth surface from technical_context.non_functional + ADRs |

If any synthesis pass returns an empty array but the inputs have content, re-run the dispatch — empty is almost always a prompt failure, not a true negative.

If the inputs themselves are empty (e.g. no infrastructure decisions exist), bail to the user with a concrete missing-slot message. Don't fabricate.

### 3. Schema validation

```
node scripts/validate-spec.js <spec.json>
```

Exit 0 advances. Output groups into:

- **errors** (`schema` + `semantic`) — JSON Schema violations and cross-reference checks (`stories[].party` exists, story dependencies exist, `affected_stories` point to real stories). Always blocking.
- **warnings** — heuristic checks that surface likely problems without blocking. Currently: `data_model_ownership_conflict`.

Fix errors and re-run; never bypass. Triage warnings — they're judgment calls.

**`data_model_ownership_conflict` (warning).** Fired when an entity is described as account-less / global / shared / ownerless but carries a *required, non-nullable* owner reference (`account_id`, `owner_id`, etc.). This is the latent contradiction behind the field's worst Phase-12 surprise: "library scenarios are account-less" coexisting with an `account_id NOT NULL` column, undetected from Phase 8 until parallel coders each invent an incompatible representation. When synthesizing `data_model.entities[]`, if a story or AC calls an entity "account-less" / "global" / "shared", its owner reference MUST be nullable (or absent). Resolve the contradiction in the spec — and pin the agreed shape in the plan's `shared_artifacts[].canonical_representation` — before Phase 12.

### 4. Spec Critic

Dispatch `agents/spec-critic.md` once `validate-spec.js` passes. The critic reads the rendered `spec.json` and reports `OK` or `NEEDS_REVISION`. If the latter, apply fixes flagged `critical` or `high` and regenerate the affected sections (lift sections almost never need critic-driven changes; synthesis sections frequently do).

Then archive: `cp spec.json spec-v{N}.json`, append a version entry to `spec-versions.json` per `spec-versioning.md`. Comment server starts at this point.

## Common pitfalls

- **Generating before Phase 8 mock approval.** `epic.design_direction.shell_summary` is read by the lift step; if it's empty, the design system in the spec is hollow. Block on Phase 9 gate.
- **Synthesizing before ADRs are written.** `architecture.components` infers technology from decisions; missing decisions produce hand-wavy components that the critic will reject.
- **Treating spikes as features.** They lift through `stories[]` *and* `spike_findings[]`. Don't deduplicate.
- **Inventing an upstream slot.** If a critic finding implies "the spec needs X but no upstream stores X," propose the new field for `epic-schema.json` — don't write a sidecar markdown file. See SKILL.md rationalization table.
