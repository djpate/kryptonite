# Execution Findings & Resume Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Phase 12 a durable, schema-backed findings store in `epic.json`, agent-nomination + escalation capture, two-tier promotion into `repos.json` conventions, a resume digest that prints the handoff, and self-heal for two recurring bookkeeping gaps — so the user's resume prompt collapses to one line.

**Architecture:** Additive, non-breaking schema change shipped as kryptonite 0.10.0. The orchestrator (already the sole writer of `epic.json`/`state.json`) gains the curation, capture, promotion, self-heal, and digest behaviors as prose protocol in `references/*.md` and `agents/orchestrator.md`. Subagents gain an optional `candidate_findings[]` nomination channel. Validation follows the existing version-gated supplemental-gate pattern (`12.0.10.0.json` that `$ref`s into `epic-schema.json`). The live `readiness-v2` epic is migrated as the acceptance test.

**Tech Stack:** JSON Schema (draft 2020-12, AJV), Node.js (`node:test`), markdown protocol docs. No new runtime dependencies.

---

## Background for the implementer (read first)

You are working inside the **kryptonite** Claude Code plugin at
`/Users/christophev/.claude/plugins/kryptonite`. Kryptonite turns an idea into a spec, then a
plan, then drives multi-agent implementation across 12 "phases". **Phase 12** is execution: it
runs in "waves", each wave coding stories in parallel then validating them with four "gate"
subagents (UAT, UX, spec-compliance, code-review). The **orchestrator** (`agents/orchestrator.md`)
runs Phase 12 in the *main session* — it is NOT a subagent. It reads/writes `epic.json` and
`state.json`; subagents only *report* results, never write state. Keep that invariant.

**Data lives in the plugin folder**, never in user repos:
`skills/kryptonite/data/{PROJECT}/{EPIC}/` holds `epic.json` (durable metadata) and `state.json`
(execution state). `repos.json` is one level up at `data/{PROJECT}/repos.json` (shared across all
epics). The live epic for testing is at
`skills/kryptonite/data/7147a468863c/readiness-v2/`.

**Schema discipline (important):** Schema changes are versioned in
`skills/kryptonite/references/schema-changelog.json`. Phase gates live in
`skills/kryptonite/scripts/phase-gates/NN.json`; version-specific extra requirements go in a
*supplemental* gate `NN.<semver>.json` (e.g. `12.0.10.0.json`) which the validator
(`scripts/validate-gate.js`) applies *on top of* the base gate only when the epic's
`kryptonite_version >= <semver>`. Older epics are never held to newer requirements. The skill's
own "no sidecars" rule (`SKILL.md` Discipline table) says load-bearing content must live in a
schema slot — which is exactly why this feature formalizes the ad-hoc store.

**The problem this solves:** The orchestrator already invented an ad-hoc `state.json.deferred_findings[]`
(19 entries in the live epic) that exists in no schema. On resume, the user hand-types a long
"handoff prompt" carrying findings, repo rules, and bookkeeping warnings. This feature gives that
knowledge a home and makes the orchestrator print the handoff itself.

**Design doc:** `docs/superpowers/specs/2026-05-29-execution-findings-design.md` (read it; this
plan implements it).

### Verified facts about the current code (don't re-discover these)

- `references/epic-schema.json` has **no top-level `additionalProperties`** — adding a `findings`
  property is safe and existing extra keys already pass.
- `references/wave-gate-report-schema.json` **does** have top-level `additionalProperties: false`
  — so `candidate_findings` MUST be added as an explicit property or reports carrying it fail validation.
- `scripts/validate-gate.js` registers `epic-schema.json` via `ajv.addSchema(epicSchema, "epic-schema.json")`
  (line ~82) and validates a wrapper object `{ epic, state, repos }`. Supplemental gates already
  `$ref` into it: `06.0.6.0.json` uses `"$ref": "epic-schema.json#/properties/scope_history/items"`.
  Use that exact pattern.
- The validator discovers supplementals by filename prefix and applies them when
  `compareSemver(epicVersion, versionPart) >= 0`. It reads `epicVersion` from
  `epic.json.kryptonite_version`.
- The live `readiness-v2` `epic.json` is stamped `kryptonite_version: "0.6.0"` (stale — it already
  uses 0.8/0.9 features). Its top-level keys include an existing `ported_lessons_learned`. It does
  NOT yet have `findings`.
- Tests use `node:test` run via `node --test scripts/<file>.test.js` (see `worktree-manager.test.js`).
  There is no `npm test` script.
- `package.json` version is currently `0.9.0`.

---

## File Structure

**Schemas (data model):**
- Modify `references/epic-schema.json` — add top-level `findings[]`.
- Modify `references/wave-gate-report-schema.json` — add optional `candidate_findings[]`.

**Validation:**
- Create `scripts/phase-gates/12.0.10.0.json` — supplemental gate validating `findings[]` shape if present.
- Create `scripts/validate-gate.test.js` — tests for the supplemental gate (valid/invalid findings).

**Protocol docs (behavior — read by the orchestrator at runtime):**
- Modify `references/execution-protocol.md` — capture, curation, promotion, self-heal, digest sections.
- Modify `references/storage-protocol.md` — `findings[]` epic slot + resume-digest/self-heal in Resume Detection.
- Modify `references/state-machine.md` — one-line note that findings live in `epic.json`, not `state.json`.
- Modify `agents/orchestrator.md` — escalation auto-capture, curate-at-wave-complete, promotion step, tools note.
- Modify `agents/coder.md` — `CANDIDATE_FINDINGS:` report block.
- Modify `agents/wave-uat-agent.md`, `agents/wave-ux-agent.md`, `agents/wave-spec-compliance-agent.md`, `agents/wave-code-review-agent.md` — `candidate_findings[]` nomination.

**Versioning:**
- Modify `references/schema-changelog.json` — 0.10.0 entry.
- Modify `package.json` — bump to 0.10.0.
- Modify `SKILL.md` — Discipline table row pointing the deferred-findings urge at `findings[]`.

**Live-epic migration (acceptance test):**
- Modify `data/7147a468863c/readiness-v2/epic.json` — add migrated `findings[]`, bump version.
- Modify `data/7147a468863c/readiness-v2/state.json` — remove `deferred_findings[]`.
- Modify `data/7147a468863c/repos.json` — promote durable kmsat rules into `kmsat.conventions`.

> **Note on commits:** This plan edits files under `skills/kryptonite/...` which is a git repo
> (the plugin). Commit there. The live-epic `data/` files are also inside that repo, so migration
> commits land in the same repo. Use the commit messages given in each task.

---

## Task 1: Add `findings[]` to the epic schema

