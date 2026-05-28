# Phase Gate Validation

Every phase transition is gated by a code-based validator. Before incrementing `current_phase` in `epic.json`, you MUST run the gate. The point: state moves forward only when there's evidence it's consistent — no "good intentions" advances.

## How to validate

```bash
node <skill-path>/scripts/validate-gate.js --phase <N> --data-path <epic-dir>
```

Where `<N>` is the phase being **completed** (the current phase, not the next one).

## Validation Flow

1. Run the validator command
2. If exit code **0** → gate passes, increment `current_phase`
3. If exit code **1** → gate fails, read the error output:
   - Fix issues you can resolve (populate missing fields, add required data)
   - Ask the user for issues that require their input
   - Re-run the validator after fixes
   - Do NOT advance until exit code 0

## What the Validator Checks

Two layers:

1. **Schema validation** (AJV) — structural correctness of `epic.json`, `state.json`, `repos.json` against per-phase JSON Schema definitions in `scripts/phase-gates/`
2. **Semantic validation** — cross-reference integrity (party names, repo names), no circular dependencies, wave ordering correctness, required file existence (spike findings, `spec.html`, `plan.html`)

## Error Output Format

```
FAIL: Phase 8 gate failed with 3 error(s):

  ✗ SCHEMA /state/stories/5: must have required property 'definition_of_done'
  ✗ SEMANTIC stories[US-012].party: "viewer" not found in epic.json parties
  ✗ SEMANTIC dependencies: circular dependency detected: US-003 → US-007 → US-003
```

## On Resume

When resuming an epic, validate the gate for `current_phase - 1` to confirm state is consistent. If it fails, warn the user that state may be incomplete from a prior session and offer to repair before continuing.

## Version Compatibility

Each epic records its `kryptonite_version` at creation. When the validator warns about a version mismatch:
1. Check `references/schema-changelog.json` for what changed between the epic's version and the current version
2. Follow the `migration.steps` for each intermediate version to bring the epic's state up to date
3. The changelog lists every added/modified field, which file it belongs to, and what the safe default is

## Why hard gates

The state machine relies on invariants — "a story can't be in_progress until all its dependencies are merged or done", "a wave can't be complete while any gate is fail or blocked". The interviewer and the orchestrator are both LLM agents; without a code-based gate, drift between perceived state and actual state is inevitable. Validators are short, cheap, and catch the failures that would otherwise surface mid-execution as confusing branch states or missing files.
