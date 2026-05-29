# Plan Assembly — Phase 11 Algorithm

This document is the procedural companion to `references/plan-schema.json` and the Plan Critic. Phase 11 is run by an LLM agent in the main session; this is the algorithm it follows.

There is intentionally no `generate-plan.js` script. The wave-DAG layering, parallel-group grouping, and critical-path derivation are not so subtle that they need real code, and an LLM-driven assembler can integrate the cohesion judgments (which a script would have to encode badly) cleanly.

## Inputs

- `<epic-dir>/spec.json` — approved spec (lifted into the plan)
- `<epic-dir>/state.json` — `stories[]` with `dependencies`, `priority`, `repo`, `complexity`, `has_mock`, `mock_path`, `touches_registry_files` (when present)
- `<project-dir>/repos.json` — testing config + (if present) `conventions` and `regenerate_commands`
- `<epic-dir>/comments.json` (if any) — only relevant for amendment regeneration

## Output

`<epic-dir>/plan.json` conforming to `references/plan-schema.json` and passing `scripts/validate-plan.js plan.json spec.json state.json`.

## Pseudocode

```
stories = state.stories.filter(s => s.status not in ["cancelled", "deferred"])
dep_graph = build_dependency_graph(stories)
waves = wave_dag_layering(stories, dep_graph)            // see "Wave-DAG layering"
for each wave:
  wave.shared_artifacts = reconcile_shared_concepts(wave.stories, spec)  // see "Shared-artifact reconciliation"
  pgs = parallel_group_within(wave.stories, wave.shared_artifacts)       // see "Parallel-group grouping"
  wave.parallel_groups = pgs
  wave.shared_registry_files = registry_files_touched(wave.stories)
  wave.end_of_wave_actions = end_of_wave_actions_for(wave, repos.json)
  wave.user_journeys = synthesize_journeys(wave.stories) // by-AC walkthrough
plan.waves = order_by_dependency(waves)
plan.critical_path = longest_chain(dep_graph)
plan.parallel_strategy = configure_parallelism(waves, repos.json)
plan.risks = lift(spec.risks)
plan.preflight_requirements = lift(spec.preflight_requirements ?? [])
write_state(stories with wave + parallel_group set)      // single source of truth: state.json
validate_plan(plan, spec, state)
dispatch(plan_critic, plan)
if critic.NEEDS_REVISION: apply_critical_fixes; regenerate
write(plan.json); render(plan.html); start(comment-server, /plan)
```

## Step details

### Wave-DAG layering (Kahn topological layering)

```
in_degree = map of story → count of unsatisfied dependencies
ready = stories with in_degree == 0
waves = []
while ready is non-empty:
  layer = ready
  waves.push(layer)
  for each story s in layer:
    for each story t that depends on s:
      decrement in_degree[t]
      if in_degree[t] == 0: add t to next_ready
  ready = next_ready
if any story remains: cycle — bail with concrete cycle path
```

Per-layer parallelizability check: if a layer is too wide (e.g. 25+ stories) and the user has limited concurrency, split it into sub-waves along repo or theme boundaries — but never break dependencies. Width limit is a soft heuristic; correctness (deps satisfied) is hard.

**Convergence-cost heuristic (soft).** Wave grouping optimizes for dependency-correctness and parallelizability — but a third axis matters: *convergence cost*. When many stories in a layer share a registry file or an about-to-be-created `shared_artifacts[]` entry, the expensive part isn't coding — it's reconciling parallel work afterward. Empirically, a wave of N independent services costs near-zero reconciliation; a wave of N stories all converging on one schema file + shared models can cost more than several independent waves combined. So when a layer's stories heavily converge:

- prefer a small **blocking foundation sub-group** that lands the shared surface first (the `shared_artifacts[]` owners, the schema, the base classes),
- then fan out the leaf stories against the now-stable base.

Resist max-width fan-out exactly where it's most tempting — "13 stories in one wave all touching `schema/query.rb`" is the case where parallelism looks like the biggest win and is actually the biggest cost. A two-step (foundation then leaves) layout almost always beats one wide blast there.

### Parallel-group grouping within a wave

Inputs: `wave.stories`, each with `repo`, declared `file_paths` (synthesized from acceptance criteria + DOD), declared `touches_registry_files` (from D2 — `references/story-schema.json`), and `complexity`.

```
pgs = []
unassigned = wave.stories
while unassigned is non-empty:
  seed = pop highest-priority unassigned story
  pg = [seed]
  for each candidate in unassigned:
    if files_conflict(pg.union_files, candidate.files - candidate.touches_registry_files):
      skip                                    // registry files are excluded — handled at end-of-wave
    if cohesion_score(pg, candidate) < threshold: skip
    pg.append(candidate); remove from unassigned
  pgs.push(pg)
```

`files_conflict(A, B)` = exact-path intersection of normal files. **Registry files are not counted** as conflicts — they're append-targets that an end-of-wave action reconciles (see D3). Code-level conflicts on registry files would otherwise force every story that touches them into a serial wave, which collapses parallelism.

`cohesion_score` is fuzzy: same-repo, same-theme, sibling stories, similar complexity all raise it. The LLM doing this step can pick the threshold on the fly — the Plan Critic will flag groups that are too thin or too wide.

**Intra-group read-after-write is forbidden (G1).** In Phase A, all coders in a group generate patches in parallel from the same `base_sha` — so a story CANNOT read a sibling story's not-yet-generated code. If story B's implementation needs to read code that story A creates, A is a dependency of B and MUST land first: put A in an earlier (blocking) group, or pin the shared surface in `shared_artifacts[]` with A as `owner_story`. Never co-locate a true source dependency and its dependent in the same non-blocking group — the dependent will see `base_sha` without A's code and either fail or invent a divergent version.

