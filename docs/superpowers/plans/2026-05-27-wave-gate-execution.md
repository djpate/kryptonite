# Wave-Gate Execution Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-story QA/Reviewer/CodeReview gates with four parallel wave-level gates (UAT, UX, spec compliance, code review), repo-registry-driven service lifecycle, and adaptive retry fix loop.

**Architecture:** Phase 12 splits into Phase A (parallel code production with fast merges, no validation) and Phase B (sequential wave validation with four parallel gate agents and an issue-by-issue fix loop). Worktrees: per-story for coding, wave-N for integration, main for testing. Repo registry's `testing` block tells the orchestrator how to start/stop services.

**Tech Stack:** Node.js ESM, AJV 2020-12 (existing), shell scripts for git worktree management, Markdown agent prompts.

---

## File Structure

### New Files

| Path | Responsibility |
|------|---------------|
| `skills/kryptonite/agents/wave-uat-agent.md` | Walks user journeys via Chrome MCP, produces uat report |
| `skills/kryptonite/agents/wave-ux-agent.md` | Compares implementation screenshots to approved mocks |
| `skills/kryptonite/agents/wave-spec-compliance-agent.md` | Verifies each story's AC items |
| `skills/kryptonite/agents/wave-code-review-agent.md` | Full code review of wave diff (security + correctness + quality) |
| `skills/kryptonite/references/wave-gate-report-schema.json` | JSON Schema 2020-12 validating all four gate report shapes |
| `skills/kryptonite/references/repos-schema.json` | JSON Schema for repos.json including the new `testing` block |
| `skills/kryptonite/scripts/worktree-manager.js` | Library: create/remove/list/cleanup worktrees + branches |
| `skills/kryptonite/scripts/service-runner.js` | Library: start/stop/healthcheck services per repos.json |
| `skills/kryptonite/scripts/validate-wave-gate-report.js` | Validate any of the four gate reports against shared schema |

### Modified Files

| Path | Changes |
|------|---------|
| `skills/kryptonite/references/plan-schema.json` | Add `waves[].user_journeys` (required), `wave_gate_config` (optional) |
| `skills/kryptonite/references/story-schema.json` | Drop `dod_validation`, `review_status`, `code_review_status`, `qa_status`; update status enum to `pending\|in_progress\|merged\|done\|blocked\|cancelled\|deferred` |
| `skills/kryptonite/scripts/validate-plan.js` | Add semantic check: every `user_journey.stories_covered[]` must reference stories in the same wave |
| `skills/kryptonite/agents/orchestrator.md` | Full rewrite for protocol v2 dispatch logic |
| `skills/kryptonite/references/execution-protocol.md` | Full rewrite for protocol v2 |
| `skills/kryptonite/SKILL.md` | Phase 12 instructions rewritten + version detection logic |

### Removed Files (deleted from agents/, but preserved on disk for legacy projects via protocol-version detection)

These files stay on disk but are no longer referenced by protocol v2:
- `skills/kryptonite/agents/qa.md`
- `skills/kryptonite/agents/reviewer.md`
- `skills/kryptonite/agents/code-reviewer.md`

---

## Task 1: Add `user_journeys` and `wave_gate_config` to plan-schema.json

**Files:**
- Modify: `skills/kryptonite/references/plan-schema.json`

- [ ] **Step 1: Read the current plan-schema.json**

```bash
cat skills/kryptonite/references/plan-schema.json | head -50
```

Confirm the structure: top-level required fields, `waves` array structure.

- [ ] **Step 2: Add `user_journeys` to wave required fields**

In `plan-schema.json`, find the `waves[]` items definition. The `required` array currently lists wave fields. Add `"user_journeys"` to that required array.

- [ ] **Step 3: Add `user_journeys` property definition**

Inside `waves[].properties`, add this property:

```json
"user_journeys": {
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "object",
    "required": ["id", "name", "stories_covered", "steps"],
    "additionalProperties": false,
    "properties": {
      "id": { "type": "string", "pattern": "^UJ-\\d{3}$" },
      "name": { "type": "string", "minLength": 5 },
      "stories_covered": {
        "type": "array",
        "minItems": 1,
        "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
      },
      "steps": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "required": ["action"],
          "additionalProperties": false,
          "properties": {
            "action": {
              "type": "string",
              "enum": ["navigate", "click", "fill", "assert_text", "assert_visible", "assert_url", "screenshot", "wait"]
            },
            "url": { "type": "string" },
            "selector": { "type": "string" },
            "value": { "type": "string" },
            "expect": { "type": "string" },
            "timeout_ms": { "type": "integer", "minimum": 0 }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Add top-level `wave_gate_config` property (optional)**

In top-level `properties`, add:

```json
"wave_gate_config": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "uat_enabled": { "type": "boolean", "default": true },
    "ux_enabled": { "type": "boolean", "default": true },
    "spec_compliance_enabled": { "type": "boolean", "default": true },
    "code_review_enabled": { "type": "boolean", "default": true },
    "max_fix_attempts": { "type": "integer", "minimum": 1, "maximum": 10, "default": 3 },
    "fix_strategies": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["same_coder_more_context", "different_coder_with_spike", "pause_for_user"]
      }
    }
  }
}
```

Do NOT add `wave_gate_config` to top-level `required`.

- [ ] **Step 5: Verify schema compiles**

Run:
```bash
node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/plan-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS');" --input-type=module
```

Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add skills/kryptonite/references/plan-schema.json
git commit -m "feat: add user_journeys and wave_gate_config to plan-schema"
```

---

## Task 2: Simplify story-schema.json for wave-gate model

**Files:**
- Modify: `skills/kryptonite/references/story-schema.json`

- [ ] **Step 1: Update the `status` enum**

Find `"status"` (around line 206). Change the enum from:
```json
"enum": ["pending", "in_progress", "qa_validation", "in_review", "done", "blocked", "cancelled", "deferred"]
```
to:
```json
"enum": ["pending", "in_progress", "merged", "done", "blocked", "cancelled", "deferred"]
```

- [ ] **Step 2: Remove `dod_validation` property**

Find the `"dod_validation"` property block (around line 213) and delete it entirely from `properties`.

- [ ] **Step 3: Remove `review_status` property**

Find the `"review_status"` property block (around line 217) and delete it entirely.

- [ ] **Step 4: Search for any other dropped fields**

Run: `grep -n 'qa_status\|code_review_status' skills/kryptonite/references/story-schema.json`

If found, delete those property blocks too.

- [ ] **Step 5: Add `merged_at` property**

Inside `properties`, add (after `started_at`):

```json
"merged_at": {
  "type": "string",
  "description": "ISO timestamp of when the story was merged into the wave branch."
}
```

- [ ] **Step 6: Verify schema compiles**

```bash
node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/story-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS');" --input-type=module
```

Expected: `PASS`

- [ ] **Step 7: Verify legacy fixture still validates**

The existing `agendadeck-launch` project may have stories with old status values. Run:

```bash
node skills/kryptonite/scripts/validate-gate.js --phase 11 --data-path skills/kryptonite/data/d440d6e555c5/agendadeck-launch 2>&1 | head -5
```

If this fails because old stories have status `"qa_validation"` or `"in_review"`, that's expected. Note this in the commit message — these fields are protocol-v1 and will be migrated by the protocol detection logic in Task 12.

- [ ] **Step 8: Commit**

```bash
git add skills/kryptonite/references/story-schema.json
git commit -m "feat: simplify story-schema for wave-gate model

Drops dod_validation, review_status, code_review_status, qa_status.
Updates status enum to: pending|in_progress|merged|done|blocked|cancelled|deferred.
Adds merged_at timestamp. Legacy projects use protocol v1 detection."
```

---

## Task 3: Create repos-schema.json

**Files:**
- Create: `skills/kryptonite/references/repos-schema.json`

