# Execution Findings & Resume Digest — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorming)
**Target version:** kryptonite 0.10.0 (additive, non-breaking)

## Problem

During Phase 12 (wave-gate execution) the orchestrator continuously learns things that
are not derivable from the spec, plan, or code: which fix strategies worked, repo gotchas
discovered live, places the spec was ambiguous, defects deferred for later, and risks that
later waves must watch. Today that knowledge has no durable home. When the user resumes a
new wave (after `/clear` or context fill), they hand-type a growing "handoff prompt" to
carry it forward.

The signal that this is real and overdue: the orchestrator has **already invented an ad-hoc
store** — `state.json.deferred_findings[]`, 19 entries in the live `readiness-v2` epic — that
exists in **no schema**. The skill's own Discipline table (`SKILL.md`) says exactly this:
*"The recurring urge to add a sidecar means the schema needs a new field — propose it."*

A real handoff prompt (the `readiness-v2` wave-7 resume) was used as the design's ground
truth. It carries six distinct kinds of knowledge:

| Section of the handoff prompt | What it is | Where it should live |
|---|---|---|
| OPEN DEFERRED FINDINGS (nil-account cluster) | Deferred defects + forward warnings | `state.deferred_findings` → **formalize** as `epic.json.findings[]` |
| HARD-WON EXECUTION RULES (SDL scoping, field collision, account seeding, shared DB) | Durable **repo** facts | `repos.json[].conventions` (promotion) |
| STATUS narrative ("all-green premise was wrong") | **Process lessons** | `findings[]` (category `process`) |
| "if you touch these files in wave-7, add the guard" | **Cross-wave regression risk** | `findings[]` (`regression_risk` + `forward_to_waves`) |
| BOOKKEEPING GAPS (waves 7–12 not materialized; gate_runs not backfilled) | Bugs in resume/materialize | **fixed** by self-heal, not stored |
| WHERE THINGS LIVE / STATUS / START BY | Operational sequencing | generated **Resume Digest** |

Two root causes the design must address, not just the findings store:

1. **The resumed orchestrator does not load the user's auto-memory.** The KMSAT execution
   rules live in the user's *kmsat* project memory, which only auto-loads when CWD is the
   kmsat repo — but the orchestrator runs from the plugin dir. So the user re-types them
   every resume. Promoting them into `repos.json[].conventions` (epic data, CWD-independent)
   fixes this permanently.
2. **A findings store alone does not shrink the prompt.** The store is half the fix; the
   other half is a **Resume Digest** that reads findings + conventions + open state and
   *prints the handoff itself*, so the prompt collapses to one line.

## Goals

- A single, schema-backed, durable store for Phase-12 discoveries.
- Sliceable by **audience** (orchestrator / coder / gate / human) and **category**.
- Captured where the knowledge is born (agents nominate; orchestrator curates; escalations
  auto-capture) — not retro-typed by the user.
- A two-tier lifetime: epic-scoped by default; durable repo facts **promoted** into shared
  `repos.json` conventions so future epics inherit them.
- A Resume Digest the orchestrator prints on resume, collapsing the handoff prompt to one line.
- Self-heal the two recurring bookkeeping gaps (materialize next wave, backfill gate_runs).

## Non-goals

- No change to the wave-gate state machine, the four gates, or the fix loop.
- No new hard phase gate that *requires* findings (would incentivize noise).
- Subagents still never write `epic.json`/`state.json` — they only report. (Invariant held.)
- Not materializing all future waves on resume — only the next one (one-wave-ahead).

---

## Section 1 — Data model

**One store: a new top-level `findings[]` in `epic.json`.** It replaces the schema-less
`state.json.deferred_findings[]`. One store removes the "where do I look" problem;
`category` + `audience` tags let each consumer slice it.

Rationale for `epic.json` (not `state.json`): findings are durable "what we learned" records
that belong beside `decisions[]` / `scope_history[]` — exactly where the no-sidecar discipline
points. `state.json` is large (can exceed 700KB) and is sliced for dispatch, risking truncation.
Mutable records in the durable file have precedent: `decisions[].status` already mutates
(`accepted`→`superseded`), so a finding's `resolution` mutating (`open`→`fixed`) is consistent.