**Files:**
- Modify: `skills/kryptonite/references/epic-schema.json` (add a property after `design_direction`, which ends at the `"design_direction": { ... }` block closing before the top-level `"$defs"`).

- [ ] **Step 1: Add the `findings` property**

In `references/epic-schema.json`, the top-level `"properties"` object currently ends with the
`"design_direction"` block, immediately followed by the closing `}` of `properties` and then
`"$defs"`. Add `findings` as a new property right after the `design_direction` block's closing
`},` and before `properties`'s closing `}`.

Insert this (note the leading comma belongs to the preceding `design_direction` block — make sure
exactly one comma separates the two properties):

```json
    "findings": {
      "type": "array",
      "description": "Phase 12 execution discoveries. Agent-nominated, orchestrator-curated; escalations auto-capture. The durable home for what waves teach — replaces the ad-hoc state.deferred_findings[]. Resume builds its digest from this array. See references/execution-protocol.md (capture/curation/promotion) and references/storage-protocol.md (resume digest).",
      "items": {
        "type": "object",
        "required": ["id", "category", "audience", "wave_id", "summary", "resolution"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^WAVE\\d+-FINDING-\\d{3,}$",
            "description": "Stable id, scoped to the wave that produced the finding: WAVE<N>-FINDING-NNN."
          },
          "category": {
            "type": "string",
            "enum": ["process", "repo_gotcha", "spec_gap", "regression_risk", "deferred_defect"],
            "description": "process = fix-loop/infra lesson; repo_gotcha = runtime-discovered repo trap (promotion candidate); spec_gap = spec/plan ambiguity that forced a live decision (incl. NEEDS_CONTEXT); regression_risk = later waves must watch this (pairs with forward_to_waves); deferred_defect = a real defect intentionally deferred."
          },
          "audience": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "enum": ["orchestrator", "coder", "gate", "human"] },
            "description": "Who should read this on resume. The digest filters sections by audience."
          },
          "wave_id": { "type": "string", "pattern": "^wave-\\d+$" },
          "source": { "type": "string", "description": "Provenance, e.g. 'wave-6 code-review (attempt 2)' or 'escalation: attempt-3 pause'." },
          "story": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "repo": { "type": "string" },
          "file": { "type": "string" },
          "summary": { "type": "string", "minLength": 10 },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
          "resolution": {
            "type": "string",
            "enum": ["open", "fixed", "deferred", "dismissed", "promoted"],
            "description": "open = needs a decision/action; fixed = resolved in-epic (set commit); deferred = intentionally left for later; dismissed = reviewed, not a defect; promoted = written into repos.json conventions (set promotion_target)."
          },
          "owner_followup": { "type": "string", "description": "Concrete next action if resolution is open/deferred." },
          "commit": { "type": "string", "description": "Commit SHA when resolution is fixed." },
          "forward_to_waves": {
            "type": "array",
            "items": { "type": "string", "pattern": "^wave-\\d+$" },
            "description": "Regression-risk forwarding: the resume digest surfaces this finding to these waves' coders/gates."
          },
          "promotion_target": {
            "type": "string",
            "description": "If resolution=promoted: the repos.json conventions path it was written to, e.g. 'kmsat.conventions.test_data_gotchas'."
          },
          "created_at": { "type": "string" }
        }
      }
    }
```

