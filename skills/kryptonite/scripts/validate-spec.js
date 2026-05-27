import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { positionals } = parseArgs({ allowPositionals: true });
const specFile = positionals[0];

if (!specFile) {
  console.error("Usage: node validate-spec.js <path-to-spec.json>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

const spec = loadJSON(specFile);
const specSchema = loadJSON(path.join(refsDir, "spec-schema.json"));
const storySchema = loadJSON(path.join(refsDir, "story-schema.json"));

// --- Layer 1: Schema Validation ---
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(storySchema, "story-schema.json");

const validate = ajv.compile(specSchema);
const valid = validate(spec);
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

// --- Layer 2: Semantic Validation ---
function semanticChecks() {
  const componentIds = new Set(spec.architecture.components.map((c) => c.id));
  const repoIds = new Set(spec.repos.map((r) => r.id));
  const partyIds = new Set(spec.parties.map((p) => p.id));
  const entityIds = new Set(spec.data_model.entities.map((e) => e.id));
  const storyIds = new Set(spec.stories.map((s) => s.id));

  // 1. Component connectivity: every component in at least one interaction
  const interactedComponents = new Set();
  for (const i of spec.architecture.interactions) {
    interactedComponents.add(i.from);
    interactedComponents.add(i.to);
  }
  for (const c of spec.architecture.components) {
    if (!interactedComponents.has(c.id)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.components[${spec.architecture.components.indexOf(c)}]`,
        rule: "component_connectivity",
        message: `Component '${c.id}' does not appear in any interaction`,
        suggestion: `Add an interaction involving '${c.id}' or remove the component`,
      });
    }
  }

  // 2. Interaction refs: from/to must be valid component IDs
  for (const [idx, i] of spec.architecture.interactions.entries()) {
    if (!componentIds.has(i.from)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.interactions[${idx}].from`,
        rule: "component_reference",
        message: `Interaction references non-existent component '${i.from}'`,
        suggestion: `Available components: ${[...componentIds].join(", ")}`,
      });
    }
    if (!componentIds.has(i.to)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.interactions[${idx}].to`,
        rule: "component_reference",
        message: `Interaction references non-existent component '${i.to}'`,
        suggestion: `Available components: ${[...componentIds].join(", ")}`,
      });
    }
  }

  // 3. Repo references in components
  for (const [idx, c] of spec.architecture.components.entries()) {
    if (!repoIds.has(c.repo)) {
      errors.push({
        layer: "semantic",
        path: `$.architecture.components[${idx}].repo`,
        rule: "repo_reference",
        message: `Component '${c.id}' references repo '${c.repo}' which does not exist`,
        suggestion: `Available repos: ${[...repoIds].join(", ")}`,
      });
    }
  }

  // 4. Party references in stories
  for (const [idx, s] of spec.stories.entries()) {
    if (!partyIds.has(s.party)) {
      errors.push({
        layer: "semantic",
        path: `$.stories[${idx}].party`,
        rule: "party_reference",
        message: `Story '${s.id}' references party '${s.party}' which does not exist`,
        suggestion: `Available parties: ${[...partyIds].join(", ")}`,
      });
    }
  }

  // 5. Repo references in stories
  for (const [idx, s] of spec.stories.entries()) {
    if (!repoIds.has(s.repo)) {
      errors.push({
        layer: "semantic",
        path: `$.stories[${idx}].repo`,
        rule: "repo_reference",
        message: `Story '${s.id}' references repo '${s.repo}' which does not exist`,
        suggestion: `Available repos: ${[...repoIds].join(", ")}`,
      });
    }
  }

  // 6. Dependency DAG: no cycles
  const visited = new Set();
  const inStack = new Set();
  function dfs(id, chain) {
    if (inStack.has(id)) {
      errors.push({
        layer: "semantic",
        path: `$.stories`,
        rule: "dependency_dag",
        message: `Circular dependency: ${[...chain, id].join(" → ")}`,
        suggestion: "Remove one dependency to break the cycle",
      });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    const story = spec.stories.find((s) => s.id === id);
    if (story?.dependencies) {
      for (const dep of story.dependencies) {
        if (!storyIds.has(dep)) {
          errors.push({
            layer: "semantic",
            path: `$.stories[${spec.stories.indexOf(story)}].dependencies`,
            rule: "dependency_reference",
            message: `Story '${id}' depends on non-existent story '${dep}'`,
            suggestion: `Available story IDs: ${[...storyIds].slice(0, 10).join(", ")}...`,
          });
        } else {
          dfs(dep, [...chain, id]);
        }
      }
    }
    inStack.delete(id);
  }
  for (const s of spec.stories) dfs(s.id, []);

  // 7. Entity relationship targets
  for (const [eIdx, entity] of spec.data_model.entities.entries()) {
    for (const [rIdx, rel] of (entity.relationships || []).entries()) {
      if (!entityIds.has(rel.target)) {
        errors.push({
          layer: "semantic",
          path: `$.data_model.entities[${eIdx}].relationships[${rIdx}].target`,
          rule: "entity_reference",
          message: `Entity '${entity.id}' relationship targets non-existent entity '${rel.target}'`,
          suggestion: `Available entities: ${[...entityIds].join(", ")}`,
        });
      }
    }
  }

  // 8. Spike coverage: every spike story has a spike_findings entry
  const spikeStories = spec.stories.filter((s) => s.type === "spike");
  const spikeFindings = new Set((spec.spike_findings || []).map((f) => f.story_id));
  for (const spike of spikeStories) {
    if (!spikeFindings.has(spike.id)) {
      errors.push({
        layer: "semantic",
        path: `$.spike_findings`,
        rule: "spike_coverage",
        message: `Spike story '${spike.id}' has no corresponding spike_findings entry`,
        suggestion: `Add a spike_findings entry with story_id: '${spike.id}'`,
      });
    }
  }

  // 9. Open question block references
  for (const [idx, oq] of (spec.open_questions || []).entries()) {
    for (const blockRef of oq.blocks) {
      if (!storyIds.has(blockRef) && !componentIds.has(blockRef)) {
        errors.push({
          layer: "semantic",
          path: `$.open_questions[${idx}].blocks`,
          rule: "open_question_reference",
          message: `Open question '${oq.id}' blocks reference '${blockRef}' which is neither a story nor a component`,
          suggestion: "Use a valid story ID (US-NNN) or component ID",
        });
      }
    }
  }
}

// Only run semantic checks if spec is structurally valid enough
if (spec.stories && spec.architecture && spec.repos && spec.parties && spec.data_model) {
  semanticChecks();
}

// --- Output ---
const output = { valid: errors.length === 0, errors };
console.log(JSON.stringify(output, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
