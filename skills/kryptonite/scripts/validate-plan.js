import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const planFile = positionals[0];
const specFile = positionals[1];

if (!planFile || !specFile) {
  console.error("Usage: node validate-plan.js <path-to-plan.json> <path-to-spec.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const plan = loadJSON(planFile);
const spec = loadJSON(specFile);
const planSchema = loadJSON(path.join(refsDir, "plan-schema.json"));

// --- Layer 1: Schema Validation ---
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validate = ajv.compile(planSchema);
const valid = validate(plan);
const errors = [];

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
}

if (spec.stories && plan.waves) {
  semanticChecks();
}

// --- Output ---
const output = { valid: errors.length === 0, errors };
console.log(JSON.stringify(output, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