- [ ] **Step 2: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('skills/kryptonite/references/epic-schema.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify it compiles as an AJV schema**

Run:
```bash
node --input-type=module -e "
import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; import fs from 'node:fs';
const ajv=new Ajv({strict:false}); addFormats(ajv);
const s=JSON.parse(fs.readFileSync('skills/kryptonite/references/epic-schema.json','utf8'));
const v=ajv.compile(s);
console.log('compiles:', !!v);
console.log('accepts findings:', v({findings:[{id:'WAVE6-FINDING-001',category:'deferred_defect',audience:['human'],wave_id:'wave-6',summary:'a sample finding text',resolution:'deferred'}], name:'x',slug:'x',description:'x',status:'active',current_phase:12,kryptonite_version:'0.10.0',created_at:'now'}));
console.log('rejects bad id:', !v({findings:[{id:'BAD',category:'process',audience:['human'],wave_id:'wave-6',summary:'a sample finding text',resolution:'open'}], name:'x',slug:'x',description:'x',status:'active',current_phase:12,kryptonite_version:'0.10.0',created_at:'now'}));
"
```
Expected: `compiles: true`, `accepts findings: true`, `rejects bad id: true`

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/references/epic-schema.json
git commit -m "feat(schema): add epic.json findings[] (0.10.0)"
```

---

## Task 2: Add `candidate_findings[]` to the wave-gate report schema

**Files:**
- Modify: `skills/kryptonite/references/wave-gate-report-schema.json` (add a property inside the top-level `"properties"`, e.g. after the `"findings"` block at line ~111-131 and before `"issues"`).

- [ ] **Step 1: Add the `candidate_findings` property**

The top-level object has `additionalProperties: false`, so this MUST be an explicit property.
Insert after the `"findings"` block (the code_review-only one) and before `"issues"`:

```json
    "candidate_findings": {
      "type": "array",
      "description": "OPTIONAL. Durable lessons this agent nominates for persistence into epic.json.findings[]. Advisory only — the orchestrator curates and decides what to keep. Distinct from issues[] (those drive the fix loop) and from code_review's findings[] (the full per-review list). Nominate things future waves/resumes need: a repo trap you hit, a spec ambiguity, a regression risk, a process lesson.",
      "items": {
        "type": "object",
        "required": ["category", "summary"],
        "additionalProperties": false,
        "properties": {
          "category": {
            "type": "string",
            "enum": ["process", "repo_gotcha", "spec_gap", "regression_risk", "deferred_defect"]
          },
          "summary": { "type": "string", "minLength": 10 },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
          "story": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "file": { "type": "string" },
          "suggested_audience": {
            "type": "array",
            "items": { "type": "string", "enum": ["orchestrator", "coder", "gate", "human"] }
          },
          "owner_followup": { "type": "string" }
        }
      }
    },
```

- [ ] **Step 2: Verify the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('skills/kryptonite/references/wave-gate-report-schema.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Verify a report WITH candidate_findings validates and an unknown key still fails**

Run:
```bash
node --input-type=module -e "
import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; import fs from 'node:fs';
const ajv=new Ajv({strict:false,allErrors:true}); addFormats(ajv);
const s=JSON.parse(fs.readFileSync('skills/kryptonite/references/wave-gate-report-schema.json','utf8'));
const v=ajv.compile(s);
const base={gate:'code_review',wave_id:'wave-7',attempt:1,status:'pass',started_at:'2026-05-29T00:00:00Z',completed_at:'2026-05-29T00:01:00Z',issues:[]};
console.log('accepts candidate_findings:', v({...base, candidate_findings:[{category:'repo_gotcha',summary:'a real repo trap here'}]}));
console.log('still rejects unknown top key:', !v({...base, bogus_key:1}));
"
```
Expected: `accepts candidate_findings: true`, `still rejects unknown top key: true`

- [ ] **Step 4: Confirm existing fixture reports still validate**

Run: `node skills/kryptonite/scripts/validate-wave-gate-report.js skills/kryptonite/data/7147a468863c/readiness-v2/wave-6/gates/code-review-2.json`
Expected: `{ "valid": true }` (if that exact file is absent, list `wave-6/gates/` and validate any one report file there — all must stay `valid: true`).

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/references/wave-gate-report-schema.json
git commit -m "feat(schema): gate reports may nominate candidate_findings[] (0.10.0)"
```

---

## Task 3: Create the Phase-12 supplemental gate for findings

**Files:**
- Create: `skills/kryptonite/scripts/phase-gates/12.0.10.0.json`
- Test: `skills/kryptonite/scripts/validate-gate.test.js`

This validates `findings[]` *shape* when present. It must NOT require findings to exist (a wave
can legitimately produce none). It reuses the epic-schema definition via `$ref`, matching the
existing supplemental pattern (`03.0.6.0.json` / `06.0.6.0.json`).

- [ ] **Step 1: Write the supplemental gate**

Create `scripts/phase-gates/12.0.10.0.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Phase 12 Gate — Findings shape (0.10.0+ supplement)",
  "description": "Applies only to epics created with kryptonite 0.10.0 or later. If epic.findings[] is present, every entry must be well-formed (valid id pattern, known category/audience/resolution, summary present). Findings are NOT required — a wave may produce none — so this only constrains entries that exist. Reuses the canonical item shape from epic-schema.json.",
  "type": "object",
  "properties": {
    "epic": {
      "type": "object",
      "properties": {
        "findings": {
          "type": "array",
          "items": { "$ref": "epic-schema.json#/properties/findings/items" }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Write a failing test for the gate**

Create `scripts/validate-gate.test.js`. This test shells out to `validate-gate.js` against a
temp epic dir, the same way a real run works. Write it to FAIL first by asserting on behavior the
gate provides (it will pass once Step 1's file exists — so to see a real RED, temporarily rename
the gate file in Step 3's verification; here we author the full test).

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const validateGate = path.join(scriptsDir, "validate-gate.js");

function runGate(epicDir) {
  try {
    const out = execFileSync("node", [validateGate, "--phase", "12", "--data-path", epicDir], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function makeEpicDir(epic, state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-test-"));
  const projectDir = path.join(dir, "proj");
  const epicDir = path.join(projectDir, "ep");
  fs.mkdirSync(epicDir, { recursive: true });
  fs.writeFileSync(path.join(epicDir, "epic.json"), JSON.stringify(epic));
  fs.writeFileSync(path.join(epicDir, "state.json"), JSON.stringify(state));
  // minimal sibling files referenced by phase>=10/11 semantic checks
  fs.writeFileSync(path.join(epicDir, "spec.json"), "{}");
  fs.writeFileSync(path.join(epicDir, "spec-versions.json"), "{}");
  fs.writeFileSync(path.join(epicDir, "plan.json"), "{}");
  fs.writeFileSync(path.join(projectDir, "repos.json"), JSON.stringify({ repos: [{ name: "r", path: "/x" }] }));
  return { dir, epicDir };
}

const baseEpic = {
  name: "t", slug: "t", description: "t", status: "active",
  current_phase: 12, kryptonite_version: "0.10.0", created_at: "now"
};
const baseState = {
  stories: [{ id: "US-001", status: "done" }],
  waves: [{ id: "wave-0", status: "complete" }]
};

test("0.10.0 epic with a well-formed finding passes the phase-12 gate", () => {
  const epic = { ...baseEpic, findings: [{
    id: "WAVE0-FINDING-001", category: "deferred_defect", audience: ["human"],
    wave_id: "wave-0", summary: "a real finding summary", resolution: "deferred"
  }] };
  const { dir, epicDir } = makeEpicDir(epic, baseState);
  try {
    const { code } = runGate(epicDir);
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("0.10.0 epic with a malformed finding id fails the phase-12 gate", () => {
  const epic = { ...baseEpic, findings: [{
    id: "BADID", category: "deferred_defect", audience: ["human"],
    wave_id: "wave-0", summary: "a real finding summary", resolution: "deferred"
  }] };
  const { dir, epicDir } = makeEpicDir(epic, baseState);
  try {
    const { code, out } = runGate(epicDir);
    assert.equal(code, 1);
    assert.match(out, /findings/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("0.10.0 epic with NO findings still passes (findings not required)", () => {
  const { dir, epicDir } = makeEpicDir({ ...baseEpic }, baseState);
  try {
    const { code } = runGate(epicDir);
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("pre-0.10.0 epic with a malformed finding is NOT held to the new gate", () => {
  // version 0.9.0 < 0.10.0 → supplemental does not apply
  const epic = { ...baseEpic, kryptonite_version: "0.9.0", findings: [{ id: "BADID" }] };
  const { dir, epicDir } = makeEpicDir(epic, baseState);
  try {
    const { code } = runGate(epicDir);
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `node --test skills/kryptonite/scripts/validate-gate.test.js`
Expected: 4 tests pass. (To confirm the gate file is actually doing the work, temporarily rename
`12.0.10.0.json`, re-run, and watch the "malformed finding id fails" test FAIL — then rename back.
This is the RED check.)

- [ ] **Step 4: Confirm the live epic still passes after a version bump dry-run**

The live epic isn't migrated yet (Task 11). Sanity-check the gate machinery doesn't crash:
Run: `node skills/kryptonite/scripts/validate-gate.js --phase 12 --data-path skills/kryptonite/data/7147a468863c/readiness-v2`
Expected: exits 0 or 1 with readable output (not a crash/exit 2). At this point the epic is still
`0.6.0`, so the 0.10.0 supplemental does not apply — any failure here is pre-existing, not from
this task.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/scripts/phase-gates/12.0.10.0.json skills/kryptonite/scripts/validate-gate.test.js
git commit -m "feat(gate): phase-12 supplemental validates findings[] shape (0.10.0)"
```

---

## Task 4: Document capture, curation, and promotion in the execution protocol

**Files:**
- Modify: `skills/kryptonite/references/execution-protocol.md` (add a new top-level section after "Issue Tracking", which ends at line ~246, before "Pass criteria" at line ~248).

This is protocol prose the orchestrator reads at runtime. No code.

- [ ] **Step 1: Insert the Findings section**

After the "Issue Tracking" section (ends `Issue IDs are stable within a wave...`) and before
`## Pass criteria`, insert:

```markdown
## Findings (durable execution discoveries)

Issues drive the fix loop and are wave-local. **Findings** are the durable lessons a wave teaches —
they outlive the wave and live in `epic.json.findings[]` (schema in `references/epic-schema.json`).
This is the schema slot that replaces the ad-hoc `state.deferred_findings[]`; never write findings
to `state.json` or to a sidecar file.

Five categories: `process` (fix-loop/infra lesson, "what done-right looks like here"),
`repo_gotcha` (a runtime-discovered repo trap — a promotion candidate), `spec_gap` (the spec/plan
was ambiguous and forced a live decision, including any NEEDS_CONTEXT halt), `regression_risk`
(later waves must watch this — pair with `forward_to_waves[]`), and `deferred_defect` (a real
defect intentionally left for later). Default audiences: process → [orchestrator, human];
repo_gotcha → [coder]; spec_gap → [orchestrator, human]; regression_risk → [coder, gate];
deferred_defect → [orchestrator, human]. The curator may override.

### Capture — three paths, one writer

The orchestrator is the **sole writer** of `epic.json.findings[]`. Subagents never write it.

1. **Agents nominate.** Every gate report may carry an optional `candidate_findings[]` array
   (schema in `references/wave-gate-report-schema.json`). Coders nominate via a `CANDIDATE_FINDINGS:`
   block in their text report (they have no JSON schema). These are advisory.
2. **Escalations auto-capture.** Before pausing the user for any escalation (attempt-3
   `pause_for_user`, a `blocked` gate, a Coder `NEEDS_CONTEXT` halt, or an end-of-wave-action
   failure), the orchestrator writes a finding first — `category: process` (or `spec_gap` for
   NEEDS_CONTEXT), `audience: [orchestrator, human]`, `resolution: open`, `source: "escalation: <which>"`.
   This is a deterministic trigger so the highest-value lessons can't be lost.
3. **User flags inline.** "Record this as a finding" → the orchestrator writes it.

### Curation — at each wave-complete and each escalation

1. Collect `candidate_findings[]` from the four gate reports + coder `CANDIDATE_FINDINGS:` blocks.
2. **Dedup** against existing `findings[]` by (file, summary) similarity — the same instinct that
   dedups issues by `dedup_key`. If a candidate restates an existing finding on a sibling file,
   record one finding noting both files, not two.
3. **Drop noise.** A candidate already covered by an existing finding, an ADR
   (`epic.json.decisions[]`), or a repo convention (`repos.json[].conventions`) is NOT recorded
   again. Recurring restatements are a signal to consolidate, not to append — the store must stay
   small enough that the resume digest is useful.
4. Assign `id` (`WAVE<N>-FINDING-NNN`, scoped to the producing wave), set
   `audience` from the category default (override if warranted), set `resolution`.
5. For `regression_risk` findings, set `forward_to_waves[]` to the wave(s) that touch the flagged
   files (read `plan.json` wave assignments). The resume digest surfaces these to the named waves.
6. Write `epic.json` using the safe-write protocol in `references/storage-protocol.md`
   (`.bak` → `.tmp` → atomic rename).

### Promotion — durable repo facts flow to repos.json (two-tier)

A `repo_gotcha` finding that is a *durable fact about the repo* (not specific to this epic) should
be **promoted** into the shared `repos.json[<repo>].conventions`:

- Factory/test-data traps → `conventions.test_data_gotchas[]`.
- Grep false-match traps → `conventions.grep_gotchas[]`.

On promotion: append the summary to the convention array, set the finding's `resolution: "promoted"`
and `promotion_target` (e.g. `"kmsat.conventions.test_data_gotchas"`). Future epics on that repo
then inherit the fact, and Phase-7.5 no longer needs to rediscover it.

**Promotion is proposed, never silent.** `repos.json` is shared across every future epic, so
polluting it is costly. Surface the candidate to the user ("this looks like a durable repo fact —
promote it to repos.json conventions?") and write only on confirmation.
```

- [ ] **Step 2: Verify the doc still reads coherently**

Run: `grep -n "## Findings\|## Pass criteria\|## Issue Tracking" skills/kryptonite/references/execution-protocol.md`
Expected: the three headers appear in order (Issue Tracking, then Findings, then Pass criteria).

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/references/execution-protocol.md
git commit -m "docs(execution): findings capture, curation, promotion protocol (0.10.0)"
```

---

## Task 5: Document the resume digest and self-heal in the storage protocol

**Files:**
- Modify: `skills/kryptonite/references/storage-protocol.md` (extend "Resume Detection" ~line 86-97, and the epic.json contents list ~line 99-112).

- [ ] **Step 1: Add `findings[]` to the epic.json contents list**

In the bulleted list under `## epic.json contents` (the one listing `parties[]`, `decisions[]`,
etc.), add after the `design_direction` bullet:

```markdown
- `findings[]` — Phase 12 execution discoveries (durable lessons, deferred defects, regression
  risks). Replaces the ad-hoc `state.deferred_findings[]`. See the Findings section in
  `references/execution-protocol.md`.
```

- [ ] **Step 2: Add the Phase-12 resume routine to Resume Detection**

At the end of the `## Resume Detection` section (after the line
`If resuming: read epic.json → current_phase tells you exactly where to pick up...`), add:

```markdown

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
```

- [ ] **Step 3: Verify the doc parses as markdown (headers intact)**

Run: `grep -n "## Resume Detection\|### Phase 12 resume\|## epic.json contents" skills/kryptonite/references/storage-protocol.md`
Expected: all three headers present, `### Phase 12 resume` nested under Resume Detection.

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/references/storage-protocol.md
git commit -m "docs(storage): phase-12 resume digest + self-heal; findings[] epic slot (0.10.0)"
```

---

## Task 6: Wire capture + curation + digest into the orchestrator agent

**Files:**
- Modify: `skills/kryptonite/agents/orchestrator.md` (the per-wave loop ~line 21-28, the Escalation table ~line 74-82, and add a resume note near "Required reading" ~line 14-19).

- [ ] **Step 1: Add a resume note to "Required reading before starting"**

After item 4 (`repos.json — testing config per repo.`) in the "Required reading before starting"
list, add:

```markdown

**On resume (current_phase == 12):** before dispatching anything, run the Phase-12 resume routine
in `references/storage-protocol.md` — self-heal (`reconcileState`: materialize the next wave,
backfill missing gate_runs) then print the resume digest from `epic.json.findings[]` + state + git.
```

- [ ] **Step 2: Add a curation step to the per-wave loop**

In the `## Per-wave loop` section, after the `Phase B` bullet (the paragraph ending
`...UAT/spec-compliance/code-review dispatch is unchanged.`), add:

```markdown

**On wave-complete — curate findings.** When the wave flips to `complete`, before advancing:
collect `candidate_findings[]` from the four gate reports and any `CANDIDATE_FINDINGS:` blocks in
coder reports, dedup against existing `epic.json.findings[]` and drop anything already covered by a
finding/ADR/convention, assign ids, set `forward_to_waves[]` on regression risks, and write the
keepers to `epic.json.findings[]` (safe-write). Propose promotion of any durable `repo_gotcha` to
`repos.json` conventions (user-confirmed). Full rules: `references/execution-protocol.md` →
"Findings". This is also where `state.json.gate_runs[]` is recorded — do both writes before the
next wave starts.
```

- [ ] **Step 3: Add auto-capture rows to the Escalation table**

The Escalation table has rows ending with the "git worktree remove fails" row (line ~82). Add a
note right after the table (before `### Ultracode advisory`):

```markdown

**Auto-capture before every pause.** For each escalation above that pauses the user
(`pause_for_user` at attempt 3, any `blocked` gate, an end-of-wave-action failure, or a Coder
`NEEDS_CONTEXT` halt), write a finding to `epic.json.findings[]` BEFORE surfacing to the user —
`category: process` (`spec_gap` for NEEDS_CONTEXT), `audience: [orchestrator, human]`,
`resolution: open`, `source: "escalation: <which>"`, with `owner_followup` describing the choice
the user faces. See `references/execution-protocol.md` → "Findings".
```

- [ ] **Step 4: Verify the edits landed**

Run: `grep -n "curate findings\|Auto-capture before every pause\|Phase-12 resume routine" skills/kryptonite/agents/orchestrator.md`
Expected: all three phrases present.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/agents/orchestrator.md
git commit -m "feat(orchestrator): findings capture/curation/promotion + resume digest hooks (0.10.0)"
```

---

## Task 7: Add `candidate_findings[]` nomination to the four gate agents

**Files:**
- Modify: `skills/kryptonite/agents/wave-code-review-agent.md` (Output section ~line 58-65)
- Modify: `skills/kryptonite/agents/wave-uat-agent.md`
- Modify: `skills/kryptonite/agents/wave-spec-compliance-agent.md`
- Modify: `skills/kryptonite/agents/wave-ux-agent.md`

Each gets the same short, identical nomination paragraph appended to its Output/Report section. Use
the exact same text in all four so the schema contract reads identically everywhere.

- [ ] **Step 1: Append the nomination block to the code-review agent**

In `agents/wave-code-review-agent.md`, after the "Output" section's `findings[]`/`issues[]` bullets
(before "Issue format:"), add:

```markdown

Optional — `candidate_findings[]` (nomination, advisory): you MAY nominate durable lessons for the
orchestrator to persist into `epic.json.findings[]`. Use this for a finding that future waves or a
resume need to know — a repo trap (`repo_gotcha`), a spec/plan ambiguity (`spec_gap`), a
regression risk later waves must watch (`regression_risk`), or a process lesson (`process`). Shape:
`{ category, summary, severity?, story?, file?, suggested_audience?, owner_followup? }` (schema in
`references/wave-gate-report-schema.json`). The orchestrator curates — nominating does not
guarantee persistence. This is separate from `findings[]`/`issues[]`, which are about THIS review.
```

- [ ] **Step 2: Append the same block to the other three gate agents**

Add the identical paragraph to the Output/Report section of `wave-uat-agent.md`,
`wave-spec-compliance-agent.md`, and `wave-ux-agent.md`. For UAT/UX/spec-compliance the lead-in
sentence "separate from `findings[]`/`issues[]`" should read "separate from your gate's
results array and `issues[]`" since those agents don't have a `findings[]`. Use this variant for
those three:

```markdown

Optional — `candidate_findings[]` (nomination, advisory): you MAY nominate durable lessons for the
orchestrator to persist into `epic.json.findings[]`. Use this for a finding that future waves or a
resume need to know — a repo trap (`repo_gotcha`), a spec/plan ambiguity (`spec_gap`), a
regression risk later waves must watch (`regression_risk`), or a process lesson (`process`). Shape:
`{ category, summary, severity?, story?, file?, suggested_audience?, owner_followup? }` (schema in
`references/wave-gate-report-schema.json`). The orchestrator curates — nominating does not
guarantee persistence. This is separate from your gate's results array and `issues[]`, which are
about THIS wave.
```

- [ ] **Step 3: Verify all four agents carry the block**

Run: `grep -lc "candidate_findings\[\] (nomination, advisory)" skills/kryptonite/agents/wave-uat-agent.md skills/kryptonite/agents/wave-ux-agent.md skills/kryptonite/agents/wave-spec-compliance-agent.md skills/kryptonite/agents/wave-code-review-agent.md`
Expected: all four file paths listed (each match count ≥ 1).

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/agents/wave-uat-agent.md skills/kryptonite/agents/wave-ux-agent.md skills/kryptonite/agents/wave-spec-compliance-agent.md skills/kryptonite/agents/wave-code-review-agent.md
git commit -m "feat(gates): four wave gate agents may nominate candidate_findings[] (0.10.0)"
```

---

## Task 8: Add the `CANDIDATE_FINDINGS:` block to the coder agent

**Files:**
- Modify: `skills/kryptonite/agents/coder.md` (Status Reports section ~line 115-143).

The coder report is prompt-level (no JSON schema), so coders nominate via a text block the
orchestrator parses.

- [ ] **Step 1: Add the nomination block documentation**

After the "Fix-on-Main Mode" report JSON block and the `Statuses:` line (line ~143), and before
"### Worktree-mode reports cannot claim verification", add:

```markdown

### Nominating findings (optional)

If, while implementing, you hit something **future waves or a resume should know** — a repo trap
you had to work around, a place the spec was ambiguous, a risk another story might trip on — append
a `CANDIDATE_FINDINGS:` block after your status report. The orchestrator parses and curates these
into `epic.json.findings[]`; nominating does not guarantee persistence. Omit the block if you have
nothing durable to add — do NOT invent findings to fill it.

```text
CANDIDATE_FINDINGS:
- category: repo_gotcha
  summary: <one or two sentences — the durable fact, not a play-by-play>
  file: <optional path>
  suggested_audience: [coder]
- category: spec_gap
  summary: <what the spec left undefined and what you assumed>
```

Categories: `process`, `repo_gotcha`, `spec_gap`, `regression_risk`, `deferred_defect`. This is
NOT a place for verification claims — worktree mode still verifies nothing (see below).
```

- [ ] **Step 2: Verify the block landed and didn't disturb the verification rule**