Added to `references/epic-schema.json`:

```jsonc
"findings": {
  "type": "array",
  "description": "Phase 12 execution discoveries. Agent-nominated + orchestrator-curated; escalations auto-capture. Durable home for what waves teach — replaces the ad-hoc state.deferred_findings.",
  "items": {
    "type": "object",
    "required": ["id", "category", "audience", "wave_id", "summary", "resolution"],
    "properties": {
      "id":        { "type": "string", "pattern": "^(WAVE\\d+|EPIC)-FINDING-\\d{3,}$" },
      "category":  { "type": "string", "enum": ["process", "repo_gotcha", "spec_gap", "regression_risk", "deferred_defect"] },
      "audience":  { "type": "array", "minItems": 1, "items": { "type": "string", "enum": ["orchestrator","coder","gate","human"] } },
      "wave_id":   { "type": "string", "pattern": "^wave-\\d+$" },
      "source":    { "type": "string", "description": "e.g. 'wave-6 code-review (attempt 2)' or 'escalation: attempt-3 pause'" },
      "story":     { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
      "repo":      { "type": "string" },
      "file":      { "type": "string" },
      "summary":   { "type": "string", "minLength": 10 },
      "severity":  { "type": "string", "enum": ["critical","high","medium","low","info"] },
      "resolution":{ "type": "string", "enum": ["open","fixed","deferred","dismissed","promoted"] },
      "owner_followup":   { "type": "string" },
      "commit":           { "type": "string" },
      "forward_to_waves": { "type": "array", "items": { "type": "string", "pattern": "^wave-\\d+$" },
                            "description": "Regression-risk forwarding: the Resume Digest surfaces this finding to these waves' coders/gates." },
      "promotion_target": { "type": "string",
                            "description": "If resolution=promoted: the repos.json conventions path written to, e.g. 'kmsat.conventions.test_data_gotchas'." },
      "created_at":       { "type": "string" }
    }
  }
}
```

Six required fields only; everything else optional. A one-line process lesson and a fully
attributed deferred defect both fit. This is a near-superset of the shape the orchestrator
already settled on (`id/source/severity/story/file/summary/resolution/owner_followup/commit`);
the additions are `category`, `audience`, `wave_id`, `forward_to_waves`, `promotion_target`.

**Category → default audience** (overridable by the curator):

| category | default audience | meaning |
|---|---|---|
| `process` | orchestrator, human | fix-loop / infra / "what done-right looks like" lessons |
| `repo_gotcha` | coder | runtime-discovered repo trap; promotion candidate |
| `spec_gap` | orchestrator, human | spec/plan ambiguity that forced a live decision (incl. NEEDS_CONTEXT) |
| `regression_risk` | coder, gate | later waves must watch this; pairs with `forward_to_waves` |
| `deferred_defect` | orchestrator, human | a real defect intentionally deferred |

---

## Section 2 — Capture, curation, promotion

**Three capture paths feed one curation point (the orchestrator).** Subagents nominate;
the orchestrator curates and is the sole writer of `epic.json`.

### Path 1 — Agents nominate (`candidate_findings[]`)

Add an optional top-level array to `references/wave-gate-report-schema.json`:

```jsonc
"candidate_findings": {
  "type": "array",
  "description": "Findings this agent nominates for persistence. Advisory — the orchestrator decides what to promote into epic.json.findings[]. Distinct from issues[] (those drive the fix loop; these are durable lessons).",
  "items": {
    "type": "object",
    "required": ["category", "summary"],
    "properties": {
      "category":          { "type": "string", "enum": ["process","repo_gotcha","spec_gap","regression_risk","deferred_defect"] },
      "summary":           { "type": "string", "minLength": 10 },
      "severity":          { "type": "string", "enum": ["critical","high","medium","low","info"] },
      "story":             { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
      "file":              { "type": "string" },
      "suggested_audience":{ "type": "array", "items": { "type": "string", "enum": ["orchestrator","coder","gate","human"] } },
      "owner_followup":    { "type": "string" }
    }
  }
}
```

The coder report is prompt-level (no JSON schema — per changelog 0.9.0). Coders nominate via
a `CANDIDATE_FINDINGS:` block in their text report, parsed by the orchestrator.