- [ ] **Step 1: Write the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "KryptoniteReposRegistry",
  "description": "Schema for repos.json — the per-project repository registry. Each repo declares its location, stack, and (optionally) a structured testing block used by wave gates.",
  "type": "object",
  "required": ["repos"],
  "additionalProperties": false,
  "properties": {
    "repos": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["name", "path"],
        "additionalProperties": true,
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "path": { "type": "string", "minLength": 1 },
          "description": { "type": "string" },
          "stack": { "type": "string" },
          "run": { "type": "string" },
          "test": { "type": "string" },
          "testing_notes": { "type": "string" },
          "testing": {
            "type": "object",
            "required": ["start_command", "app_url"],
            "additionalProperties": false,
            "properties": {
              "start_command": {
                "type": "string",
                "minLength": 1,
                "description": "Shell command to start the service. Run from the repo's path. Should return promptly (background or detached) — orchestrator waits for ready_signal/health_check after."
              },
              "stop_command": {
                "type": "string",
                "description": "Shell command to stop the service. Optional — if missing, orchestrator does not stop services."
              },
              "health_check": {
                "type": "string",
                "description": "Shell command (typically curl) that exits 0 when the service is healthy. Polled by orchestrator after start."
              },
              "app_url": {
                "type": "string",
                "minLength": 1,
                "description": "Base URL the wave gates use for Chrome MCP and curl."
              },
              "ready_signal": {
                "type": "string",
                "description": "String the orchestrator looks for in start_command stdout to consider the service ready. Optional alternative to health_check."
              },
              "startup_timeout_ms": {
                "type": "integer",
                "minimum": 1000,
                "default": 30000,
                "description": "How long to wait for ready_signal/health_check before giving up."
              }
            }
          }
        }
      }
    }
  }
}
```

`additionalProperties: true` on each repo object preserves backward compatibility with existing repos.json files that have ad-hoc fields.

- [ ] **Step 2: Verify schema compiles**

```bash
node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/repos-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS');" --input-type=module
```

Expected: `PASS`

- [ ] **Step 3: Verify existing fixtures parse cleanly**

```bash
node -e "
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
const ajv = new (Ajv.default || Ajv)({strict:false});
addFormats.default ? addFormats.default(ajv) : addFormats(ajv);
const schema = JSON.parse(fs.readFileSync('skills/kryptonite/references/repos-schema.json','utf-8'));
const validate = ajv.compile(schema);
for (const f of [
  'skills/kryptonite/data/7147a468863c/repos.json',
  'skills/kryptonite/data/d440d6e555c5/repos.json',
]) {
  const data = JSON.parse(fs.readFileSync(f,'utf-8'));
  const ok = validate(data);
  console.log(f, ok ? 'PASS' : 'FAIL', ok ? '' : JSON.stringify(validate.errors));
}
" --input-type=module
```

Expected: Both files print `PASS`. Existing fields (`description`, `stack`, `run`, `test`, `testing_notes`) are allowed because the schema permits additional properties on repo objects.

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/references/repos-schema.json
git commit -m "feat: add repos-schema.json with optional testing block

Validates the per-project repos.json registry. The new optional 'testing'
block declares start_command, stop_command, health_check, app_url, and
ready_signal — used by wave gates to start/stop services."
```

---

## Task 4: Create wave-gate-report-schema.json

**Files:**
- Create: `skills/kryptonite/references/wave-gate-report-schema.json`

- [ ] **Step 1: Write the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "KryptoniteWaveGateReport",
  "description": "Schema validating any of the four wave gate report formats: uat, ux, spec_compliance, code_review.",
  "type": "object",
  "required": ["gate", "wave_id", "attempt", "status", "started_at", "completed_at", "issues"],
  "additionalProperties": false,
  "properties": {
    "gate": {
      "type": "string",
      "enum": ["uat", "ux", "spec_compliance", "code_review"]
    },
    "wave_id": { "type": "string", "pattern": "^wave-\\d+$" },
    "attempt": { "type": "integer", "minimum": 1 },
    "status": { "type": "string", "enum": ["pass", "fail"] },
    "started_at": { "type": "string", "format": "date-time" },
    "completed_at": { "type": "string", "format": "date-time" },
    "journeys": {
      "type": "array",
      "description": "UAT-only — per-journey results.",
      "items": {
        "type": "object",
        "required": ["id", "name", "status", "stories_covered", "steps"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^UJ-\\d{3}$" },
          "name": { "type": "string" },
          "status": { "type": "string", "enum": ["pass", "fail"] },
          "stories_covered": { "type": "array", "items": { "type": "string" } },
          "steps": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["step_index", "action", "passed"],
              "additionalProperties": false,
              "properties": {
                "step_index": { "type": "integer", "minimum": 0 },
                "action": { "type": "string" },
                "passed": { "type": "boolean" },
                "actual": { "type": "string" },
                "expected": { "type": "string" },
                "screenshot": { "type": "string" },
                "error": { "type": "string" }
              }
            }
          },
          "failure_reason": { "type": ["string", "null"] }
        }
      }
    },
    "comparisons": {
      "type": "array",
      "description": "UX-only — per-mocked-story comparisons.",
      "items": {
        "type": "object",
        "required": ["story_id", "status"],
        "additionalProperties": false,
        "properties": {
          "story_id": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "mock_path": { "type": "string" },
          "implementation_screenshot": { "type": "string" },
          "status": { "type": "string", "enum": ["match", "drift", "broken"] },
          "drift_categories": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": ["colors", "layout", "typography", "spacing", "missing_element", "extra_element", "responsive", "interaction"]
            }
          },
          "notes": { "type": "string" }
        }
      }
    },
    "story_results": {
      "type": "array",
      "description": "spec_compliance-only — per-story AC results.",
      "items": {
        "type": "object",
        "required": ["story_id", "ac_results", "all_passed"],
        "additionalProperties": false,
        "properties": {
          "story_id": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" },
          "ac_results": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["ac_index", "ac_text", "verification_method", "passed"],
              "additionalProperties": false,
              "properties": {
                "ac_index": { "type": "integer", "minimum": 0 },
                "ac_text": { "type": "string" },
                "verification_method": {
                  "type": "string",
                  "enum": ["curl", "test_suite", "chrome_mcp", "code_inspection", "skipped_no_testing_config"]
                },
                "verification_details": { "type": "string" },
                "passed": { "type": "boolean" },
                "actual": { "type": "string" },
                "expected": { "type": "string" }
              }
            }
          },
          "all_passed": { "type": "boolean" }
        }
      }
    },
    "findings": {
      "type": "array",
      "description": "code_review-only — full list of findings (all severities).",
      "items": {
        "type": "object",
        "required": ["id", "category", "severity", "file", "description"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^FINDING-\\d{3,}$" },
          "category": {
            "type": "string",
            "enum": ["security", "correctness", "error_handling", "dead_code", "performance", "style"]
          },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low"] },
          "file": { "type": "string" },
          "line": { "type": "integer", "minimum": 1 },
          "description": { "type": "string", "minLength": 5 },
          "suggested_fix": { "type": "string" }
        }
      }
    },
    "issues": {
      "type": "array",
      "description": "Blocking issues — only those that fail the gate (critical/high). Each has a dedup_key for the orchestrator's fix loop.",
      "items": {
        "type": "object",
        "required": ["id", "gate", "dedup_key", "description", "severity", "affected_stories"],
        "additionalProperties": true,
        "properties": {
          "id": { "type": "string", "pattern": "^ISSUE-\\d{3,}$" },
          "gate": {
            "type": "string",
            "enum": ["uat", "ux", "spec_compliance", "code_review"]
          },
          "dedup_key": { "type": "string", "minLength": 1 },
          "description": { "type": "string", "minLength": 5 },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low"] },
          "affected_stories": {
            "type": "array",
            "minItems": 1,
            "items": { "type": "string", "pattern": "^US-\\d{3,}[a-z]?$" }
          }
        }
      }
    }
  }
}
```

The schema permits gate-specific shape fields (`journeys`, `comparisons`, `story_results`, `findings`) without requiring them — each gate fills only its own field.

- [ ] **Step 2: Verify schema compiles**

```bash
node -e "import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats'; const ajv = new (Ajv.default || Ajv)({strict:false}); addFormats.default ? addFormats.default(ajv) : addFormats(ajv); const schema = JSON.parse(await import('fs').then(m=>m.readFileSync('skills/kryptonite/references/wave-gate-report-schema.json','utf-8'))); ajv.compile(schema); console.log('PASS');" --input-type=module
```

Expected: `PASS`

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/references/wave-gate-report-schema.json
git commit -m "feat: add wave-gate-report schema for all four gate output formats"
```