Run: `grep -n "CANDIDATE_FINDINGS:\|cannot claim verification" skills/kryptonite/agents/coder.md`
Expected: `CANDIDATE_FINDINGS:` appears before the "cannot claim verification" header.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/agents/coder.md
git commit -m "feat(coder): CANDIDATE_FINDINGS nomination block (0.10.0)"
```

---

## Task 9: Note the findings location in the state-machine doc + SKILL discipline table

**Files:**
- Modify: `skills/kryptonite/references/state-machine.md` ("What Gets Tracked Per Wave" ~line 52-58)
- Modify: `skills/kryptonite/SKILL.md` (Discipline table ~line 256-266)

- [ ] **Step 1: Add a findings pointer to state-machine.md**

At the end of the `## What Gets Tracked Per Wave` section (after the `gate_runs[]` bullet), add:

```markdown

**Findings are NOT in `state.json`.** Durable execution discoveries live in
`epic.json.findings[]` (see `references/execution-protocol.md` → "Findings" and
`references/epic-schema.json`). This intentionally replaces the earlier ad-hoc
`state.json.deferred_findings[]` — `state.json` is execution scratch (large, sliced for dispatch);
findings are durable records that belong beside `decisions[]`/`scope_history[]` in `epic.json`.
```

- [ ] **Step 2: Add a Discipline-table row to SKILL.md**

In the Discipline table (the `| Rationalization | What's actually true |` table), add a row after
the existing sidecar row (the one mentioning `gap_analysis.md` / `rescope.md`):

```markdown
| "I'll stash what this wave taught me in `state.deferred_findings` / a notes field / the handoff prompt." | Phase-12 discoveries belong in `epic.json.findings[]` (schema in `references/epic-schema.json`; capture/curation in `references/execution-protocol.md`). `state.json` is sliced for dispatch and is the wrong home; a growing handoff prompt is the symptom this field exists to cure. Durable *repo* facts get promoted into `repos.json` conventions. |
```

- [ ] **Step 3: Verify both edits**

Run: `grep -n "Findings are NOT in" skills/kryptonite/references/state-machine.md && grep -n "state.deferred_findings" skills/kryptonite/SKILL.md`
Expected: one match in each file.

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/references/state-machine.md skills/kryptonite/SKILL.md
git commit -m "docs: point findings to epic.json.findings[] in state-machine + SKILL discipline (0.10.0)"
```

---

## Task 10: Version bump + changelog entry

**Files:**
- Modify: `skills/kryptonite/references/schema-changelog.json` (prepend a 0.10.0 entry to `versions[]`)
- Modify: `package.json` (version 0.9.0 → 0.10.0)

- [ ] **Step 1: Prepend the 0.10.0 changelog entry**

In `references/schema-changelog.json`, add this as the FIRST element of the `"versions"` array
(before the `0.9.0` entry):

```json
{
  "version": "0.10.0",
  "date": "2026-05-29",
  "changes": [
    {
      "type": "added",
      "target": "epic-schema.json",
      "field": "findings[]",
      "description": "Durable Phase-12 execution discoveries. Each entry: id (^WAVE\\d+-FINDING-\\d{3,}$), category (process|repo_gotcha|spec_gap|regression_risk|deferred_defect), audience[] (orchestrator|coder|gate|human), wave_id, summary, resolution (open|fixed|deferred|dismissed|promoted), plus optional source/story/repo/file/severity/owner_followup/commit/forward_to_waves[]/promotion_target/created_at. Formalizes the ad-hoc state.json.deferred_findings[] the orchestrator had been inventing with no schema. Agent-nominated + orchestrator-curated; escalations auto-capture. Resume builds its digest from this array."
    },
    {
      "type": "added",
      "target": "wave-gate-report-schema.json",
      "field": "candidate_findings[]",
      "description": "Optional per-gate-report nomination channel. Each entry: category + summary (required) plus optional severity/story/file/suggested_audience/owner_followup. Advisory — the orchestrator curates which become epic.json.findings[]. Coders (no JSON report) nominate via a CANDIDATE_FINDINGS: text block instead. The report's top-level additionalProperties:false required adding this as an explicit property."
    },
    {
      "type": "added",
      "target": "phase-gates",
      "field": "scripts/phase-gates/12.0.10.0.json",
      "description": "Phase-12 supplemental gate: when epic.findings[] is present, each entry must be well-formed (reuses epic-schema.json#/properties/findings/items via $ref). Findings are NOT required — a wave may produce none — so the gate only constrains entries that exist. Applies to epics created on 0.10.0+; older epics are unaffected."
    },
    {
      "type": "changed",
      "target": "references/execution-protocol.md",
      "field": "Findings section",
      "description": "New section after Issue Tracking: capture (agents nominate via candidate_findings[] / coders via CANDIDATE_FINDINGS:; escalations auto-capture before every pause), curation (collect → dedup → drop noise → id → forward_to_waves → safe-write at wave-complete), and two-tier promotion of durable repo_gotcha findings into repos.json conventions (user-confirmed, never silent)."
    },
    {
      "type": "changed",
      "target": "references/storage-protocol.md",
      "field": "Phase-12 resume routine + epic.json findings slot",
      "description": "Resume Detection gains a Phase-12 routine: self-heal (reconcileState — materialize ONLY the next wave if plan has it but state lacks it; backfill gate_runs from on-disk report files, idempotent) then print a resume digest (decisions-needed / forwarded-to-this-wave / repo-conventions-in-play / next-action) read entirely from disk. epic.json contents list gains findings[]."
    },
    {
      "type": "changed",
      "target": "agents/orchestrator.md",
      "field": "capture/curation/promotion + resume hooks",
      "description": "Per-wave loop gains a curate-findings step at wave-complete (alongside recording gate_runs). Escalation table gains an auto-capture rule (write a finding before every user pause). Required-reading gains the Phase-12 resume routine."
    },
    {
      "type": "changed",
      "target": "agents/{wave-uat,wave-ux,wave-spec-compliance,wave-code-review}-agent.md + agents/coder.md",
      "field": "candidate_findings nomination",
      "description": "Four gate agents document the optional candidate_findings[] nomination in their Output section; the coder documents an optional CANDIDATE_FINDINGS: text block. All advisory; the orchestrator curates."
    },
    {
      "type": "changed",
      "target": "references/state-machine.md + SKILL.md",
      "field": "findings location guidance",
      "description": "state-machine.md notes findings live in epic.json, not state.json. SKILL.md Discipline table gains a row pointing the 'stash what this wave taught me' urge at epic.json.findings[]."
    }
  ],
  "migration": {
    "from": "0.9.0",
    "breaking": false,
    "notes": [
      "0.9.0 epics resume cleanly. findings[] is optional (absent = no findings, prior behavior). The 12.0.10.0 supplemental gate only constrains findings entries that exist, and only for epics stamped 0.10.0+.",
      "candidate_findings[] on gate reports is optional and additive — gates that don't emit it are unaffected.",
      "Existing state.json.deferred_findings[] in in-flight epics is not auto-migrated by the validator. Move those entries to epic.json.findings[] when convenient (see the readiness-v2 migration shipped with this version as the worked example), then delete state.deferred_findings[]."
    ],
    "steps": [
      "Bump epic.json.kryptonite_version to '0.10.0' to opt into the findings-shape gate.",
      "If the epic has an ad-hoc state.json.deferred_findings[], move each entry to epic.json.findings[] (map id/source/severity/story/file/summary/resolution/owner_followup/commit 1:1; add category/audience/wave_id), then remove state.deferred_findings[].",
      "Promote durable repo facts (factory traps, grep traps) into repos.json[].conventions.test_data_gotchas[]/grep_gotchas[] and mark the source findings resolution:'promoted' with promotion_target."
    ]
  }
}
```

- [ ] **Step 2: Verify the changelog parses**

Run: `node -e "const c=require('./skills/kryptonite/references/schema-changelog.json'); console.log('first version:', c.versions[0].version)"`
Expected: `first version: 0.10.0`

- [ ] **Step 3: Bump package.json**

In `package.json`, change `"version": "0.9.0"` to `"version": "0.10.0"`.

- [ ] **Step 4: Verify**

Run: `node -e "console.log(require('./package.json').version)"`
Expected: `0.10.0`

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/references/schema-changelog.json package.json
git commit -m "release: v0.10.0 — execution findings store + resume digest"
```