### Path 2 — Escalations auto-capture

`agents/orchestrator.md` escalation table gains a rule: on every `pause_for_user` (attempt-3),
`blocked` gate, `NEEDS_CONTEXT` halt, or end-of-wave-action failure, **write a finding before
pausing** — `category: process` (or `spec_gap` for NEEDS_CONTEXT), `audience: [orchestrator, human]`,
`resolution: open`. Deterministic trigger → cannot be forgotten.

### Path 3 — User flags inline

"Record this as a finding" → orchestrator writes it. Always available.

### Curation (orchestrator, at wave-complete + each escalation)

1. Collect `candidate_findings[]` from the four gate reports + coder text blocks.
2. **Dedup** against existing `findings[]` by file+summary similarity (same instinct as
   issue dedup by `dedup_key`). The live data already shows this judgment:
   `WAVE6-FINDING-002` says *"Same defect as FINDING-001 on the publish mutation."*
3. Assign `id` (`WAVE<N>-FINDING-NNN`); set `audience` from category default (overridable);
   set `resolution`.
4. For `regression_risk`, set `forward_to_waves[]` = the wave(s) touching the flagged files.
   This is the *"if you touch these files in wave-7, add the guard"* warning, as data.
5. Write `epic.json` (`.bak` first, per `storage-protocol.md`).

**Judgment-call boundary (anti-junk-drawer):** not every candidate becomes a finding. Drop
candidates already covered by an existing finding, an ADR, or a convention. Recurring noise is
itself a signal to consolidate, not append.

### Promotion (two-tier lifetime)

When a finding is a durable repo fact, the orchestrator promotes it: copy the summary into
`repos.json[].conventions.test_data_gotchas[]` or `grep_gotchas[]`, set the finding's
`resolution: promoted` and `promotion_target`. **Promotion is proposed, never silent** — the
orchestrator asks the user to confirm, because `repos.json` is shared across all future epics
(polluting it is costly). This is the mechanism that ends the user re-typing execution rules:
once a rule lives in `kmsat.conventions`, every future epic's coders and the Resume Digest read
it automatically — no auto-memory dependency, no handoff paragraph.

---

## Section 3 — Resume Digest + self-heal

Lives in `references/storage-protocol.md` (resume detection) and
`references/execution-protocol.md` (Phase 12 preconditions). Two routines run at the **start**
of any Phase-12 resume, **before** dispatching anything.

### 3a — Self-heal: `reconcileState()`