---

## Task 5: Add semantic check for user_journeys in validate-plan.js

**Files:**
- Modify: `skills/kryptonite/scripts/validate-plan.js`

- [ ] **Step 1: Read the current file to find the right insertion point**

```bash
grep -n "Risk linkage\|task story_ref\|semanticChecks" skills/kryptonite/scripts/validate-plan.js
```

The new check goes inside the `semanticChecks()` function, near the end (after task `story_ref` check).

- [ ] **Step 2: Add the user_journeys semantic check**

Inside `semanticChecks()`, add this block after the existing checks (just before the closing brace of the function):

```javascript
  // user_journeys: stories_covered must reference stories assigned to the same wave
  for (const wave of plan.waves) {
    const waveStories = new Set();
    for (const pg of wave.parallel_groups) {
      for (const sid of pg.stories) waveStories.add(sid);
    }
    for (const journey of (wave.user_journeys || [])) {
      for (const storyId of journey.stories_covered) {
        if (!waveStories.has(storyId)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}].user_journeys`,
            rule: "journey_story_coverage",
            message: `User journey '${journey.id}' covers story '${storyId}' which is not in wave '${wave.id}'`,
            suggestion: `Stories in this wave: ${[...waveStories].join(", ")}`,
          });
        }
      }
    }
  }
```

- [ ] **Step 3: Verify validators still work on existing fixtures**

```bash
node skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/minimal-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

This will now FAIL because minimal-plan.json doesn't have `user_journeys`. That's expected — the schema requires it. We update the fixture in Task 13.

- [ ] **Step 4: Verify the new check fires correctly**

Create `/tmp/test-bad-journey-plan.json`:

```bash
node -e "
import fs from 'fs';
const plan = JSON.parse(fs.readFileSync('skills/kryptonite/scripts/test-fixtures/minimal-plan.json','utf-8'));
plan.waves[0].user_journeys = [{
  id: 'UJ-001',
  name: 'Test journey',
  stories_covered: ['US-999'],
  steps: [{action: 'navigate', url: 'http://localhost:3000'}]
}];
fs.writeFileSync('/tmp/test-bad-journey-plan.json', JSON.stringify(plan));
" --input-type=module
node skills/kryptonite/scripts/validate-plan.js /tmp/test-bad-journey-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json | grep journey_story_coverage
```

Expected: matches the rule, error message says `'UJ-001' covers story 'US-999' which is not in wave 'wave-0'`.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/scripts/validate-plan.js
git commit -m "feat: add journey_story_coverage semantic check to validate-plan"
```

---

## Task 6: Create worktree-manager.js

**Files:**
- Create: `skills/kryptonite/scripts/worktree-manager.js`

- [ ] **Step 1: Write the module**

```javascript
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", stdio: opts.stdio ?? "pipe", ...opts }).trim();
}

function tryRun(cmd) {
  try {
    return { ok: true, output: run(cmd) };
  } catch (e) {
    return { ok: false, error: e.message, output: e.stdout?.toString() ?? "" };
  }
}

export function listWorktrees(repoPath) {
  const out = run("git worktree list --porcelain", { cwd: repoPath });
  const blocks = out.split("\n\n").filter(Boolean);
  return blocks.map(block => {
    const lines = block.split("\n");
    const wt = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(" ");
      wt[key] = rest.join(" ") || true;
    }
    return wt;
  });
}

export function createWorktree(repoPath, branchName, worktreePath, baseBranch) {
  const exists = fs.existsSync(worktreePath);
  if (exists) {
    return { ok: false, error: `Worktree path already exists: ${worktreePath}` };
  }
  // Create branch if it doesn't exist
  const branchExists = tryRun(`git -C "${repoPath}" rev-parse --verify ${branchName}`).ok;
  if (!branchExists) {
    const create = tryRun(`git -C "${repoPath}" branch ${branchName} ${baseBranch}`);
    if (!create.ok) return { ok: false, error: `Failed to create branch: ${create.error}` };
  }
  const add = tryRun(`git -C "${repoPath}" worktree add "${worktreePath}" ${branchName}`);
  if (!add.ok) return { ok: false, error: `Failed to add worktree: ${add.error}` };
  return { ok: true, path: worktreePath, branch: branchName };
}