---

## Task 11: Migrate the live `readiness-v2` epic (acceptance test)

**Files:**
- Modify: `skills/kryptonite/data/7147a468863c/readiness-v2/epic.json` (add `findings[]`, bump `kryptonite_version`)
- Modify: `skills/kryptonite/data/7147a468863c/readiness-v2/state.json` (remove `deferred_findings[]`)
- Modify: `skills/kryptonite/data/7147a468863c/repos.json` (promote durable kmsat rules into `kmsat.conventions`)

This proves the feature end-to-end on real data. Do it with a small migration script so the mapping
is auditable, then verify with the gate. **Back up first.**

- [ ] **Step 1: Back up the three files**

```bash
cd skills/kryptonite/data/7147a468863c
cp readiness-v2/epic.json readiness-v2/epic.json.pre-findings.bak
cp readiness-v2/state.json readiness-v2/state.json.pre-findings.bak
cp repos.json repos.json.pre-findings.bak
cd -
```

- [ ] **Step 2: Write the migration script**

Create a throwaway script `skills/kryptonite/scripts/_migrate-readiness-findings.mjs` (it will be
deleted in Step 6):

```javascript
import fs from "node:fs";
const root = new URL("../data/7147a468863c/", import.meta.url).pathname;
const epicPath = root + "readiness-v2/epic.json";
const statePath = root + "readiness-v2/state.json";
const reposPath = root + "repos.json";

const epic = JSON.parse(fs.readFileSync(epicPath, "utf8"));
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const repos = JSON.parse(fs.readFileSync(reposPath, "utf8"));

const df = state.deferred_findings || [];
const waveOf = (id) => {
  const m = /^WAVE(\d+)-/.exec(id);
  return m ? `wave-${m[1]}` : "wave-0";
};
// nil-account guard cluster — forward to wave-7 (these mutation files are touched there)
const NIL_ACCOUNT_IDS = new Set(["WAVE6-FINDING-001","WAVE6-FINDING-002","WAVE6-FINDING-003","WAVE6-FINDING-004","WAVE6-FINDING-005","WAVE6-FINDING-006"]);

const findings = df.map((f) => {
  const out = {
    id: f.id,
    category: "deferred_defect",
    audience: ["orchestrator", "human"],
    wave_id: waveOf(f.id),
    summary: f.summary,
    resolution: f.resolution === "dismissed-weak" ? "dismissed" : f.resolution
  };
  if (f.source) out.source = f.source;
  if (f.severity) out.severity = f.severity;
  if (f.story) out.story = f.story;
  if (f.file) out.file = f.file;
  if (f.owner_followup) out.owner_followup = f.owner_followup;
  if (f.commit) out.commit = f.commit;
  if (NIL_ACCOUNT_IDS.has(f.id)) out.forward_to_waves = ["wave-7"];
  return out;
});

epic.findings = findings;
epic.kryptonite_version = "0.10.0";
delete state.deferred_findings;

// Promote durable kmsat rules into conventions (user-curated list)
const kmsat = (repos.repos || []).find((r) => r.name === "kmsat");
if (kmsat) {
  kmsat.conventions = kmsat.conventions || {};
  const tdg = new Set(kmsat.conventions.test_data_gotchas || []);
  [
    "create(:owner)/create(:account) fires after_create that seeds ONE Readiness::AccountAppConfig (UNIQUE account_id) + LearnerExperience — specs must not assume an empty table or create a second config row.",
    "Two create(:owner) collapse onto ONE account (email-domain lookup); cross-account specs need create(:account) for the foreign side.",
    "kmsat workers use POSITIONAL perform args (WorkerLogger ArgumentInterceptor breaks kwargs); assert signature via instance_method(:perform).super_method."
  ].forEach((g) => tdg.add(g));
  kmsat.conventions.test_data_gotchas = [...tdg];

  const gg = new Set(kmsat.conventions.grep_gotchas || []);
  [
    "GraphQL no-accountId DOD greps must anchor to each op's OWN arg block (^  opName( … ):), not a broad awk span — a broad span false-fails unrelated mutations.",
    "Never grep the rake-dumped /kmsat/schema.graphql (empty 26-byte placeholder repo-wide — Warden gates visibility by scope). Use the scoped SDL dump."
  ].forEach((g) => gg.add(g));
  kmsat.conventions.grep_gotchas = [...gg];

  kmsat.conventions.schema_introspection_command =
    "Schema::Knowbe4.to_definition(context:{scopes:['kmsat']}) dumped to a /tmp file then grepped (rake graphql:write_schema_files dumps empty — no scope).";
  kmsat.conventions.test_db_setup = kmsat.conventions.test_db_setup ||
    "Migrations run against BOTH RAILS_ENV=development AND =test (shared MySQL); NEVER db:drop/create/schema:load.";
}

fs.writeFileSync(epicPath, JSON.stringify(epic, null, 2) + "\n");
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
fs.writeFileSync(reposPath, JSON.stringify(repos, null, 2) + "\n");
console.log(`migrated ${findings.length} findings; forwarded ${findings.filter(f=>f.forward_to_waves).length} to wave-7; deferred_findings present after: ${'deferred_findings' in state}`);
```