**`materializeNextWave()`** — For the wave about to run: if `plan.json` has `wave-N`
(parallel_groups + user_journeys) but `state.json.waves[]` lacks it, create it from the plan
(`{id, name, stories, status:"pending", gate_runs:[]}`) and set those stories' `status:"pending"`.
Mirrors the existing wave shape. (Closes handoff gap #1.)
Scope: materialize **only the next wave** — not all future waves. Materializing unreached waves
invents state for not-yet-detailed work and would make the Phase-12 gate see phantom pending waves.

**`backfillGateRuns()`** — For any completed wave with `wave-K/gates/*.json` report files on
disk but no `gate_runs[]` entry in `state.json`: reconstruct the entry (status + report_path per
gate, issues hoisted). Idempotent — skips waves that already have `gate_runs[]`. (Closes gap #2.)

Both are **self-healing, not silent**: each logs what it fixed into the digest. Both go through
the `.bak`-then-write discipline.

### 3b — The Resume Digest

After self-heal, the orchestrator reads disk and prints the handoff the user currently types.
Every line is read from disk — findings (audience-filtered per section), open `deferred_defect`s,
`forward_to_waves` matches for the upcoming wave, `repos.json` conventions, git state, plan.

```
═══ RESUME: readiness-v2 — Phase 12, Wave 7 ═══
Verified on disk: HEAD 17c8d1d2 on `myoa` · waves 0–6 complete · 49 stories done
Self-heal: materialized wave-7 (10 stories pending) · backfilled gate_runs waves 2–5

▸ DECISIONS NEEDED (open findings, audience:human)
  • 5× nil-account guard cluster (WAVE6-FINDING-001..005) — deferred. Wave-7 touches
    these mutation files → recommend fixing now. [forward_to: wave-7]
  • US-052b (deferred): per-mutation audit sweep — pull into wave-7 or keep deferred?

▸ FORWARDED TO THIS WAVE (regression_risk, audience:coder/gate)
  • nil-account-collapse: any new mutation scoping where(account_id: current_account&.id)
    must guard `return respond_with_not_authorized if current_account.nil?`

▸ REPO CONVENTIONS IN PLAY (kmsat — from repos.json, promoted findings)
  • scoped-SDL introspection · field-collision resolver_method · account after_create seeding
  • shared dev/test DB — serial rspec only · per-changed-file specs, never full suite
  [full list: repos.json kmsat.conventions]

▸ NEXT ACTION: Wave 7 Phase A (10 stories, all kmsat, no mocks) → Phase B (4 gates)
  PAUSE configured: before Wave 8
```

**Payoff:** the handoff prompt collapses from ~80 lines to:

> Resume readiness-v2, begin wave 7. Ultracode on.

---

## Section 4 — Rollout, validation, migration

**Version 0.10.0, additive and non-breaking.** New `schema-changelog.json` entry,
`migration.breaking: false`; 0.9.0 epics resume cleanly (`findings[]` optional, absent = prior
behavior).

### Files touched

| File | Change |
|---|---|
| `references/epic-schema.json` | Add top-level `findings[]` (Section 1). |
| `references/wave-gate-report-schema.json` | Add optional `candidate_findings[]`. |
| `references/storage-protocol.md` | Document Resume Digest + `reconcileState()`; note `findings[]` as a durable epic slot. |
| `references/execution-protocol.md` | Capture rules, curation at wave-complete, promotion step. |
| `agents/orchestrator.md` | Escalation table: write finding before pausing; per-wave loop: curate at wave-complete; tools note. |
| `agents/wave-uat-agent.md`, `wave-ux-agent.md`, `wave-spec-compliance-agent.md`, `wave-code-review-agent.md` | "You may nominate `candidate_findings[]`" + schema skeleton. |
| `agents/coder.md` | `CANDIDATE_FINDINGS:` text block in report format. |
| `scripts/phase-gates/12.json` + new `12.0.10.0.json` | Phase-12 gate validates `findings[]` well-formedness *if present*; never requires it. |
| `scripts/validate-gate.js` | Already version-aware; loads `12.0.10.0.json` for 0.10.0+. |
| `references/state-machine.md` | One-line note: findings live in `epic.json`, not `state.json`. |
| `references/schema-changelog.json` | 0.10.0 entry. |

`state.json` has no schema file (governed by `state-machine.md` + validators), so removing
`deferred_findings` is a prose + migration change, not a schema edit.

### Validator stance

`findings[]` validation: **errors only on malformed entries that exist** (bad `id` pattern,
missing required field); never "you must have findings." Matches the changelog's established
rule that heuristic/optional content warns-or-is-silent, never false-fails an older epic. A wave
can legitimately produce zero findings.

### Migrating the live `readiness-v2` epic (the test case)

1. **Move** 19 `state.deferred_findings[]` → `epic.json.findings[]`. Existing fields carry 1:1
   (`id` already matches the pattern). Add `category` (nil-account cluster → `deferred_defect`;
   not-a-defect ones → keep `resolution: dismissed`), `audience` (defects → `[orchestrator, human]`),
   `wave_id` (parse from `source`).
2. **Forward** the live nil-account cluster (WAVE6-FINDING-001..005): `forward_to_waves: ["wave-7"]`
   so the digest flags it against wave-7's files on resume.
3. **Promote** durable kmsat rules from auto-memory into `repos.json` `kmsat.conventions`
   (`test_data_gotchas[]` / `grep_gotchas[]`): scoped-SDL, field-collision, account-seeding,
   owner-collapse, shared-DB-serial, no-full-suite, worker-positional, Zeitwerk-restart. After
   this they are epic data, not memory — loaded regardless of CWD.
4. **Remove** `state.deferred_findings[]`; bump `kryptonite_version` → `0.10.0`.
5. Run `validate-plan.js` + `validate-gate.js --phase 12` → confirm green.

## Open questions

None blocking. Promotion-confirmation UX (inline prompt vs. batched at wave-complete) can be
settled during implementation.
