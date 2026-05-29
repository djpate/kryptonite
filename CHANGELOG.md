# Changelog

## 0.9.0 — Phase-12 Speed: One Pipeline, Cheaper Fix Loop

Phase 12 was "hours per wave." This release simplifies and speeds it without weakening a single gate. The biggest speed lever — reducing how *often* a wave hits the fix loop — already shipped in 0.8.0 (pre-dispatch reconciliation via `shared_artifacts[]`); this release assumes that lever and attacks the structural and per-iteration costs around it.

**One pipeline (the structural win).** Phase A splits into A1 (parallel patch generation) and A2 (serial apply). A1 coders work in throwaway detached checkouts — write-only, no container, no DB — so code generation fans out in parallel even in `single_mounted_serial` mode, where only *verification* actually needs the serial mount. A2 applies each patch onto the mount with `git am --3way` in deterministic plan order. The two execution modes collapse into one pipeline with a single `apply_target` switch; `single_mounted_serial` loses its codegen penalty entirely. Gates in Phase B still run against a bit-identical integrated artifact — zero correctness change. The primary value is *simplification*; the speed payoff (~35–40%) lands on clean/wide waves.

**Cheaper fix loop.** The orchestrator fixes trivial gate issues inline on the mount instead of cold-starting a coder; service restarts are batched once per attempt (health-checked before any gate); and on subsequent attempts code_review runs against the incremental fix diff only. **UAT, UX, and spec-compliance always re-run full** against the integrated system.

**UX gate parallelism (safe rider).** The UX gate runs its per-story compares in parallel — each is a read-only render+screenshot+diff with no shared-DB-write surface.

**Honest ceiling.** On a wave that loops, the serial verify floor dominates and the codegen win is bounded — that floor is correctness-load-bearing and stays. The real looping-wave lever is upstream (fewer failures via reconciliation), not faster verification.

**Explicitly rejected** (after dedicated adversarial investigation): parallel UAT journey walks (write-dominated journeys against the shared test DB → false-pass at the firewall gate, reintroducing the IDOR/factory-collapse footgun) and parallel fix-coders (failures cluster on shared surface, so genuine independence is rare, and the claimed safety required a full re-verify the protocol forbids). See `docs/superpowers/plans/2026-05-29-phase12-speed.md`.

**Guardrails.** Intra-group read-after-write is forbidden (a true source dependency goes in an earlier blocking group — G1); detached checkouts are orphan-tracked like worktrees (G2); a patch-conflict re-dispatch is a Phase A retry, not counted against `max_fix_attempts` (G3). The `git am --3way` apply distinguishes true merge conflicts (route to rebase mode) from other apply failures (plain error). Verified against all 10 orchestrator invariants — invariants 5 and 10 (no services in worktrees / no concurrent test-DB migration) are structurally eliminated, since parallelism moved to a phase that never opens a service or the DB.

**Migration:** non-breaking, no epic data migration. New `worktree-manager.js` functions (`createDetachedCheckout`, `applyPatch`) covered by `worktree-manager.test.js` (5 tests).

## 0.8.0 — Phase-12 Execution Hardening