> The category mapping is intentionally simple (all migrated entries → `deferred_defect`, with
> `dismissed`/`dismissed-weak` resolutions preserved as `dismissed`). The live data is all
> code-review deferrals/dismissals, so `deferred_defect` is correct for every entry. Don't
> over-engineer category inference — the orchestrator will categorize *new* findings going forward.

- [ ] **Step 3: Run the migration**

Run: `node skills/kryptonite/scripts/_migrate-readiness-findings.mjs`
Expected: `migrated 19 findings; forwarded 6 to wave-7; deferred_findings present after: false`

- [ ] **Step 4: Verify epic.json + repos.json are well-formed and the version bumped**

Run:
```bash
node -e "
const e=require('./skills/kryptonite/data/7147a468863c/readiness-v2/epic.json');
const s=require('./skills/kryptonite/data/7147a468863c/readiness-v2/state.json');
const r=require('./skills/kryptonite/data/7147a468863c/repos.json');
console.log('version:', e.kryptonite_version, '| findings:', e.findings.length, '| state.deferred_findings:', 'deferred_findings' in s);
console.log('forwarded ids:', e.findings.filter(f=>f.forward_to_waves).map(f=>f.id).join(','));
console.log('kmsat test_data_gotchas:', (r.repos.find(x=>x.name==='kmsat').conventions.test_data_gotchas||[]).length);
"
```
Expected: `version: 0.10.0 | findings: 19 | state.deferred_findings: false`, six forwarded ids
(the WAVE6 nil-account cluster), and a non-zero gotchas count.

- [ ] **Step 5: Run the Phase-12 gate against the migrated live epic**

Run: `node skills/kryptonite/scripts/validate-gate.js --phase 12 --data-path skills/kryptonite/data/7147a468863c/readiness-v2`
Expected: the `findings[]` shape passes (no SCHEMA errors mentioning `findings`). Other pre-existing
errors about waves/stories not all being `done` are EXPECTED (the epic is mid-execution at wave-6,
waves 7-12 aren't complete) — the only thing this task asserts is that **no error mentions
`/epic/findings`**. Confirm with:
`node skills/kryptonite/scripts/validate-gate.js --phase 12 --data-path skills/kryptonite/data/7147a468863c/readiness-v2 | grep -i finding || echo "no findings errors — PASS"`
Expected: `no findings errors — PASS`

- [ ] **Step 6: Delete the throwaway migration script and the .bak files**

```bash
rm skills/kryptonite/scripts/_migrate-readiness-findings.mjs
rm skills/kryptonite/data/7147a468863c/readiness-v2/epic.json.pre-findings.bak
rm skills/kryptonite/data/7147a468863c/readiness-v2/state.json.pre-findings.bak
rm skills/kryptonite/data/7147a468863c/repos.json.pre-findings.bak
```

> Keep the `.bak` files until Step 5 passes; only then delete. If Step 5 shows a findings error,
> restore from `.bak`, fix the schema or mapping, and re-run.

- [ ] **Step 7: Commit**

```bash
git add skills/kryptonite/data/7147a468863c/readiness-v2/epic.json skills/kryptonite/data/7147a468863c/readiness-v2/state.json skills/kryptonite/data/7147a468863c/repos.json
git commit -m "migrate(readiness-v2): deferred_findings → epic.findings[]; promote kmsat conventions (0.10.0)"
```

---

## Task 12: Full validation sweep

- [ ] **Step 1: Run the new gate tests**

Run: `node --test skills/kryptonite/scripts/validate-gate.test.js`
Expected: all tests pass.

- [ ] **Step 2: Run the existing worktree-manager tests (regression)**

Run: `node --test skills/kryptonite/scripts/worktree-manager.test.js`
Expected: all tests pass (unchanged by this work).

- [ ] **Step 3: Validate the live plan still validates**

Run:
```bash
cd skills/kryptonite/data/7147a468863c/readiness-v2
node ../../../scripts/validate-plan.js plan.json spec.json state.json | tail -5
cd -
```
Expected: `valid: true` (the ~34 benign `unreconciled_reference` warnings are expected and don't
fail). This confirms removing `state.deferred_findings[]` didn't break plan validation (it never
read that field).

- [ ] **Step 4: Confirm all four gate agents and the coder carry the nomination text**

Run:
```bash
grep -l "candidate_findings" skills/kryptonite/agents/wave-*-agent.md
grep -l "CANDIDATE_FINDINGS" skills/kryptonite/agents/coder.md
```
Expected: four gate-agent paths + the coder path.

- [ ] **Step 5: Confirm no stray references to the old store remain in protocol docs**

Run: `grep -rn "deferred_findings" skills/kryptonite/references skills/kryptonite/agents skills/kryptonite/SKILL.md`
Expected: matches only where we intentionally reference it as the *replaced* store (state-machine.md,
SKILL.md, execution-protocol.md, schema-changelog.json) — NOT as a live mechanism. Eyeball each hit.

- [ ] **Step 6: Final commit (if any verification-driven fixes were made)**

```bash
git add -A skills/kryptonite docs/superpowers
git commit -m "test: validation sweep for execution findings (0.10.0)"
```

(If nothing changed in this task, skip the commit.)

---

## Self-Review (completed during planning)

**Spec coverage:**
- §1 data model → Task 1 (epic schema). ✓
- §2 capture (candidate_findings, CANDIDATE_FINDINGS, escalation auto-capture) → Tasks 2, 6, 7, 8. ✓
- §2 curation + dedup + anti-junk-drawer → Task 4 + Task 6. ✓
- §2 promotion (two-tier, user-confirmed) → Task 4 + Task 6 + applied in Task 11. ✓
- §3 self-heal (materialize next wave, backfill gate_runs) → Task 5 + Task 6. ✓
- §3 resume digest → Task 5 + Task 6. ✓
- §4 version/changelog/validator/gate → Tasks 3, 10. ✓
- §4 live-epic migration → Task 11. ✓

**Type/name consistency:** `findings[]` item shape (Task 1) is `$ref`d by the supplemental gate
(Task 3) and consumed by the migration (Task 11) — same required fields
(`id, category, audience, wave_id, summary, resolution`) throughout. `candidate_findings[]` shape
(Task 2) matches the nomination docs (Tasks 7, 8). Category enum
(`process|repo_gotcha|spec_gap|regression_risk|deferred_defect`) is identical in epic schema,
report schema, and all agent docs. Resolution enum includes `promoted` (Task 1) and is set by
promotion (Task 4) and the migration (Task 11).

**Placeholder scan:** No TBD/TODO. Every code/edit step shows exact content. Validation steps show
exact commands + expected output.

**Decisions locked from brainstorming:** findings live in `epic.json` (not state); promotion is
user-confirmed; self-heal materializes only the next wave; findings are never *required* by the gate.