**The owner of any `shared_artifacts[]` entry goes in a `blocking: true` group** (along with migration stories). The orchestrator runs blocking groups to completion before non-blocking groups dispatch, so the shared surface (models, base classes, enums, schema) exists before the leaf stories that consume it.

### Shared-artifact reconciliation

This is the highest-leverage step for avoiding parallel-execution waste. Before grouping, scan the wave's stories for **shared concepts that don't yet exist**: a model/type/enum/base-class/factory that ≥2 stories reference, or — worst — a domain noun two stories would represent differently. For each:

1. Pick exactly one `owner_story` to create it (prefer the story whose core purpose *is* that artifact; otherwise the earliest/simplest). Everyone else becomes `reused_by`.
2. Pin `canonical_representation` — the agreed shape, resolved now. This is where a contested domain noun gets settled (e.g. "library scenario: account-less, identified by a `draft_graph` flag, NO `account_id`"). Cross-check against the spec's `data_model` — if the spec is silent or self-contradictory (see `validate-spec.js` `data_model_ownership_conflict`), that's a spec gap to resolve *before* the plan ships, not a planning decision to invent here.
3. Emit the entry into `wave.shared_artifacts[]` and place `owner_story` in a blocking group.

`validate-plan.js` flags `unreconciled_reference` (a namespaced ref ≥2 stories mention that no artifact declares) as a warning, and checks manifest consistency (owner exists, no reuser precedes its owner) as errors. The Plan Critic makes the semantic judgment (are two representations actually incompatible?). Resolve here, in the plan — never let parallel coders each invent a version.

### Critical path derivation

Longest path in the dependency DAG. Standard topological-order DP:

```
distance = map of story → 1
for s in topo_order(dep_graph):
  for t in s.dependents:
    distance[t] = max(distance[t], distance[s] + 1)
critical_path = trace back from argmax(distance) following the predecessor that produced the max
```

Each entry in `plan.critical_path` records `story_id`, `wave`, and `reason` (why it's critical — usually "blocks N downstream stories" or "longest single chain").

### Conflict-safe `file_paths` aggregation

Per-task `file_paths` (per `plan-schema.json` `tasks[].file_paths`) lists all files the task expects to touch — except files declared on the story's `touches_registry_files`, which roll up to `wave.shared_registry_files[]` instead. The `file_conflict` rule in `validate-plan.js` checks parallel-group exclusivity on the per-task list; the registry list is intentionally exempt.

### End-of-wave action synthesis

For each wave, compile `end_of_wave_actions[]` from:

1. Repo-level invariants — when `repos.json[].regenerate_commands` declares e.g. `graphql_schema`, every wave whose stories touch GraphQL definitions gets that command (run in the wave worktree, commit with `End-of-wave: regenerate graphql_schema`).
2. Wave-level merges — for each entry in `wave.shared_registry_files[]` with `kind: "merge"`, add the merge action.

`agents/orchestrator.md` and `references/execution-protocol.md` describe execution; this assembly step decides *what* belongs in the action list.

### User journey synthesis

For each wave with at least one user-facing story, synthesize 1–N journeys. Each journey covers a coherent end-user flow that exercises stories in this wave only (referenced via `stories_covered`). Steps use the `chrome_mcp` action enum (`references/story-schema.json` `$defs.chromeMcpStep` and `plan-schema.json` `user_journeys.steps[]` — kept in sync).

Backend-only waves may have zero journeys; the UAT gate then reports `pass` trivially. The Plan Critic flags waves that *should* have journeys but don't (anything with `has_mock: true`).

## Validation

```
node scripts/validate-plan.js <plan.json> <spec.json> <state.json>
```

Exit 0 advances. Categories:

- **schema** — JSON Schema violations.
- **semantic** — story coverage, phantom stories, wave DAG, task DAG, file conflicts, demo coverage, risk linkage, task `story_ref`, journey story coverage, **wave assignment** (state.json vs plan placement).

The wave-assignment check requires the optional state.json argument and is the canonical safeguard against state/plan drift (see `references/state-machine.md`).

## Plan Critic

Dispatch `agents/plan-critic.md` after `validate-plan.js` passes. The critic checks for:

- File conflicts the schema can't see (e.g. registry files declared by one story but touched implicitly by another)
- Missing infrastructure (a wave needs a service the plan doesn't start)
- Unrealistic breakdowns (one wave with 40 stories, or a wave with one story that takes 4 days)
- Ordering issues (a story depends on something that should be in an earlier wave but isn't)
- Missing `end_of_wave_actions[]` when the wave touches files repos.json marks as needing regeneration
- Missing or thin user journeys for visual stories

If critic returns `NEEDS_REVISION`, fix critical/high findings and regenerate the affected sections.

## Common pitfalls

- **Trusting plan.json over state.json for `story.wave`.** State is the source of truth (see `state-machine.md`). Run `validate-plan.js` with the state.json arg before plan approval.
- **Letting parallel groups straddle repos.** Cross-repo stories have already been split during Phase 8; if a group spans repos, you've put a coordination step in the wrong place.
- **Forgetting registry files.** A story that appends to `app/graphql/schema/query.rb` belongs in `touches_registry_files`, not `file_paths`. Otherwise every same-wave sibling forces a serial wave.
- **Critical path of length 1.** That means the plan thinks every story is independent — nearly always wrong. Re-check dependencies in state.json.
- **Empty `user_journeys[]` on visual waves.** UX gate has nothing to walk; the gate will pass trivially and miss real bugs. Always synthesize at least one journey per visual wave.