Closes the live-execution findings (#9–#20) from running waves 0–6 of a real 91-story epic through Phase 12. The wave-gate model and adversarial critics caught 100% of cross-story breakage that Coder self-reports missed — that part works. Every gap this release addresses is *upstream of the gates, within Phase 12*: no pre-dispatch reconciliation of shared concepts, no hard signal when a Coder invents an unspecified representation, a worktree model that breaks in single-mounted-container dev envs, and DOD commands carrying unverified environment assumptions.

This release ships **mechanisms** (schema slots, protocol steps, agent rules). Project-specific **values** — the kmsat/modstore3 commands, factory traps, execution-mode declarations — live in that project's `repos.json` under the plugin data dir and are not part of the skill.

### What was wrong

- **No pre-dispatch reconciliation of shared concepts (the big one).** File-conflict detection catches two stories writing the *same path*. It does not catch two stories that share a *concept*: a model neither has created, a type both define, or — worst — a domain noun two stories represent incompatibly (one story modeled "library scenario" as account-less; another pinned it to an `account_id NOT NULL` column; mutations wrote rows the queries could never find). ~45 of 60 failures in the worst wave traced to this.
- **"I invented a representation" wasn't a stop signal.** Coders reported *"no marker exists in the repo; I invented one"* as `DONE_WITH_CONCERNS` and proceeded — the highest-value signal in the run, escaping to the most expensive place to discover it.
- **Worktree-per-story is incompatible with single-mounted-container dev envs.** When the env mounts only the main worktree into a container, sibling-worktree code is invisible to `docker exec` and can't be tested.
- **Shared test DB raced under parallel coders**, and full-wave spec runs were the biggest wall-clock sink.
- **Self-reports were systematically optimistic** under parallelism — isolation hides exactly the cross-story bugs that matter.
- **DOD commands encoded unverified environment assumptions** (`pnpm build` against a running dev server, naive schema dumps that come back empty, bare `bundle exec rspec` in a container lacking private deps, `grep skip_policy!` matching comments) — discovered at gate time, across many stories at once.

### What changed

**Pre-wave reconciliation — `shared_artifacts[]` (the centerpiece).**
- New `plan-schema.json` `waves[].shared_artifacts[]`: each entry pins a model / graphql_type / graphql_enum / factory / base_class / migration that ≥2 stories reference but doesn't yet exist. Fields: `name`, `kind`, `owner_story` (the single creator), `reused_by[]`, `canonical_representation` (the agreed shape — where a contested domain noun is settled), `repo`.
- The owner is placed in a **blocking** parallel group so the shared surface lands before its consumers fan out.
- `validate-plan.js` enforces manifest consistency (owner exists; no reuser precedes its owner) as **errors**, and emits an `unreconciled_reference` **warning** when a namespaced ref (`Foo::Bar`) appears across ≥2 stories with no owning artifact. Single-story refs are skipped (likely external deps).
- `plan-critic.md` gains a shared-concept reconciliation dimension — the semantic judgment ("are these two representations actually incompatible?") the mechanical check can't make. By design there is **no hard Phase-11.5 gate**: "two stories share a concept" isn't mechanically detectable, so a gate would pass on a lie.

**"I invented a representation" is now a hard halt (`coder.md`).** If a Coder must invent a persistence/representation/identity/schema shape the spec didn't define, that's a mandatory `NEEDS_CONTEXT` halt — never `DONE_WITH_CONCERNS`. The orchestrator pauses the wave, resolves it in the spec / `shared_artifacts[].canonical_representation`, then re-dispatches. New orchestrator escalation row.

**Data-model consistency catch (`validate-spec.js`).** New `data_model_ownership_conflict` warning: an entity described "account-less / global / shared" that carries a required, non-nullable owner reference. The cheap pre-code catch for the contradiction that otherwise stays latent from Phase 8 to parallel Phase-12.

**Execution modes (`repos.json[].execution_mode`).** `worktree_parallel` (default, existing behavior) | `single_mounted_serial` (work on the main mounted worktree, sequential commits, serial verification). `execution-protocol.md` documents both; the wave/story state machine is identical. A wave spanning mixed-mode repos falls to the safe subset.

**Shared test DB + serial verification (`execution-protocol.md`).** Phase A provisions the shared test DB **once** before dispatch (new `conventions.test_db_setup` slot) — never letting parallel coders race the migrate. The Phase B fix loop verifies **per-changed-file, serially** — never the full wave suite (biggest wall-clock sink; also cuts shared-DB contention).

**Report tightening (`coder.md`).** Worktree-mode reports MUST set `tests_run` to `"none (worktree mode)"` and MUST NOT assert specs pass / rubocop clean. The wave gate is the sole source of truth.

**Blocking-group ordering.** `parallel_groups[].blocking` (already in the schema) is now honored in the protocol: blocking groups run to completion and merge before non-blocking groups dispatch. Two new orchestrator invariants enforce it.

**Conventions slots for environment-assumption classes (`repos-schema.json`).** New optional `conventions` slots — `schema_introspection_command`, `compile_gate_command`, `test_db_setup`, `test_data_gotchas[]`, `grep_gotchas[]` — plus a container-qualified `test_runner.*.invocation` guidance note. The Phase 7.5 principle is stated loudly in `SKILL.md` and `interviewer.md`: **DOD commands encode environment assumptions that must be verified against the live repo in Phase 7.5, not discovered at gate time.**

**Convergence-cost wave-sizing (`plan-assembly.md`).** A soft Phase-11 heuristic: when many stories converge on a registry file or a to-be-created shared artifact, prefer a small blocking foundation sub-group then fan out the leaves — resist max-width fan-out exactly where it's most tempting and most expensive.

### Project-side (not in this release)

These are populated in the kmsat/modstore3 `repos.json` using the slots above; they are not skill commits: the `single_mounted_serial` declarations, the real test-DB provision command, `nuxt prepare` as modstore3's compile gate, the scoped schema-introspection command, the container-qualified rspec invocation, the anchored `^\s*skip_policy!` grep, and the `create(:owner)` factory-collapse gotcha.

### New behavior, no new files

No new schema or gate files — 0.8.0 is additive optional fields plus validator/doc/agent changes. `validate-plan.js` and `validate-spec.js` outputs gain a `warnings` array (exit code unchanged).

### Migration from 0.7.0

Non-breaking. 0.7.0 epics resume cleanly; all new fields are optional and the new heuristic checks are warnings. To adopt: bump `kryptonite_version` to `0.8.0`; set `execution_mode` where worktrees can't be tested; fill the new `conventions` slots during Phase 7.5; populate `shared_artifacts[]` during Phase 11 for waves with shared not-yet-existing surface.

## 0.7.0 — Field Feedback Pass

Closes the items surfaced by a real 91-story two-repo epic running through Phases 8→11 (`kryptonite-feedback.md`). Schema bugs are fixed, the chrome_mcp vocabulary catches up to what real UAT/UX work actually needs, and three execution-model concepts the previous shape didn't have first-class support for — repo conventions, shared registry files, end-of-wave actions, and human-gated preflight requirements — are now part of the schema and the orchestrator loop.

### What was wrong

- **Schema-vs-gate inconsistency.** `has_mock` was required by Phase 10 but optional with `default: false` in Phase 8 and the global story schema, so 74 of 91 stories cleared Phase 8 and failed Phase 10 on a defaulted boolean. Designer agent emitted `direction_notes`; schema only accepted `design_notes`.
- **Party-id pattern collision.** `spec-schema.json` enforced kebab-case on `parties[].id`, but Phase 4 captured underscore-style names (`account_admin`, `knowbe4_staff`). Spec generation was forced into an undocumented remap.
- **chrome_mcp vocabulary too thin.** Story- and plan-schema enums were diverged copies; neither covered `wait_for`, `assert_not_visible`, `resize_page`, `assert_attribute`, or `evaluate_script`. US-072 (a min-viewport gate) was *unexpressible*. Step `additionalProperties: false` blocked agents from including readability keys (`description`, `note`).
- **No repo grounding.** Agents authored DODs against unverified assumptions about app-root, test runner, and namespace layout — wrong assumptions cost ~280 agent runs in the field.
- **No first-class shared-file concept.** Many stories must each append to single registry files (GraphQL `query.rb`/`mutation.rb`, `dropkik.yml`, locale catalogs, `SideNav.vue`). The plan's exact-path conflict check forced them serial; reactive merge was fragile.
- **End-of-wave hook gap.** The plan implied codegen/manifest-merge between waves, but `execution-protocol.md` only described reactive per-story merge.
- **Human-gated preflight had no home.** Bedrock model access, LaunchDarkly flag creation, etc. lived as a stretch in `risks[]`.
- **No state↔plan cross-check.** `story.wave` lived in both `state.json` and (implicitly) in `plan.waves[].parallel_groups[].stories`, with no validator step to confirm they agreed.

### What changed

**Schema bug fixes.**
- `has_mock` is now required everywhere — `story-schema.json` top-level `required[]`, Phase 8 gate, Phase 10 gate. Authoring (interviewer + designer) sets it explicitly. Phase 8 gate keeps the conditional `if has_mock then mock_phase + mock_approved` block.
- `spec-schema.json` `parties[].id` pattern relaxed to `^[a-z][a-z0-9_-]*$`. Whatever shape Phase 4 captures passes through verbatim — no remap, just consistency.
- `agents/designer.md` Report Format emits `design_notes` (matches schema).

**chrome_mcp harmonized and widened.**
- Single source-of-truth: `story-schema.json` `$defs.chromeMcpStep`. `plan-schema.json` `user_journeys.steps[]` mirrors the shape (kept in sync).
- New action enum: `navigate, click, fill, wait, wait_for, assert_text, assert_count, assert_visible, assert_not_visible, assert_url, assert_attribute, screenshot, resize_page, evaluate_script`.
- Steps allow optional `description` / `note` for readability; runner ignores them.
- `wave-uat-agent.md` updated with the full action list and per-action keys.
- `command` field in `story-schema.json` documents the string-OR-array contract per `method` (curl/test_suite/file_exists → string; chrome_mcp → array of step objects). Cross-linked from `agents/interviewer.md` Phase 8 DOD authoring.

**Phase 7.5 — Repo Conventions Preflight.** New phase between 7 and 8.
- `repos-schema.json` gains a `conventions` slot: `app_root`, `test_runner.{backend,frontend,e2e}`, `directory_layout`, `assertion_shapes`, `verified_at`. Populated by *reading the repo*, not asking the user.
- `skills/repos` auto-detect step extended to seed conventions defaults from `Dockerfile`, `docker-compose.yml`, `package.json`, `Gemfile`, and a directory scan. User confirms.
- New gate: `scripts/phase-gates/07_5.json` (base) + `07_5.0.7.0.json` (supplement) — pre-0.7.0 epics skip the supplement.
- `validate-gate.js` now accepts fractional `--phase` (e.g. `--phase 7.5` → `07_5.json`).
- `agents/coder.md` adds a "Before you write" check requiring `conventions` consultation before generating file paths or test invocations; refuses to write if a slot it needs is missing (reports `NEEDS_CONTEXT`).

**Shared registry files first-class.**
- `plan-schema.json` `waves[].shared_registry_files[]` — `path`, `repo`, `kind` (append/merge/regenerate), `merge_strategy`, `regenerated_by`, `stories[]`. Excluded from per-task file-conflict detection.
- `story-schema.json` `stories[].touches_registry_files[]` — array of registry file paths a story touches.

**End-of-wave hook (explicit model).**
- `plan-schema.json` `waves[].end_of_wave_actions[]` — `name`, `command`, optional `repo`, `run_in: wave_worktree | main_worktree`.
- `repos-schema.json` `repos[].regenerate_commands` — named map (`graphql_schema`, `db_schema`, …) so end-of-wave actions reference repo-level invariants by name.
- `references/execution-protocol.md` Phase A gains step 4.5: after all story merges, run end-of-wave actions in the wave worktree, commit `End-of-wave: <name>`. Failure → `wave.status = blocked`, no fix loop (infrastructure-class).
- `agents/orchestrator.md` escalation table updated.

**Preflight requirements.**
- `plan-schema.json` `preflight_requirements[]` — `id` (PREFLIGHT-NNN), `description`, `kind`, `owner`, `verification` (using DOD methods), `blocks_waves[]`, optional `documentation_url` and `notes`. Lifted into `spec-schema.json` for visibility.
- `references/execution-protocol.md` Phase B gains step 0: run verification for any preflight requirement blocking this wave; failing verification → `wave.status = blocked`, no fix loop.
- `agents/orchestrator.md` escalation table updated.

**Wave-assignment cross-check.**
- `scripts/validate-plan.js` accepts an optional third argument `<state.json>`. When provided, asserts `state.json.stories[s].wave === plan.waves[N].sequence` for every story `s` in `plan.waves[N].parallel_groups[*].stories`.
- `references/state-machine.md` declares `state.json` the source of truth for `story.wave`.

**Spec/plan generation framing.**
- `references/spec-versioning.md` reframes Phase 10 inputs as **lift sections** (1:1 upstream slot — parties, ADRs, NFRs, design system, stories, spike findings, risks, preflight requirements, scope evolution) and **synthesis sections** (`architecture.components`, `architecture.interactions`, `data_model.entities`, `api_boundaries` — derived from stories + ADRs by parallel subagents).
- New `references/spec-assembly.md` — pseudocode for Phase 10 (lift order, party-id passthrough, OQ→story mapping, synthesis-section subagent dispatch, Spec Critic loop).
- New `references/plan-assembly.md` — pseudocode for Phase 11 (Kahn topological wave-DAG layering, parallel-group grouping with registry-file exclusion, critical-path derivation, conflict-safe `file_paths` aggregation, Plan Critic loop). Intentionally no `generate-spec.js` / `generate-plan.js` — Phase 10/11 are LLM-driven.

**Slim views.** All fan-out agents (`coder`, `wave-uat-agent`, `wave-ux-agent`, `wave-spec-compliance-agent`, `wave-code-review-agent`) now explicitly call out that they receive scoped subsets — not whole `state.json` / `plan.json` (which routinely exceed 700KB on 90+-story epics, well above the 512KB subagent prompt cap).

### Out of scope (already fixed)

The original feedback's "Bug 1 — story-schema rejects mock fields" was fixed in 0.6.0. The four mock fields (`mock_path`, `mock_options`, `mock_choice`, `design_notes`) are already declared in `story-schema.json`.

### New files

- `skills/kryptonite/references/spec-assembly.md`
- `skills/kryptonite/references/plan-assembly.md`
- `skills/kryptonite/scripts/phase-gates/07_5.json`
- `skills/kryptonite/scripts/phase-gates/07_5.0.7.0.json`

### Migration from 0.6.0

Non-breaking. 0.6.0 epics resume cleanly. The new gates and schema additions only apply to epics with `kryptonite_version >= 0.7.0`.

To bring a 0.6.0 epic onto 0.7.0:

1. Bump `epic.json.kryptonite_version` to `0.7.0`.
2. Run Phase 7.5: populate `repos.json[].conventions` for every repo this epic references. Read the repo (Dockerfile, docker-compose, package.json/Gemfile, directory scan) — don't ask the user, except to confirm.
3. If your project has registry/aggregator files, declare them per-story (`touches_registry_files[]`) and per-wave (`shared_registry_files[]`).
4. If your project has codegen (GraphQL schema, db schema), declare `repos[].regenerate_commands` and reference them from `plan.waves[].end_of_wave_actions[]`.
5. If your project has human-gated prerequisites (Bedrock access, LaunchDarkly flags), move them from `plan.risks[]` (where they were a stretch) into `plan.preflight_requirements[]` with a real verification check.
6. If your designer agent emitted `direction_notes` in pre-0.7.0 `state.json`, rename to `design_notes`.

## 0.6.0 — Structured Phase 3 / 6 / 7 / 8 Outputs

Closes a long-standing leak where conversational phases produced load-bearing content with no structured slot in `epic.json`. The interviewer was compensating by writing sidecar markdown (`gap_analysis.md`, `rescope.md`, `technical_guidance.md`), which the phase gates accepted (because they only checked trivial fields), the spec generator couldn't consume, and resume couldn't recover. Phase 3 ADRs, Phase 6 scope deltas, Phase 7 technical context, and the Phase 8 design system summary now have real schemas and real gates.

### What was wrong

Phases 3, 6, 7, and 8 each produce substantial output during the interview. Before 0.6.0:

- **Phase 3 gap-probe resolutions** had no slot. The spec generator (Phase 10) re-synthesized `architecture.decisions[]` and `open_questions[]` from chat history every time, even though `spec-schema.json` defined those exact fields.
- **Phase 6 scope deltas** after spike findings had no slot. `rescope.md` was the de-facto store.
- **Phase 7 technical context** was a free-form `object` validated only by `minProperties: 1` — anything passed.
- **Phase 8 design system summary** was nominally tracked under `design_direction.shell_summary` but was free-form prose, not a structured object detail-mock Designers could inherit deterministically.

The pattern repeated across all four phases: interview captures real data → gate doesn't check for structure → schema has no slot → content lands in markdown sidecars → invisible to downstream phases → lost on resume.

### What changed

**New file: `references/epic-schema.json`** — defines the full `epic.json` shape including:
- `decisions[]` — Phase 3 ADRs (`ADR-001+`). Same shape as `spec-schema.json`'s `architecture.decisions[]`, plus `source_phase` and `related_stories[]` for traceability. Lifted verbatim into `spec.json` during Phase 10.
- `open_questions[]` — Phase 3 OQs (`OQ-001+`). Same shape as `spec-schema.json`'s `open_questions[]`, plus `source_phase`.
- `scope_history[]` — Phase 6 append-only delta log (trigger + added/removed/modified/deferred).
- `technical_context.{testing,non_functional,infrastructure,patterns}` — Phase 7 output, now structured. Each sub-object is independently optional but at least one must be populated.
- `design_direction.shell_summary` — Phase 8 visual DNA as a structured object (nav, header, layout, colors, typography, spacing, components). Required when `design_direction.locked === true`.

**Version-aware phase gates.** New supplemental gate files at `scripts/phase-gates/{03,06,07,08}.0.6.0.json` activate only when `epic.kryptonite_version >= 0.6.0`. The base gate files are unchanged, so 0.5.0 epics resume cleanly with no retroactive enforcement. `validate-gate.js` discovers version-suffixed schemas dynamically and labels their errors `SCHEMA (v0.6.0+)` so the source is obvious.

**Interviewer + SKILL.md updates.** `agents/interviewer.md` gains a "Structured outputs" table mapping each conversational phase to its `epic.json` slot, plus an explicit no-sidecar-markdown rule. `SKILL.md` Phase 3 / 6 / 7 / 8 sections name the structured slots; the Discipline rationalization table gains an entry forbidding sidecar markdown for load-bearing content (it's invisible to the spec generator and lost on resume).

**Phase 10 spec generator becomes a mapper, not a synthesizer.** `references/spec-versioning.md` documents the lift table from `epic.json` → `spec.json`. If the generator finds upstream slots empty, it bails with a Phase 3/7 gate failure — no fabrication.

### New files

- `skills/kryptonite/references/epic-schema.json`
- `skills/kryptonite/scripts/phase-gates/03.0.6.0.json`
- `skills/kryptonite/scripts/phase-gates/06.0.6.0.json`
- `skills/kryptonite/scripts/phase-gates/07.0.6.0.json`
- `skills/kryptonite/scripts/phase-gates/08.0.6.0.json`
- `skills/kryptonite/scripts/test-fixtures/project-0.6.0/` — passing 0.6.0 fixture as a long-term canary

### Modified files

- `skills/kryptonite/scripts/validate-gate.js` — loads version-suffixed supplemental gates on top of the base gate when the epic's version matches; preserves per-phase semantic checks
- `skills/kryptonite/agents/interviewer.md` — Structured outputs section, no-sidecar rule
- `skills/kryptonite/SKILL.md` — Phase 3 / 6 / 7 / 8 wording names the structured slots; rationalization table gains the sidecar-markdown entry
- `skills/kryptonite/references/storage-protocol.md` — points at `epic-schema.json` instead of inlining a (drifted) field list
- `skills/kryptonite/references/mocks-and-cross-repo.md` — fixes wrong `state.json` pointer; documents the structured `shell_summary` requirement
- `skills/kryptonite/references/spec-versioning.md` — Phase 10 generator inputs section with the `epic.json` → `spec.json` lift table
- `skills/kryptonite/references/schema-changelog.json` — 0.5.0 → 0.6.0 entry with the optional migration mapping
- `package.json` — 0.5.0 → 0.6.0
- `README.md` — version badge bumped, project-structure block surfaces the new structured `epic.json` fields

### Migration

**Non-breaking.** 0.5.0 epics resume cleanly. The new gates apply only to epics with `epic.kryptonite_version >= 0.6.0` — `validate-gate.js` keys off the per-epic version, not the installed plugin version.

**Optional 0.5.0 → 0.6.0 upgrade for an existing epic** (full step-by-step in `references/schema-changelog.json`):

1. Translate any `gap_analysis.md` resolutions into `epic.json.decisions[]` (ADRs) and `epic.json.open_questions[]` (OQs).
2. Translate any `rescope.md` into `epic.json.scope_history[]`.
3. Translate any `technical_guidance.md` into `epic.json.technical_context.{testing,non_functional,infrastructure,patterns}`.
4. If foundational mocks are approved, write the structured design system into `epic.json.design_direction.shell_summary`.
5. Bump `epic.json.kryptonite_version` to `"0.6.0"`.
6. Rename migrated sidecars to `*.legacy.md` so the interviewer doesn't re-read them as authoritative.

In-flight epics can also just finish on the 0.5.0 shape — no upgrade required.

---

## 0.5.0 — Skill Hygiene Pass

Tightens the skill itself — no protocol changes. SKILL.md is now ~250 lines instead of 900, agents have proper frontmatter, the rules that govern Phase 12 live in exactly one place, and the README finally matches the v2 wave-gate model.

### SKILL.md restructured for progressive disclosure

The old SKILL.md inlined the full storage layout, state machine, commit rules, and Phase 12 details — ~900 lines that the model loaded into context every time. That's now split into focused reference files loaded only when their phase or task arrives:

- `references/storage-protocol.md` — plugin-folder storage, project IDs, safe-write protocol, resume detection, legacy `.kryptonite/` migration
- `references/state-machine.md` — story/wave state machines, illegal transitions, invariants, per-story / per-wave tracked fields, commit rules
- `references/phase-gates.md` — `validate-gate.js` behavior and per-phase requirements
- `references/spec-versioning.md` — spec versioning, comment resolution, mid-execution amendments
- `references/mocks-and-cross-repo.md` — Phase 8 mock protocol (foundational sequential / detail parallel) and cross-repo auto-split rules
- `references/active-schema.json`, `references/registry-schema.json` — schemas for `active.json` and `registry.json`

SKILL.md now opens with a "References — load when relevant" table that maps phases/tasks to the file the model should pull in. Skill body is ~245 lines; full depth is still available, just not loaded upfront.

A "Discipline" rationalization table replaces several ALL-CAPS NEVERs — pairs the rationalization the model might have ("just prototype it", "Chrome MCP is down but I can read the source") with what's actually true, so it can reason about edge cases instead of mechanically following rules.

### Compressed run mode

The "Discipline" table promised an "offer a compressed run" path when users push back on phases ("I'm in a hurry", "skip the spec"). That's now defined: collapse Phases 1–3 into one turn, skip Phase 5 if no unknowns, accept sketch-level mocks — but keep DOD validation, schema gate, and wave gates intact, because those are the parts that make kryptonite different from "a plan". Dropping the gates is a different request that requires explicit user confirmation.

### Phase 12 single source of truth

The Phase 12 preconditions (Chrome MCP reachable, worktree support, `repos.json[].testing` block, `user_journeys[]` populated) and wave-loop rules used to live in three places — SKILL.md, `agents/orchestrator.md`, and `references/execution-protocol.md`. They drift in three places too. Promoted to `execution-protocol.md` exclusively; SKILL.md and the orchestrator now defer to it with a 2-line pointer.

### Coder agent

- `model: sonnet` → `model: opus`. Coding is the work the orchestrator gates on; pay for the better model.
- Removed the "follows TDD" line, which contradicted the next-paragraph instruction not to run tests in worktree mode. Replaced with a short explanation of why worktrees can't run tests (shared DB / services would race) and what the Coder actually does: write production code + a test file per AC, commit, let the wave gates validate after merge.

### Agent frontmatter

`designer.md`, `interviewer.md`, `plan-critic.md`, `researcher.md`, `spec-critic.md` now have proper YAML frontmatter (`name`, `description`, `model`) so they're discoverable as skills/agents. The orchestrator and interviewer instructions are also tightened — orchestrator drops duplicated rules and points at `execution-protocol.md` as the authority; interviewer is reframed for Phases 1–11 (was 1–8 in the old text) and updated for the Spec Critic / Plan Critic agents that were added in 0.4.0.

### Eval coverage expanded

`evals/evals.json` grows from 1 eval to 8, covering: happy-path Phases 1–7 walkthrough, Phase 3 gap analysis quality, Phase 8 DOD validation methods, Phase 8 vague-DOD rewrite under pressure, Phase 8 cross-repo split when the user pushes back on splitting, "just prototype it" pressure, the UAT-must-report-blocked-not-pass adversarial case (the one that caught the false-pass bug late in 0.4.0), and a full mini-app wave-0 execution. Most evals are pressure scenarios — the kind the rationalization table is meant to defend against.

### Repos skill (sub-skill) cleanup

`skills/repos/SKILL.md` updated to match the post-0.4.0 storage layout: `<skill-path-kryptonite>/data/{PROJECT}/repos.json` (project-level, not per-epic), references `repos-schema.json` as the on-disk source of truth (including the optional `testing` block consumed by wave-gate agents), and clarifies the auto-detection / project-init handoff with the kryptonite skill.

### README updated to match v2

The README's State Machine + Agent Architecture diagrams were still describing the 0.3.0 per-story QA → Reviewer → Code-Reviewer chain that 0.4.0 deleted. Replaced with the v2 wave-gate shape: per-story flow ending at `merged`, separate per-wave flow with the four parallel gate agents, and 4 invariants (was 6) reflecting what's actually enforced today. Project Structure block now shows `spec.json` / `plan.json` / `spec-versions.json` / `wave-N/gates/` instead of the old HTML files.

### Modified files

- `skills/kryptonite/SKILL.md` — refactored for progressive disclosure (~900 → ~250 lines)
- `skills/kryptonite/agents/coder.md` — model bumped, TDD wording fixed
- `skills/kryptonite/agents/orchestrator.md` — defers to `execution-protocol.md`, no rule duplication
- `skills/kryptonite/agents/interviewer.md` — frontmatter, Phases 1–11 (with Spec Critic / Plan Critic dispatching)
- `skills/kryptonite/agents/{designer,plan-critic,researcher,spec-critic}.md` — frontmatter added
- `skills/kryptonite/references/execution-protocol.md` — Phase 12 preconditions live here now
- `skills/kryptonite/references/wave-gate-report-schema.json` — minor schema fix
- `skills/kryptonite/evals/evals.json` — 8 evals (was 1), most pressure scenarios
- `skills/repos/SKILL.md` — aligned with project-level storage and `repos-schema.json`
- `README.md` — v2 state machine + agent architecture, updated project structure
- `package.json` — 0.4.0 → 0.5.0

### New files

- `skills/kryptonite/references/storage-protocol.md`
- `skills/kryptonite/references/state-machine.md`
- `skills/kryptonite/references/phase-gates.md`
- `skills/kryptonite/references/spec-versioning.md`
- `skills/kryptonite/references/mocks-and-cross-repo.md`
- `skills/kryptonite/references/active-schema.json`
- `skills/kryptonite/references/registry-schema.json`

### Migration

Nothing breaks for existing 0.4.0 projects — protocol is unchanged, only skill prompts and references moved around. State files (`spec.json`, `plan.json`, `state.json`, `repos.json`) and validators are untouched.

---

## 0.4.0 — Wave-Gate Execution + Structured Spec/Plan

**Breaking release.** Replaces freeform HTML spec/plan generation with validated JSON. Replaces per-story validation gates with a wave-level gate model. Drops the v0.3.0 protocol entirely — projects mid-execution under 0.3.0 cannot continue on 0.4.0 (finish them on 0.3.0 or restart Phase 12). See Migration below.

### Spec & plan are now JSON, not HTML

The LLM no longer authors `spec.html`/`plan.html` directly. It produces `spec.json` and `plan.json` validated by `references/spec-schema.json` and `references/plan-schema.json` (composed via `$ref` with the existing `story-schema.json`). The UI fetches the JSON via `/api/spec` and `/api/plan` and renders it client-side as Alpine.js SPAs.

- New schemas: `spec-schema.json`, `plan-schema.json`, `wave-gate-report-schema.json`, `repos-schema.json`
- New validators: `validate-spec.js`, `validate-plan.js` (schema layer + 9 spec semantic checks + 8 plan cross-validation checks against spec)
- New API endpoints: `GET /api/spec`, `GET /api/plan`, `GET /api/spec/schema`, `GET /api/plan/schema`
- New SPA pages: `scripts/ui/spec.html`, `scripts/ui/plan.html` — full dark-themed renderer with sidebar nav
- Detection mode: `comment-server.js` checks for `spec.json`/`plan.json` and serves the SPA; falls back to legacy HTML for v1 projects.
- Plan now contains `user_journeys[]` per wave (required) with structured Chrome MCP steps for UAT.
- Optional `wave_gate_config` lets you tune which gates run and how many fix attempts to allow.

### Phase 12 wave-gate execution (protocol v2)

Per-story QA / Reviewer / Code Reviewer gates are gone. They produced a serial bottleneck after every merge, and agents would give up under it. Replaced with four wave-level gate agents that run in parallel after the entire wave merges:

- **wave-uat-agent** — walks `user_journeys[]` via Chrome MCP
- **wave-ux-agent** — screenshots implementation vs approved mocks, compares
- **wave-spec-compliance-agent** — verifies each story's `acceptance_criteria` (catches what UAT doesn't exercise)
- **wave-code-review-agent** — full diff review (security, correctness, error handling, dead code, performance, style)

Story state machine simplified: `pending → in_progress → merged`, with `done` set retroactively when the wave completes. Wave statuses: `pending → in_progress → gates_running → complete | blocked`.

Adaptive retry replaces "give up after 3 attempts": same Coder + more context → Researcher + new Coder → pause for user. Only failed gates re-run after a fix; passed gates carry forward.

Service lifecycle is now driven by `repos.json[].testing` (`start_command`, `stop_command`, `health_check`, `app_url`, `ready_signal`). The plugin is infrastructure-agnostic — works with marengo, docker-compose, foreman, npm, anything.

### Gates cannot fake passing

This shipped late in the release after eval testing surfaced the issue. Gates have a third status: `blocked`. When Chrome MCP isn't reachable or a service won't start, UAT and UX must report `blocked` (not `pass`) — they cannot substitute code inspection or curl and call themselves passed. The orchestrator pauses the wave and surfaces the infrastructure issue to the user instead of entering the fix loop. Issue severity gains a `blocked` value alongside critical/high/medium/low.

The eval that caught this: with-skill agent ran Phase 12 against a fixture where Chrome MCP had a browser-profile lock; it reported all gates passing via "code inspection" and marked the wave complete on a lie. Iteration 2 with the new instructions correctly used Chrome MCP for real (12/12 assertions passed, including the new substitution detector).

### New files
- `agents/wave-uat-agent.md`, `agents/wave-ux-agent.md`, `agents/wave-spec-compliance-agent.md`, `agents/wave-code-review-agent.md`
- `references/spec-schema.json`, `references/plan-schema.json`, `references/wave-gate-report-schema.json`, `references/repos-schema.json`
- `scripts/validate-spec.js`, `scripts/validate-plan.js`, `scripts/validate-wave-gate-report.js`
- `scripts/worktree-manager.js` — create/remove/merge with conflict handling for wave + story branches
- `scripts/service-runner.js` — start/stop services per repos.json testing config
- `scripts/ui/spec.html`, `scripts/ui/plan.html` — Alpine.js SPA renderers

### Modified files
- `references/story-schema.json` — dropped `dod_validation`, `review_status`, `code_review_status`, `qa_status`; status enum now `pending|in_progress|merged|done|blocked|cancelled|deferred`; added `merged_at`
- `references/execution-protocol.md` — full rewrite for the wave-gate model
- `references/plan-schema.json` — added `waves[].user_journeys` (required) and `wave_gate_config` (optional)
- `agents/orchestrator.md` — full rewrite; explicit blocked-gate handling
- `scripts/comment-server.js` — added JSON API endpoints; `/spec` and `/plan` now serve only the Alpine.js SPAs
- `scripts/validate-gate.js` — Phase 12 check uses the new story status enum
- `scripts/phase-gates/10.json`, `11.json` — require `spec.json`/`plan.json`
- `SKILL.md` — Phase 12 section rewritten

### Removed
- `agents/qa.md`, `agents/reviewer.md`, `agents/code-reviewer.md` — per-story gates replaced by wave gates
- HTML mode in `comment-server.js` — `/spec` and `/plan` no longer serve `spec.html` / `plan.html`
- Legacy fallback in `validate-gate.js` — Phase 10/11 gates now require `spec.json`/`plan.json`
- `--spec-path` and `--plan-path` CLI flags on `comment-server.js` are accepted but ignored; `--state-path` is the only required argument

### Bug fixes
- `scripts/ui/assets/nav.html` — phase badge was reading the wrong field name (`currentPhase` → `current_phase`)

### Migration (BREAKING)

0.4.0 only supports the wave-gate execution model. Projects mid-execution under 0.3.0 will not run on 0.4.0 — finish them on 0.3.0 or restart Phase 12 under 0.4.0. There is no version-detection fallback.

**To upgrade a 0.3.0 project to 0.4.0:**

1. **Stories** — drop the per-story validation fields (`dod_validation`, `review_status`, `code_review_status`, `qa_status`, `test_results`) from `state.json` if present. Update any story with status `qa_validation`, `in_review`, or `code_review` to `merged` (or `in_progress` if work hadn't started). The new schema rejects the old values.
2. **Spec** — replace `spec.html` with `spec.json` validated by `references/spec-schema.json`. Run `node scripts/validate-spec.js spec.json` to confirm.
3. **Plan** — replace `plan.html` with `plan.json` validated by `references/plan-schema.json`. Add a `user_journeys[]` array to each wave (at least one journey per wave covering its stories) — the validator rejects waves without it. Run `node scripts/validate-plan.js plan.json spec.json` to confirm.
4. **Repos** — recommended: add a `testing` block to each repo in `repos.json` that needs a running service. Without it, UAT and UX gates skip for that repo (with warnings); spec compliance and code review still run.

**Fresh 0.4.0 projects** — nothing to do. Just describe what you want to build.

---

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