export function removeWorktree(repoPath, worktreePath, opts = {}) {
  if (!fs.existsSync(worktreePath)) {
    return { ok: true, alreadyGone: true };
  }
  const force = opts.force ? "--force" : "";
  const result = tryRun(`git -C "${repoPath}" worktree remove ${force} "${worktreePath}"`);
  if (!result.ok && !opts.force) {
    return { ok: false, error: result.error, hint: "Try with force: true if uncommitted changes" };
  }
  if (!result.ok && opts.force) {
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

export function deleteBranch(repoPath, branchName, opts = {}) {
  const flag = opts.force ? "-D" : "-d";
  return tryRun(`git -C "${repoPath}" branch ${flag} ${branchName}`);
}

export function mergeBranch(repoPath, sourceBranch, opts = {}) {
  // No fast-forward — always create merge commit per design decision
  const message = opts.message ?? `Merge ${sourceBranch}`;
  const result = tryRun(`git -C "${repoPath}" merge --no-ff ${sourceBranch} -m "${message.replace(/"/g, '\\"')}"`);
  if (!result.ok) {
    // Detect conflict
    const status = tryRun(`git -C "${repoPath}" status --porcelain`);
    const hasConflicts = status.output.split("\n").some(l => l.startsWith("UU ") || l.startsWith("AA "));
    return { ok: false, conflict: hasConflicts, error: result.error };
  }
  return { ok: true };
}

export function findOrphanedWorktrees(repoPath, knownWorktreePaths) {
  const all = listWorktrees(repoPath);
  const known = new Set(knownWorktreePaths);
  return all.filter(wt => wt.worktree && wt.worktree !== repoPath && !known.has(wt.worktree));
}

export function cleanupOrphans(repoPath, orphanedPaths) {
  const results = [];
  for (const p of orphanedPaths) {
    const r = removeWorktree(repoPath, p, { force: true });
    results.push({ path: p, ...r });
  }
  return results;
}

// CLI mode for manual testing
if (import.meta.url === `file://${process.argv[1]}`) {
  const [_node, _script, cmd, ...args] = process.argv;
  const handlers = {
    list: ([repoPath]) => console.log(JSON.stringify(listWorktrees(repoPath), null, 2)),
    create: ([repoPath, branch, wtPath, base]) => console.log(JSON.stringify(createWorktree(repoPath, branch, wtPath, base), null, 2)),
    remove: ([repoPath, wtPath]) => console.log(JSON.stringify(removeWorktree(repoPath, wtPath, { force: true }), null, 2)),
  };
  const handler = handlers[cmd];
  if (!handler) {
    console.error(`Usage: node worktree-manager.js <list|create|remove> <args>`);
    process.exit(2);
  }
  handler(args);
}
```

- [ ] **Step 2: Verify the module exports load**

```bash
node -e "import('./skills/kryptonite/scripts/worktree-manager.js').then(m => console.log('Exports:', Object.keys(m).join(', ')))"
```

Expected: `Exports: listWorktrees, createWorktree, removeWorktree, deleteBranch, mergeBranch, findOrphanedWorktrees, cleanupOrphans`

- [ ] **Step 3: Smoke test list against this repo**

```bash
node skills/kryptonite/scripts/worktree-manager.js list /Users/christophev/.claude/plugins/kryptonite
```

Expected: prints JSON array with at least one entry (the main worktree).

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/scripts/worktree-manager.js
git commit -m "feat: add worktree-manager.js library for wave-gate orchestrator"
```

---

## Task 7: Create service-runner.js

**Files:**
- Create: `skills/kryptonite/scripts/service-runner.js`

- [ ] **Step 1: Write the module**

```javascript
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const runningServices = new Map();

export async function startService(repo, opts = {}) {
  if (!repo.testing?.start_command) {
    return { ok: false, skipped: true, reason: "no testing.start_command in repo" };
  }
  if (runningServices.has(repo.name)) {
    return { ok: true, alreadyRunning: true, name: repo.name };
  }
  const cwd = repo.path.replace(/^~/, process.env.HOME || "");
  if (!fs.existsSync(cwd)) {
    return { ok: false, error: `Repo path does not exist: ${cwd}` };
  }
  const child = spawn("sh", ["-c", repo.testing.start_command], {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", d => stdoutChunks.push(d.toString()));
  child.stderr.on("data", d => stderrChunks.push(d.toString()));

  runningServices.set(repo.name, { pid: child.pid, repo, child });

  // Wait for ready: ready_signal in stdout, OR health_check passes, OR timeout
  const timeout = repo.testing.startup_timeout_ms ?? 30000;
  const deadline = Date.now() + timeout;
  const readySignal = repo.testing.ready_signal;
  const healthCheck = repo.testing.health_check;

  while (Date.now() < deadline) {
    const stdout = stdoutChunks.join("");
    if (readySignal && stdout.includes(readySignal)) {
      return { ok: true, name: repo.name, pid: child.pid, readyVia: "signal" };
    }
    if (healthCheck) {
      try {
        execSync(healthCheck, { stdio: "pipe", timeout: 2000 });
        return { ok: true, name: repo.name, pid: child.pid, readyVia: "health_check" };
      } catch {
        // not ready yet, keep polling
      }
    }
    if (!readySignal && !healthCheck) {
      // No way to detect — wait a fixed amount, then return ok
      await sleep(2000);
      return { ok: true, name: repo.name, pid: child.pid, readyVia: "timeout_assumed" };
    }
    await sleep(1000);
  }

  return {
    ok: false,
    name: repo.name,
    error: `Service did not become ready within ${timeout}ms`,
    stdout_tail: stdoutChunks.join("").slice(-500),
    stderr_tail: stderrChunks.join("").slice(-500),
  };
}

export async function stopService(repoName) {
  const entry = runningServices.get(repoName);
  if (!entry) return { ok: true, notRunning: true };
  const { repo, child, pid } = entry;
  if (repo.testing?.stop_command) {
    try {
      const cwd = repo.path.replace(/^~/, process.env.HOME || "");
      execSync(repo.testing.stop_command, { cwd, stdio: "pipe", timeout: 10000 });
    } catch (e) {
      // Fall through to SIGTERM
    }
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch { /* already gone */ }
  runningServices.delete(repoName);
  return { ok: true, name: repoName };
}

export async function stopAll() {
  const names = [...runningServices.keys()];
  const results = [];
  for (const name of names) {
    results.push(await stopService(name));
  }
  return results;
}

export function listRunning() {
  return [...runningServices.entries()].map(([name, { pid, repo }]) => ({
    name,
    pid,
    app_url: repo.testing?.app_url,
  }));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Determine which repos a wave touches based on file_paths in tasks
export function reposForWave(wave, repos) {
  const repoMap = new Map(repos.map(r => [r.name, r]));
  const touched = new Set();
  for (const pg of wave.parallel_groups) {
    for (const task of pg.tasks) {
      for (const fp of task.file_paths) {
        // Match by repo path prefix
        for (const repo of repos) {
          const repoPath = repo.path.replace(/^~/, process.env.HOME || "");
          if (fp.startsWith(repoPath + "/") || fp.startsWith(repo.name + "/")) {
            touched.add(repo.name);
          }
        }
      }
    }
    for (const sid of pg.stories) {
      // Story-to-repo mapping comes from spec.json — caller should pass already-enriched data
    }
  }
  // Fallback: if no matches, use ALL repos with testing config (safe default)
  if (touched.size === 0) {
    for (const r of repos) {
      if (r.testing?.start_command) touched.add(r.name);
    }
  }
  return [...touched].map(n => repoMap.get(n)).filter(Boolean);
}
```

- [ ] **Step 2: Verify the module loads**

```bash
node -e "import('./skills/kryptonite/scripts/service-runner.js').then(m => console.log('Exports:', Object.keys(m).join(', ')))"
```

Expected: `Exports: startService, stopService, stopAll, listRunning, reposForWave`

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/service-runner.js
git commit -m "feat: add service-runner.js for repo-registry-driven start/stop"
```

---

## Task 8: Create validate-wave-gate-report.js

**Files:**
- Create: `skills/kryptonite/scripts/validate-wave-gate-report.js`

- [ ] **Step 1: Write the script**

```javascript
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const reportFile = positionals[0];

if (!reportFile) {
  console.error("Usage: node validate-wave-gate-report.js <path-to-report.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");
const schema = JSON.parse(fs.readFileSync(path.join(refsDir, "wave-gate-report-schema.json"), "utf-8"));
const report = JSON.parse(fs.readFileSync(reportFile, "utf-8"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const valid = validate(report);

if (!valid) {
  console.log(JSON.stringify({ valid: false, errors: validate.errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ valid: true }, null, 2));
process.exit(0);
```

- [ ] **Step 2: Verify it runs**

```bash
node skills/kryptonite/scripts/validate-wave-gate-report.js 2>&1 | head -1
```

Expected: `Usage: node validate-wave-gate-report.js <path-to-report.json>`

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/validate-wave-gate-report.js
git commit -m "feat: add validate-wave-gate-report.js"
```

---

## Task 9: Write wave-uat-agent.md prompt

**Files:**
- Create: `skills/kryptonite/agents/wave-uat-agent.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: wave-uat-agent
description: Wave-level UAT agent. Walks user journeys defined in plan.json via Chrome MCP, captures screenshots, asserts expectations, produces a structured report.
model: sonnet
---

# Wave UAT Agent

You verify user journeys for a completed wave. Services are already running. Your job is to walk every journey end-to-end and produce a structured report.

## Inputs

You will receive:

- **wave_id** (e.g., `wave-2`)
- **attempt** (integer ≥ 1)
- **user_journeys[]** (array of journey objects from plan.json)
- **app_urls** (object mapping repo name → base URL, from repos.json[].testing.app_url)
- **wave_dir** (filesystem path where you write your report)

## What to do

For each journey in `user_journeys`:

1. Resolve the base URL for the journey. If a step has a relative `url`, it's relative to the most recent navigated `app_url`.
2. Walk through `steps[]` in order using Chrome MCP tools (`mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`).
3. For each step:
   - Execute the action (`navigate`, `click`, `fill`, `assert_text`, `assert_visible`, `assert_url`, `screenshot`, `wait`)
   - Capture a screenshot to `<wave_dir>/gates/uat-<attempt>/<journey_id>-step-<index>.png`
   - Record actual vs. expected in the step result
   - If the step fails (expectation not met), mark the journey failed and stop walking that journey (move to next journey)
4. After all journeys: build the report.

## Output

Write JSON to `<wave_dir>/gates/uat-<attempt>.json` conforming to `references/wave-gate-report-schema.json` with `gate: "uat"`.

Required fields:
- `gate: "uat"`
- `wave_id`
- `attempt`
- `status: "pass"` or `"fail"`
- `started_at`, `completed_at` (ISO timestamps)
- `journeys[]` — per-journey result with steps[] and pass/fail
- `issues[]` — only failures, one per (journey_id, step_index) failure point

Issue format:
```json
{
  "id": "ISSUE-NNN",
  "gate": "uat",
  "dedup_key": "<journey_id>:<step_index>",
  "journey_id": "UJ-001",
  "step_index": 3,
  "description": "Submit button not visible after form fill",
  "severity": "critical",
  "affected_stories": ["US-002"],
  "screenshot": "<wave_dir>/gates/uat-<attempt>/<journey_id>-step-<index>.png"
}
```

`affected_stories` for an issue = the failed journey's `stories_covered`.

## Pass criterion

`status: "pass"` only if every journey's `status === "pass"`.

## Reporting back

Reply with:
- The path to the report file
- A one-line summary: e.g., "UAT pass — 5/5 journeys" or "UAT fail — 2 issues across 1 journey"

Do NOT exceed 200 words in your reply.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/agents/wave-uat-agent.md
git commit -m "feat: add wave-uat-agent prompt"
```

---

## Task 10: Write wave-ux-agent.md prompt

**Files:**
- Create: `skills/kryptonite/agents/wave-ux-agent.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: wave-ux-agent
description: Wave-level UX agent. Compares implementation screenshots against approved mocks for each story with has_mock=true, flags visual drift.
model: sonnet
---

# Wave UX Agent

You verify the implemented UI matches approved mocks for each mocked story in the wave.

## Inputs

You will receive:

- **wave_id**
- **attempt**
- **mocked_stories[]** (array of story objects with `has_mock: true` and the story's expected URL)
- **mocks_dir** (filesystem path to approved mock files)
- **app_urls** (repo name → base URL)
- **wave_dir** (filesystem path for your report and screenshots)

## What to do

For each story in `mocked_stories`:

1. Locate the approved mock at `<mocks_dir>/<story_id>-approved.html` (or the path indicated in the story's mock metadata).
2. Render the approved mock in Chrome MCP, screenshot to `<wave_dir>/gates/ux-<attempt>/<story_id>-mock.png`.
3. Navigate to the implementation URL in Chrome MCP (the URL exercising this story's UI). Screenshot to `<wave_dir>/gates/ux-<attempt>/<story_id>-actual.png`.
4. Compare the two screenshots:
   - Same overall layout? (sections in same positions)
   - Same color palette? (primary/accent/surface)
   - Same typography? (headings, body)
   - All elements from mock present in implementation?
   - Responsive behavior matches?
5. Categorize drift into `colors | layout | typography | spacing | missing_element | extra_element | responsive | interaction`.
6. Decide status:
   - `match` — minor pixel differences only
   - `drift` — visible but non-blocking differences (e.g., wrong shade of primary)
   - `broken` — major mismatch (missing critical elements, completely wrong layout)

## Output

Write JSON to `<wave_dir>/gates/ux-<attempt>.json` with `gate: "ux"`.

Required:
- `comparisons[]` — one per mocked story
- `issues[]` — one per `(story_id, drift_category)` where status is `broken` (severity: critical) or `drift` for critical color/layout (severity: critical) — minor drift produces no issue
- `dedup_key`: `<story_id>:<drift_category>`

## Pass criterion

`status: "pass"` only if no issues with severity `critical`. Minor drifts are reported in comparisons[] but don't block.

## Reporting back

Reply with the report path and a one-line summary. Under 200 words.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/agents/wave-ux-agent.md
git commit -m "feat: add wave-ux-agent prompt"
```

---

## Task 11: Write wave-spec-compliance-agent.md prompt

**Files:**
- Create: `skills/kryptonite/agents/wave-spec-compliance-agent.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: wave-spec-compliance-agent
description: Wave-level spec compliance agent. Verifies each story's acceptance_criteria items are satisfied — including AC items that user journeys don't exercise.
model: sonnet
---

# Wave Spec Compliance Agent

You verify each story in the wave actually implements its acceptance criteria. This catches AC items that user journeys don't cover.

## Inputs

You will receive:

- **wave_id**, **attempt**, **wave_dir**
- **stories[]** — every story merged into this wave, each with its `acceptance_criteria[]`
- **diff_summary** — list of files changed in the wave
- **app_urls** (per repo)
- **repos_with_testing[]** — names of repos that have `testing` blocks (others auto-fail chrome_mcp/curl methods)

## What to do

For each story, for each AC item:

1. Decide a verification method:
   - `code_inspection` — read the diff, confirm the change implements the AC
   - `curl` — issue HTTP request, check response
   - `test_suite` — run a targeted test command
   - `chrome_mcp` — drive the UI, verify behavior visible to user

   The story's `definition_of_done[]` may give hints — use those validation methods when present.

2. If the AC requires a running service (curl, chrome_mcp) and the relevant repo has no `testing` block:
   - Set `verification_method: "skipped_no_testing_config"`
   - Mark `passed: false` with the reason

3. Execute the verification. Record actual vs. expected.

4. Build per-story result with `all_passed: <true if every AC passed>`.

## Output

Write JSON to `<wave_dir>/gates/spec-compliance-<attempt>.json` with `gate: "spec_compliance"`.

Required:
- `story_results[]` — every story
- `issues[]` — one per (story_id, ac_index) where `passed: false`
  - dedup_key: `<story_id>:<ac_index>`
  - severity: `critical` if `verification_method !== "skipped_no_testing_config"`, else `medium` (skipped doesn't block but is reported)

## Pass criterion

`status: "pass"` only if every story's `all_passed === true`. Skipped ACs (no testing config) DON'T fail the gate — they produce medium-severity issues that surface but don't block. The user is responsible for running those manually.

## Reporting back

Report path + one-line summary. Under 200 words.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/agents/wave-spec-compliance-agent.md
git commit -m "feat: add wave-spec-compliance-agent prompt"
```

---

## Task 12: Write wave-code-review-agent.md prompt

**Files:**
- Create: `skills/kryptonite/agents/wave-code-review-agent.md`

- [ ] **Step 1: Write the agent prompt**

```markdown
---
name: wave-code-review-agent
description: Wave-level code review agent. Full review of the diff between wave-N and main — security, correctness, error handling, dead code, performance, style.
model: sonnet
---

# Wave Code Review Agent

You review the entire diff produced by a wave, checking for issues UAT and spec compliance can't see.

## Inputs

- **wave_id**, **attempt**, **wave_dir**
- **diff** — the unified diff between wave-N branch and main (provided as text or read via `git -C <repo> diff main..wave-N`)
- **changed_files[]** — list of paths
- **affected_stories[]** — story IDs whose changes are in this diff (for issue attribution)

## What to do

Review the diff across these categories. Be specific — every finding must cite a file:line.

1. **Security**
   - Hardcoded secrets/keys/passwords
   - SQL injection (string concatenation in queries)
   - XSS (unescaped user input rendered to HTML)
   - CSRF (state-changing routes without protection)
   - Auth bypass (missing authorization checks)
   - Dangerous defaults (e.g., debug enabled, public S3, weak crypto)
   - Missing input validation at trust boundaries

2. **Correctness**
   - Race conditions, missing locks
   - Off-by-one errors
   - Null/undefined handling gaps
   - Wrong async/await usage

3. **Error handling**
   - Silent catches (`catch {}` with no handling)
   - Swallowed errors (caught and ignored)
   - Missing retries for known-flaky operations
   - Errors thrown but not caught at boundaries

4. **Dead code**
   - Unreachable branches
   - Unused exports / imports
   - Commented-out code

5. **Performance**
   - N+1 queries
   - Sync I/O in hot paths
   - Missing indexes (when adding queries)
   - Unbounded loops or memory growth

6. **Style** — flag only egregious cases, no nitpicks

## Output

Write JSON to `<wave_dir>/gates/code-review-<attempt>.json` with `gate: "code_review"`.

Required:
- `findings[]` — every finding with severity (critical/high/medium/low)
- `issues[]` — only critical and high findings, deduped by `(file, line, category)`

Issue format:
```json
{
  "id": "ISSUE-NNN",
  "gate": "code_review",
  "dedup_key": "<file>:<line>:<category>",
  "description": "string",
  "severity": "critical | high",
  "affected_stories": ["<story_id>"]
}
```

`affected_stories` derived from which story modified the file/line (use git blame on diff if needed).

## Pass criterion

`status: "pass"` only if no `critical` and no `high` issues. Medium and low findings are reported in `findings[]` but don't fail the gate.

## Reporting back

Report path + one-line summary. Under 200 words.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/agents/wave-code-review-agent.md
git commit -m "feat: add wave-code-review-agent prompt"
```

---

## Task 13: Update test fixtures for new schemas

**Files:**
- Modify: `skills/kryptonite/scripts/test-fixtures/minimal-plan.json`
- Modify: `skills/kryptonite/scripts/test-fixtures/minimal-spec.json` (no changes expected, but verify)

- [ ] **Step 1: Add user_journeys to minimal-plan.json**

Open `skills/kryptonite/scripts/test-fixtures/minimal-plan.json`. Inside the wave-0 object, add:

```json
"user_journeys": [
  {
    "id": "UJ-001",
    "name": "List items via CLI",
    "stories_covered": ["US-001"],
    "steps": [
      { "action": "navigate", "url": "http://localhost:3000/items" },
      { "action": "assert_visible", "selector": ".item-list" },
      { "action": "screenshot" }
    ]
  }
]
```

- [ ] **Step 2: Verify both validators still pass**

```bash
node skills/kryptonite/scripts/validate-spec.js skills/kryptonite/scripts/test-fixtures/minimal-spec.json
node skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/minimal-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

Both must output `"valid": true`.

- [ ] **Step 3: Commit**

```bash
git add skills/kryptonite/scripts/test-fixtures/minimal-plan.json
git commit -m "test: add user_journeys to minimal plan fixture"
```

---

## Task 14: Add protocol version detection to validate-gate.js

**Files:**
- Modify: `skills/kryptonite/scripts/validate-gate.js`

- [ ] **Step 1: Read the file to understand current structure**

```bash
grep -n "execution_protocol_version\|isLegacyEpic" skills/kryptonite/scripts/validate-gate.js
```

There is no protocol version detection yet. We add it.

- [ ] **Step 2: Add protocol detection block**

After the existing version-check block (find `--- Version check ---`), add a new block:

```javascript
// --- Protocol version detection ---
const protocolVersion = state?.execution_protocol_version || "1.0";
const isProtocolV2 = protocolVersion.startsWith("2.");
if (isProtocolV2) {
  warnings.push(`Project uses execution protocol v${protocolVersion} (wave-gate model). Phase 12 checks adapt accordingly.`);
}
```

- [ ] **Step 3: Make Phase 12 check protocol-aware**

Find `if (phase >= 12)` (likely `checkStoryStatusInActiveWaves`). Wrap or branch the logic:

```javascript
  if (phase >= 12) {
    if (isProtocolV2) {
      checkWaveStatusV2();
    } else {
      checkStoryStatusInActiveWaves();
    }
  }
```

Add the new function `checkWaveStatusV2()`:

```javascript
function checkWaveStatusV2() {
  if (!state?.waves) return;
  for (const wave of state.waves) {
    if (wave.status === "in_progress" || wave.status === "gates_running") {
      // Verify all stories in the wave have valid v2 status
      for (const storyId of wave.stories || []) {
        const story = state.stories.find((s) => s.id === storyId);
        if (!story) continue;
        const validV2Statuses = ["pending", "in_progress", "merged", "done", "blocked", "cancelled", "deferred"];
        if (story.status && !validV2Statuses.includes(story.status)) {
          errors.push(`SEMANTIC stories[${storyId}].status: invalid v2 status "${story.status}" — expected one of ${validV2Statuses.join(", ")}`);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Verify gate still passes for legacy project**

```bash
node skills/kryptonite/scripts/validate-gate.js --phase 11 --data-path skills/kryptonite/data/d440d6e555c5/agendadeck-launch
```

Expected: `PASS: Phase 11 gate passed.` — legacy project has no `execution_protocol_version`, defaults to v1.

- [ ] **Step 5: Commit**

```bash
git add skills/kryptonite/scripts/validate-gate.js
git commit -m "feat: add protocol v2 detection to validate-gate"
```

---

## Task 15: Rewrite execution-protocol.md for v2

**Files:**
- Modify: `skills/kryptonite/references/execution-protocol.md`

- [ ] **Step 1: Replace the entire file with the v2 protocol**

Overwrite `skills/kryptonite/references/execution-protocol.md` with:

```markdown
# Kryptonite Execution Protocol — v2 (Wave-Gate Model)

This document defines Phase 12 (execution) for projects with `state.json.execution_protocol_version >= "2.0"`. Older projects continue using v1 (preserved in git history).

## State Machine

Each wave has two phases.

### Wave statuses
- `pending` — not yet started
- `in_progress` — Phase A coding underway
- `gates_running` — Phase B validation underway
- `complete` — all gates passed, advanced to next wave
- `blocked` — stuck after max_fix_attempts; user input required

### Story statuses (v2)
- `pending` — not yet dispatched
- `in_progress` — Coder dispatched, code being written
- `merged` — story branch merged into wave-N branch
- `done` — wave passed all gates; set retroactively when wave completes
- `blocked` — wave failed gates and user chose to defer this story
- `cancelled` — user cancelled
- `deferred` — moved to a later wave

## Phase A — Code Production

```
1. Set wave.status = "in_progress"
2. Create branch wave-N from current main worktree's branch
3. Create wave-N worktree at ../wave-N
4. For each parallel_group in wave.parallel_groups:
     For each story in group (parallel within group):
       - Create branch wave-N/US-XXX from wave-N
       - Create story worktree at ../wave-N-US-XXX
       - Dispatch Coder
       - Coder writes code + commits in story worktree
       - Coder reports DONE
     After all coders in group are DONE:
       - For each story branch:
           - Merge story branch → wave-N (merge commit, --no-ff)
           - On conflict: dispatch Coder back to story worktree to resolve, retry
           - Remove story worktree, delete story branch
           - story.status = "merged"
5. When all groups complete: Phase A done
```

## Phase B — Wave Validation

```
1. Merge wave-N → main worktree's working branch (merge commit)
2. Remove wave-N worktree, delete wave-N branch
3. Read repos.json for testing config of wave's affected repos
4. Start services per repos[].testing.start_command
5. Wait for ready_signal or health_check
6. Set wave.status = "gates_running"

7. Loop attempt = 1..max_fix_attempts:
     a. Determine gates to run:
          - First attempt: all four (UAT, UX, spec_compliance, code_review)
          - Subsequent: only previously-failed gates + any whose validated files were touched by the latest fix
     b. Dispatch the four gate agents in parallel
     c. Collect reports, write to wave-N/gates/<gate>-<attempt>.json
     d. If all gates pass:
          - Stop services
          - Mark all wave stories status: "done"
          - Set wave.status = "complete"
          - Break
     e. Collect open issues across failed gates (deduped per gate's dedup_key)
     f. For each open issue:
          - strategy = retry_strategy(len(issue.fix_attempts))
          - if strategy == "pause_for_user":
              surface to user, wait for response: fix manually | defer | replan | abort
          - else:
              dispatch fix per strategy
              merge fix → main worktree's branch
              if changed_files affects services:
                  restart affected services

8. If wave.status != "complete" after max attempts:
     surface to user for decision
```

## Adaptive Retry Strategies

| Attempt | Strategy | What happens |
|---------|----------|--------------|
| 1 | `same_coder_more_context` | Re-dispatch original Coder with story + AC + gate report excerpt + screenshots + suggested fix |
| 2 | `different_coder_with_spike` | Spawn Researcher to investigate root cause; spawn new Coder with findings + original issue |
| 3 | `pause_for_user` | Surface issue + history; user picks: fix | defer | replan | abort |

`max_fix_attempts` is configurable in `plan.wave_gate_config.max_fix_attempts` (default 3).

## Service Lifecycle

The orchestrator reads `repos.json[].testing` to know how to start/stop services. It is infrastructure-agnostic (works with marengo, docker-compose, foreman, npm, anything).

| When | Action |
|------|--------|
| Phase B start | `start_command` for each affected repo, wait for ready |
| Between fix attempts | If fix changed code files: stop+start affected service |
| Phase B complete | `stop_command` for each (skip if not provided) |
| User aborts | `stop_command` for all running services |

If a repo has no `testing` block:
- UAT skipped for journeys touching it (warning logged)
- UX skipped for stories in it with `has_mock: true`
- Spec compliance: AC items requiring chrome_mcp/curl auto-fail with reason "no testing config"; code_inspection/test_suite still run
- Code review unaffected

## Worktree Cleanup Guarantees

| Trigger | Action |
|---------|--------|
| Story merged | Remove story worktree + delete story branch |
| Wave Phase A complete | Remove wave-N worktree + delete wave-N branch |
| Wave complete | (already cleaned) |
| User aborts | Remove all non-main worktrees, record orphans in state.json |
| Cleanup command | Force-remove orphaned worktrees |

If `git worktree remove` fails, record path in `state.json.orphaned_worktrees[]` and continue. Cleanup command sweeps these later.

## Issue Tracking

Issues stored in `state.json.waves[N].gate_runs[]`. Each gate_run is immutable history.

```json
{
  "attempt": 1,
  "started_at": "ISO",
  "completed_at": "ISO",
  "uat": { "status": "fail", "report_path": "wave-2/gates/uat-1.json" },
  "ux": { "status": "pass", "report_path": "wave-2/gates/ux-1.json" },
  "spec_compliance": { "status": "pass", "report_path": "wave-2/gates/spec-compliance-1.json" },
  "code_review": { "status": "pass", "report_path": "wave-2/gates/code-review-1.json" },
  "issues": [{
    "id": "ISSUE-001",
    "gate": "uat",
    "dedup_key": "UJ-001:3",
    "description": "Submit button not visible",
    "severity": "critical",
    "affected_stories": ["US-005"],
    "fix_attempts": [{
      "attempt": 1,
      "strategy": "same_coder_more_context",
      "coder_id": "anthropic-sonnet",
      "started_at": "ISO",
      "completed_at": "ISO",
      "result": "fixed",
      "commit_sha": "abc123"
    }],
    "status": "resolved"
  }]
}
```

Issue IDs are stable within a wave. Re-runs append `fix_attempts[]`. Issues never re-use IDs.

## Pass criteria

A wave is `complete` when:
- All stories in the wave have status `merged`
- The latest gate_run has all four gate statuses: `pass` (or `skipped` for those without testing config — but that produces a warning, not a pass)
- No open critical or high severity issues

A wave is `blocked` when:
- After `max_fix_attempts` rounds, at least one critical/high issue is still open
- User has been paused at least once and chose not to fix/defer

## Migration from v1

`state.json` without `execution_protocol_version` defaults to v1. To migrate a project mid-flight, set `execution_protocol_version: "2.0"` and update story statuses to v2 enum values. The validator will warn but not fail.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/references/execution-protocol.md
git commit -m "feat: rewrite execution-protocol for v2 wave-gate model

Removes per-story QA/Reviewer/CodeReview gates. Adds Phase A
(parallel coding with fast merges) and Phase B (parallel wave gates
with adaptive retry). Repo registry drives service lifecycle."
```

---

## Task 16: Rewrite orchestrator.md for v2

**Files:**
- Modify: `skills/kryptonite/agents/orchestrator.md`

- [ ] **Step 1: Replace the file with v2 orchestrator instructions**

Overwrite `skills/kryptonite/agents/orchestrator.md` with:

```markdown
---
name: orchestrator
description: Phase 12 orchestrator for protocol v2. Drives wave-gate execution: parallel coding, single merge step, four parallel wave gates, adaptive retry fix loop. NOT a subagent — runs in the main session.
---

# Kryptonite Orchestrator — Protocol v2

You are the main session orchestrating Phase 12 execution for a kryptonite project using protocol v2.

## You are not an agent

The orchestrator is not a dispatched subagent. It runs in the main session. You read `state.json`, dispatch subagents (Coders, Researchers, gate agents), make merges, and write `state.json` back. Subagents don't write `state.json` — they only report results.

## Required reading before starting

1. `references/execution-protocol.md` — the v2 state machine
2. `plan.json` — the implementation plan (waves, parallel groups, tasks, user_journeys)
3. `state.json` — current execution state
4. `repos.json` — testing config per repo

## Per-Wave Loop

For each wave in `plan.json.waves` ordered by `sequence`:

### Phase A — Parallel coding

1. Skip if `wave.status === "complete"`
2. Set `wave.status = "in_progress"` in state.json
3. Create wave-N branch + wave-N worktree (use `scripts/worktree-manager.js` createWorktree)
4. For each parallel_group in wave:
   - For each story in the group, in parallel:
     - Create story branch wave-N/US-XXX from wave-N
     - Create story worktree at ../wave-N-US-XXX
     - Dispatch Coder agent (model: sonnet) with story context + worktree path
     - Wait for Coder DONE
   - Sequentially merge story branches into wave-N (merge --no-ff)
     - On conflict: dispatch Coder back to story worktree with conflict context, retry
     - On success: cleanup story worktree + branch, set story.status = "merged"
5. When all groups complete: proceed to Phase B

### Phase B — Wave gates

1. Merge wave-N → main worktree's branch (merge --no-ff)
2. Cleanup wave-N worktree + branch
3. Read `repos.json` for testing config of affected repos (use `scripts/service-runner.js` reposForWave)
4. Start services (`scripts/service-runner.js` startService)
5. Set `wave.status = "gates_running"`

6. Adaptive fix loop:
   ```
   gates_to_run = ["uat", "ux", "spec_compliance", "code_review"]
   for attempt in 1..max_fix_attempts:
     dispatch the gates_to_run agents in parallel (one Task call per gate)
     collect their reports
     write each report to wave-N/gates/<gate>-<attempt>.json
     validate each report against wave-gate-report-schema.json (use validate-wave-gate-report.js)
     update state.json.waves[N].gate_runs[] with this attempt
     if all gates passed:
       stop_services
       mark all wave stories status: "done"
       wave.status = "complete"
       break
     collect open issues
     for issue in issues:
       strategy = ["same_coder_more_context", "different_coder_with_spike", "pause_for_user"][issue.fix_attempts.length]
       if strategy == "pause_for_user":
         pause and ask user
       else:
         dispatch fix (Coder or Researcher+Coder)
         merge fix to main worktree's branch
         if affects_services(fix.changed_files):
           restart affected services
     gates_to_run = [gate for gate in gates if gate.status == "fail"]
   ```

7. If wave.status != "complete" after max_fix_attempts: surface to user

### Wave complete

1. All stories marked `done`
2. Cleanup any orphaned worktrees from this wave
3. Continue to next wave

## Dispatch templates

When dispatching gate agents, provide each with:
- wave_id
- attempt
- wave_dir (`<plugin-data-root>/<project>/<epic>/wave-N`)
- The gate-specific data the agent needs (see each agent's prompt)

When dispatching a fix Coder, provide:
- The original story + AC
- The gate report's issue (description, screenshot, suggested_fix)
- Instructions to fix locally and commit

When dispatching a Researcher (attempt 2), provide:
- The issue description + history of previous fix attempts
- Ask for a findings document explaining root cause

## Invariants

- Never write `done` to a story until its wave is `complete`
- Never advance to the next wave until current wave is `complete`
- Always validate gate reports against schema before trusting them
- Always cleanup worktrees on success; record orphans on failure
- Never run services in worktrees — only in main worktree

## Escalation

If a gate is blocked at attempt 3 and user chooses defer/replan/abort, follow user's instruction. Don't try to be clever and bypass.

If a service won't start, that's not a code problem — surface to user as infrastructure issue (does not count against fix attempts).

If `git worktree remove` fails, log to `state.json.orphaned_worktrees[]` and keep going.
```

- [ ] **Step 2: Commit**

```bash
git add skills/kryptonite/agents/orchestrator.md
git commit -m "feat: rewrite orchestrator.md for protocol v2"
```

---

## Task 17: Update SKILL.md Phase 12 instructions

**Files:**
- Modify: `skills/kryptonite/SKILL.md`

- [ ] **Step 1: Find Phase 12 section**

```bash
grep -n "Phase 12\|## Phase 12" skills/kryptonite/SKILL.md
```

- [ ] **Step 2: Read current Phase 12 content**

Read the Phase 12 section (use grep output line range) to confirm current text.

- [ ] **Step 3: Replace Phase 12 section**

Replace the entire Phase 12 section with:

```markdown
## Phase 12 — Execution

New projects use **protocol v2** (wave-gate model). Old projects continue with v1 (preserved in git history; v1 docs in `references/execution-protocol-v1.md` if needed).

**Set protocol version when entering Phase 12:** if `state.json.execution_protocol_version` is missing, set it to `"2.0"`.

### v2 in one paragraph

Phase 12 has two phases per wave. **Phase A** runs Coders in parallel (per-story worktrees), then merges story branches into the wave branch with NO validation between merges. **Phase B** merges the wave branch into the main worktree, starts services per `repos.json[].testing`, and runs four gate agents in parallel: UAT, UX, spec compliance, code review. If any fail, an adaptive fix loop runs (same Coder + context → Researcher + new Coder → pause for user). When all four gates pass, the wave is complete and all its stories become `done`.

### How to execute

Read `references/execution-protocol.md` for the full state machine. The orchestrator (the main session — see `agents/orchestrator.md`) drives the loop using:

- `scripts/worktree-manager.js` — create/remove worktrees + branches, merge with conflict handling
- `scripts/service-runner.js` — start/stop services per `repos.json[].testing`
- `scripts/validate-wave-gate-report.js` — validate gate report JSON

Gate agents (one Task call per gate, dispatched in parallel):
- `agents/wave-uat-agent.md` — Chrome MCP user journey walking
- `agents/wave-ux-agent.md` — mock vs implementation comparison
- `agents/wave-spec-compliance-agent.md` — per-story AC verification
- `agents/wave-code-review-agent.md` — full diff review

### Required preconditions

Before Phase 12:
- `repos.json` should have a `testing` block per repo that needs running services for UAT/UX. If absent, related gate checks are skipped with warnings — user is responsible for manual verification.
- `plan.json` waves must have `user_journeys[]` populated (validated by plan-schema).
```

- [ ] **Step 4: Commit**

```bash
git add skills/kryptonite/SKILL.md
git commit -m "feat: update SKILL.md Phase 12 for protocol v2"
```

---

## Task 18: Integration test — end-to-end fixture validation

**Files:**
- No new files. Verifies the whole chain.

- [ ] **Step 1: Validate plan fixture with new schema**

```bash
node skills/kryptonite/scripts/validate-plan.js skills/kryptonite/scripts/test-fixtures/minimal-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json
```

Expected: `"valid": true`. The minimal-plan.json now has `user_journeys`.

- [ ] **Step 2: Verify schema rejects plan without user_journeys**

```bash
node -e "
import fs from 'fs';
const plan = JSON.parse(fs.readFileSync('skills/kryptonite/scripts/test-fixtures/minimal-plan.json','utf-8'));
delete plan.waves[0].user_journeys;
fs.writeFileSync('/tmp/no-journeys-plan.json', JSON.stringify(plan));
" --input-type=module
node skills/kryptonite/scripts/validate-plan.js /tmp/no-journeys-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json | head -20
```

Expected: `"valid": false` with error indicating `user_journeys` missing or required.

- [ ] **Step 3: Verify journey_story_coverage semantic check fires**

```bash
node -e "
import fs from 'fs';
const plan = JSON.parse(fs.readFileSync('skills/kryptonite/scripts/test-fixtures/minimal-plan.json','utf-8'));
plan.waves[0].user_journeys[0].stories_covered = ['US-999'];
fs.writeFileSync('/tmp/bad-journey-plan.json', JSON.stringify(plan));
" --input-type=module
node skills/kryptonite/scripts/validate-plan.js /tmp/bad-journey-plan.json skills/kryptonite/scripts/test-fixtures/minimal-spec.json | grep journey_story_coverage
```

Expected: matches the rule.

- [ ] **Step 4: Validate sample wave gate report**

Create `/tmp/sample-uat-report.json`:

```bash
cat > /tmp/sample-uat-report.json <<'EOF'
{
  "gate": "uat",
  "wave_id": "wave-0",
  "attempt": 1,
  "status": "pass",
  "started_at": "2026-05-27T00:00:00Z",
  "completed_at": "2026-05-27T00:01:00Z",
  "journeys": [
    {
      "id": "UJ-001",
      "name": "List items via CLI",
      "status": "pass",
      "stories_covered": ["US-001"],
      "steps": [
        { "step_index": 0, "action": "navigate", "passed": true, "actual": "Loaded page" }
      ],
      "failure_reason": null
    }
  ],
  "issues": []
}
EOF

node skills/kryptonite/scripts/validate-wave-gate-report.js /tmp/sample-uat-report.json
```

Expected: `"valid": true`.

- [ ] **Step 5: Validate sample failing report has dedup_key**

```bash
cat > /tmp/sample-uat-fail.json <<'EOF'
{
  "gate": "uat",
  "wave_id": "wave-0",
  "attempt": 1,
  "status": "fail",
  "started_at": "2026-05-27T00:00:00Z",
  "completed_at": "2026-05-27T00:01:00Z",
  "journeys": [
    {
      "id": "UJ-001",
      "name": "List items via CLI",
      "status": "fail",
      "stories_covered": ["US-001"],
      "steps": [
        { "step_index": 0, "action": "navigate", "passed": false, "actual": "404", "expected": "200" }
      ],
      "failure_reason": "page not found"
    }
  ],
  "issues": [
    {
      "id": "ISSUE-001",
      "gate": "uat",
      "dedup_key": "UJ-001:0",
      "description": "navigate to /items returned 404",
      "severity": "critical",
      "affected_stories": ["US-001"],
      "journey_id": "UJ-001",
      "step_index": 0
    }
  ]
}
EOF

node skills/kryptonite/scripts/validate-wave-gate-report.js /tmp/sample-uat-fail.json
```

Expected: `"valid": true` (with the issue).

- [ ] **Step 6: Verify legacy gate validation still passes**

```bash
node skills/kryptonite/scripts/validate-gate.js --phase 11 --data-path skills/kryptonite/data/d440d6e555c5/agendadeck-launch
```

Expected: `PASS: Phase 11 gate passed.`

- [ ] **Step 7: No commit needed (verification only)**

If all checks pass, the integration is verified. If any fail, fix the offending file and re-run.
