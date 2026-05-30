import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const planFile = positionals[0];
const specFile = positionals[1];
const stateFile = positionals[2];

if (!planFile || !specFile) {
  console.error("Usage: node validate-plan.js <path-to-plan.json> <path-to-spec.json> [path-to-state.json]");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const plan = loadJSON(planFile);
const spec = loadJSON(specFile);
const state = stateFile ? loadJSON(stateFile) : null;
const planSchema = loadJSON(path.join(refsDir, "plan-schema.json"));

// --- Layer 1: Schema Validation ---
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(planSchema);
const valid = validate(plan);
const errors = [];
const warnings = [];

if (!valid) {
  for (const err of validate.errors) {
    errors.push({
      layer: "schema",
      path: err.instancePath || "/",
      rule: err.keyword,
      message: err.message || "validation failed",
      suggestion: err.params ? JSON.stringify(err.params) : undefined,
    });
  }
}

// --- Layer 2: Semantic Validation (cross-ref against spec) ---
function semanticChecks() {
  const specStoryIds = new Set(spec.stories.map((s) => s.id));
  const deferredStoryIds = new Set(
    spec.stories.filter((s) => s.status === "deferred" || s.status === "cancelled").map((s) => s.id)
  );
  const requiredStoryIds = new Set(
    [...specStoryIds].filter((id) => !deferredStoryIds.has(id))
  );

  const planStoryIds = new Set();
  const allTaskIds = new Set();
  const taskWaveMap = new Map();

  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      for (const storyId of pg.stories) {
        if (planStoryIds.has(storyId)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}]`,
            rule: "duplicate_story",
            message: `Story '${storyId}' appears in multiple parallel groups`,
            suggestion: "Each story must appear in exactly one parallel group across all waves",
          });
        }
        planStoryIds.add(storyId);
      }
      for (const task of pg.tasks) {
        if (allTaskIds.has(task.id)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}]`,
            rule: "duplicate_task_id",
            message: `Task ID '${task.id}' is duplicated`,
            suggestion: "Each task must have a unique ID",
          });
        }
        allTaskIds.add(task.id);
        taskWaveMap.set(task.id, wave.sequence);
      }
    }
  }

  // Story coverage
  for (const storyId of requiredStoryIds) {
    if (!planStoryIds.has(storyId)) {
      errors.push({
        layer: "semantic",
        path: "$.waves",
        rule: "story_coverage",
        message: `Spec story '${storyId}' is not assigned to any wave in the plan`,
        suggestion: "Add this story to an appropriate wave's parallel group",
      });
    }
  }

  // No phantom stories
  for (const storyId of planStoryIds) {
    if (!specStoryIds.has(storyId)) {
      errors.push({
        layer: "semantic",
        path: "$.waves",
        rule: "phantom_story",
        message: `Plan references story '${storyId}' which does not exist in spec`,
        suggestion: `Available story IDs: ${[...specStoryIds].slice(0, 10).join(", ")}...`,
      });
    }
  }

  // Wave DAG
  const waveSeqMap = new Map(plan.waves.map((w) => [w.id, w.sequence]));
  for (const wave of plan.waves) {
    for (const prereq of wave.prerequisites || []) {
      if (!waveSeqMap.has(prereq)) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].prerequisites`,
          rule: "wave_dag",
          message: `Wave '${wave.id}' has prerequisite '${prereq}' which does not exist`,
          suggestion: `Available waves: ${[...waveSeqMap.keys()].join(", ")}`,
        });
      } else if (waveSeqMap.get(prereq) >= wave.sequence) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].prerequisites`,
          rule: "wave_dag",
          message: `Wave '${wave.id}' (seq ${wave.sequence}) has prerequisite '${prereq}' (seq ${waveSeqMap.get(prereq)}) which is not earlier`,
          suggestion: "Prerequisites must have lower sequence numbers",
        });
      }
    }
  }

  // Task DAG
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      const taskIdsInGroup = new Set();
      for (const task of pg.tasks) {
        for (const dep of task.depends_on || []) {
          if (!allTaskIds.has(dep)) {
            errors.push({
              layer: "semantic",
              path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
              rule: "task_dag",
              message: `Task '${task.id}' depends on non-existent task '${dep}'`,
              suggestion: "depends_on must reference an existing task ID",
            });
          } else {
            const depWaveSeq = taskWaveMap.get(dep);
            if (depWaveSeq > wave.sequence) {
              errors.push({
                layer: "semantic",
                path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
                rule: "task_dag",
                message: `Task '${task.id}' (wave ${wave.sequence}) depends on '${dep}' in later wave (seq ${depWaveSeq})`,
                suggestion: "Tasks can only depend on tasks in prior or same wave",
              });
            } else if (depWaveSeq === wave.sequence && !taskIdsInGroup.has(dep)) {
              errors.push({
                layer: "semantic",
                path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
                rule: "task_dag",
                message: `Task '${task.id}' depends on '${dep}' which is in the same wave but a different parallel group`,
                suggestion: "Same-wave dependencies must be within the same parallel group (earlier in task order)",
              });
            }
          }
        }
        taskIdsInGroup.add(task.id);
      }
    }
  }

  // File conflict
  for (const wave of plan.waves) {
    const groupFiles = new Map();
    for (const pg of wave.parallel_groups) {
      const files = new Set();
      for (const task of pg.tasks) {
        for (const fp of task.file_paths) files.add(fp);
      }
      groupFiles.set(pg.id, files);
    }
    const pgIds = [...groupFiles.keys()];
    for (let i = 0; i < pgIds.length; i++) {
      for (let j = i + 1; j < pgIds.length; j++) {
        const filesA = groupFiles.get(pgIds[i]);
        const filesB = groupFiles.get(pgIds[j]);
        for (const f of filesA) {
          if (filesB.has(f)) {
            errors.push({
              layer: "semantic",
              path: `$.waves[${plan.waves.indexOf(wave)}]`,
              rule: "file_conflict",
              message: `Parallel groups '${pgIds[i]}' and '${pgIds[j]}' in wave '${wave.id}' both touch file '${f}'`,
              suggestion: "Move one of the conflicting tasks to a different wave or merge the groups",
            });
          }
        }
      }
    }
  }

  // Demo coverage
  for (const wave of plan.waves) {
    const waveStories = new Set();
    for (const pg of wave.parallel_groups) {
      for (const sid of pg.stories) waveStories.add(sid);
    }
    for (const validateId of wave.demo_checkpoint.validates) {
      if (!waveStories.has(validateId)) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${plan.waves.indexOf(wave)}].demo_checkpoint.validates`,
          rule: "demo_coverage",
          message: `Demo checkpoint in wave '${wave.id}' validates story '${validateId}' which is not in this wave`,
          suggestion: `Stories in this wave: ${[...waveStories].join(", ")}`,
        });
      }
    }
  }

  // Risk linkage
  for (const [idx, risk] of plan.risks.entries()) {
    for (const storyId of risk.affected_stories) {
      if (!specStoryIds.has(storyId)) {
        errors.push({
          layer: "semantic",
          path: `$.risks[${idx}].affected_stories`,
          rule: "risk_reference",
          message: `Risk '${risk.id}' references non-existent story '${storyId}'`,
          suggestion: "Use a story ID that exists in spec.json",
        });
      }
    }
  }

  // Task story_ref must match stories in the same parallel group
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      const pgStorySet = new Set(pg.stories);
      for (const task of pg.tasks) {
        if (!pgStorySet.has(task.story_ref)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${plan.waves.indexOf(wave)}].parallel_groups`,
            rule: "task_story_ref",
            message: `Task '${task.id}' has story_ref '${task.story_ref}' not in its parallel group's stories [${pg.stories.join(", ")}]`,
            suggestion: "task.story_ref must reference a story within the same parallel group",
          });
        }
      }
    }
  }

  // Wave-assignment cross-check: state.json story.wave must match the plan wave that places it
  // Plans store wave IDs as `wave-\d+` and a numeric `sequence`; state.json stories store an
  // integer `wave`. The two must agree on the wave that owns each story. If state.json wasn't
  // provided, this check is skipped (Phase 11 may run validate-plan before state.json is fully
  // populated — that's fine; the check is enforced when both files exist).
  if (state && Array.isArray(state.stories)) {
    const stateWaveByStory = new Map();
    for (const s of state.stories) {
      if (typeof s.wave === "number") stateWaveByStory.set(s.id, s.wave);
    }
    for (const wave of plan.waves) {
      const planSeq = wave.sequence;
      for (const pg of wave.parallel_groups) {
        for (const storyId of pg.stories) {
          if (!stateWaveByStory.has(storyId)) continue; // covered by phantom_story / story_coverage above
          const stateSeq = stateWaveByStory.get(storyId);
          if (stateSeq !== planSeq) {
            errors.push({
              layer: "semantic",
              path: `$.waves[${plan.waves.indexOf(wave)}]`,
              rule: "wave_assignment_mismatch",
              message: `Story '${storyId}' is placed in plan wave '${wave.id}' (sequence ${planSeq}) but state.json records story.wave = ${stateSeq}`,
              suggestion: "state.json is the source of truth for story.wave (see references/state-machine.md). Update either the plan placement or state.json so they agree.",
            });
          }
        }
      }
    }
  }

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

  // shared_artifacts[] reconciliation manifest consistency
  // Build a story → wave.sequence map and a per-story blocking-group lookup.
  const storyWaveSeq = new Map();
  const blockingStories = new Set();
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      for (const storyId of pg.stories) {
        storyWaveSeq.set(storyId, wave.sequence);
        if (pg.blocking === true) blockingStories.add(storyId);
      }
    }
  }

  for (const wave of plan.waves) {
    const wIdx = plan.waves.indexOf(wave);
    for (const [aIdx, artifact] of (wave.shared_artifacts || []).entries()) {
      const owner = artifact.owner_story;
      // owner must exist somewhere in the plan
      if (!storyWaveSeq.has(owner)) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${wIdx}].shared_artifacts[${aIdx}].owner_story`,
          rule: "shared_artifact_owner_missing",
          message: `shared_artifact '${artifact.name}' names owner_story '${owner}' which is not assigned to any wave`,
          suggestion: "owner_story must be a story placed in this wave or an earlier one",
        });
        continue;
      }
      const ownerSeq = storyWaveSeq.get(owner);
      // owner must not be in a later wave than the one declaring the artifact
      if (ownerSeq > wave.sequence) {
        errors.push({
          layer: "semantic",
          path: `$.waves[${wIdx}].shared_artifacts[${aIdx}].owner_story`,
          rule: "shared_artifact_owner_too_late",
          message: `shared_artifact '${artifact.name}' is declared in wave '${wave.id}' (seq ${wave.sequence}) but its owner_story '${owner}' is in a later wave (seq ${ownerSeq})`,
          suggestion: "The artifact's owner must land no later than the wave that declares it",
        });
      }
      // each reuser must exist and must not precede the owner
      for (const reuser of (artifact.reused_by || [])) {
        if (!storyWaveSeq.has(reuser)) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${wIdx}].shared_artifacts[${aIdx}].reused_by`,
            rule: "shared_artifact_reuser_missing",
            message: `shared_artifact '${artifact.name}' lists reused_by story '${reuser}' which is not assigned to any wave`,
            suggestion: "Every reused_by story must exist in the plan",
          });
          continue;
        }
        if (storyWaveSeq.get(reuser) < ownerSeq) {
          errors.push({
            layer: "semantic",
            path: `$.waves[${wIdx}].shared_artifacts[${aIdx}].reused_by`,
            rule: "shared_artifact_reuser_precedes_owner",
            message: `shared_artifact '${artifact.name}': reuser '${reuser}' (seq ${storyWaveSeq.get(reuser)}) is in an earlier wave than its owner '${owner}' (seq ${ownerSeq}) — a reuser cannot precede its creator`,
            suggestion: "Move the reuser to the owner's wave or later, or change the owner",
          });
        }
      }
      // soft: owner should be in a blocking group so it lands before reusers dispatch
      if (!blockingStories.has(owner)) {
        warnings.push({
          layer: "semantic",
          path: `$.waves[${wIdx}].shared_artifacts[${aIdx}].owner_story`,
          rule: "shared_artifact_owner_not_blocking",
          message: `shared_artifact '${artifact.name}' owner '${owner}' is not in a blocking parallel group — its reusers may dispatch before it lands`,
          suggestion: "Place the owner story in a parallel group with `blocking: true` so it merges before non-blocking groups dispatch (see references/execution-protocol.md)",
        });
      }
    }
  }

  // Phantom-reference (unreconciled) warning. The reconciliation hazard from the field
  // (finding #13) is specifically when *two or more stories share a concept neither creates*
  // — they each invent a divergent version. So we only warn when the SAME namespaced
  // CamelCase reference (e.g. Foo::Bar, Types::X) appears across >=2 distinct stories AND
  // no shared_artifacts entry declares it. A single story naming a class is almost always an
  // existing/external dependency (e.g. Aws::BedrockRuntime::Client) — not a reconciliation
  // risk — so single-story refs are intentionally NOT flagged. Heuristic; warning only,
  // never a hard error. The Plan Critic makes the judgment call (agents/plan-critic.md).
  const declaredArtifactNames = new Set();
  for (const wave of plan.waves) {
    for (const artifact of (wave.shared_artifacts || [])) {
      declaredArtifactNames.add(artifact.name);
    }
  }
  const NAMESPACED = /\b([A-Z][A-Za-z0-9]+(?:::[A-Z][A-Za-z0-9]+)+)\b/g;
  const specStoryById = new Map(spec.stories.map((s) => [s.id, s]));
  // ref → Set(storyIds that mention it)
  const refToStories = new Map();
  for (const wave of plan.waves) {
    for (const pg of wave.parallel_groups) {
      for (const storyId of pg.stories) {
        const story = specStoryById.get(storyId);
        if (!story) continue;
        const haystacks = [
          ...(story.acceptance_criteria || []),
          ...((story.definition_of_done || []).map((d) => d.description || "")),
        ];
        const refsInStory = new Set();
        for (const text of haystacks) {
          for (const m of String(text).matchAll(NAMESPACED)) refsInStory.add(m[1]);
        }
        for (const ref of refsInStory) {
          if (!refToStories.has(ref)) refToStories.set(ref, new Set());
          refToStories.get(ref).add(storyId);
        }
      }
    }
  }
  for (const [ref, storyIds] of refToStories) {
    if (declaredArtifactNames.has(ref)) continue;
    if (storyIds.size < 2) continue; // single-story ref ≈ existing/external dependency
    warnings.push({
      layer: "semantic",
      path: "$.waves",
      rule: "unreconciled_reference",
      message: `'${ref}' is referenced by ${storyIds.size} stories (${[...storyIds].join(", ")}) but no shared_artifacts entry declares an owner. If it doesn't already exist, those stories may each create a divergent version.`,
      suggestion: `If '${ref}' is shared and new, add it to the relevant wave's shared_artifacts[] with one owner_story; if it already exists in the codebase, ignore this warning.`,
    });
  }
}

if (spec.stories && plan.waves) {
  semanticChecks();
}

// --- Output ---
const output = { valid: errors.length === 0, errors, warnings };
console.log(JSON.stringify(output, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
