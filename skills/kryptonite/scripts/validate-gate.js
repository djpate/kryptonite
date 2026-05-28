import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    phase: { type: "string" },
    "data-path": { type: "string" },
  },
});

const phase = parseInt(values.phase, 10);
const dataPath = values["data-path"];

if (!phase || !dataPath) {
  console.error("Usage: node validate-gate.js --phase <N> --data-path <path-to-epic-dir>");
  process.exit(2);
}

const scriptsDir = path.dirname(new URL(import.meta.url).pathname);
const gatesDir = path.join(scriptsDir, "phase-gates");
const refsDir = path.join(scriptsDir, "..", "references");

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

const epic = loadJSON(path.join(dataPath, "epic.json"));
const state = loadJSON(path.join(dataPath, "state.json"));
const projectDir = path.resolve(dataPath, "..");
const reposFile = loadJSON(path.join(projectDir, "repos.json"));
// repos.json can be { repos: [...] } or a plain array
const repos = Array.isArray(reposFile) ? reposFile : reposFile?.repos ?? null;

// Read current kryptonite version from package.json
const pluginRoot = path.resolve(scriptsDir, "..", "..", "..");
const packageJson = loadJSON(path.join(pluginRoot, "package.json"));
const currentVersion = packageJson?.version || "0.0.0";
const epicVersion = epic?.kryptonite_version || null;

const schemaFile = path.join(gatesDir, `${String(phase).padStart(2, "0")}.json`);
if (!fs.existsSync(schemaFile)) {
  console.error(`No gate schema found for phase ${phase}: ${schemaFile}`);
  process.exit(2);
}

const schema = loadJSON(schemaFile);
const storySchema = loadJSON(path.join(refsDir, "story-schema.json"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

if (storySchema) {
  ajv.addSchema(storySchema, "story-schema.json");
}

const errors = [];
const warnings = [];

// --- Version check ---
const isLegacyEpic = !epicVersion;
if (isLegacyEpic) {
  warnings.push(`Epic has no kryptonite_version — created before version tracking. Some checks for newer fields will be skipped. Add kryptonite_version to epic.json to enable full validation.`);
} else if (epicVersion !== currentVersion) {
  warnings.push(`Epic was created with kryptonite v${epicVersion} (current: v${currentVersion}). Check references/schema-changelog.json for migration steps if gate checks fail.`);
}

// --- Protocol version detection ---
const protocolVersion = state?.execution_protocol_version || "1.0";
const isProtocolV2 = protocolVersion.startsWith("2.");
if (isProtocolV2) {
  warnings.push(`Project uses execution protocol v${protocolVersion} (wave-gate model). Phase 12 checks adapt accordingly.`);
}

// --- Schema validation ---
// For legacy epics (no version), use a relaxed schema variant if available
const relaxedSchemaFile = path.join(gatesDir, `${String(phase).padStart(2, "0")}-legacy.json`);
const schemaToUse = isLegacyEpic && fs.existsSync(relaxedSchemaFile) ? loadJSON(relaxedSchemaFile) : schema;
const wrapper = { epic, state, repos };
const validate = ajv.compile(schemaToUse);
const valid = validate(wrapper);

if (!valid) {
  for (const err of validate.errors) {
    const fieldPath = err.instancePath || "/";
    const msg = err.message || "validation failed";
    const detail = err.params ? JSON.stringify(err.params) : "";
    errors.push(`SCHEMA ${fieldPath}: ${msg}${detail ? " " + detail : ""}`);
  }
}

// --- Semantic validation (phase-dependent) ---

function semanticChecks() {
  if (phase >= 5) checkSpikeFiles();
  if (phase >= 8) checkCrossReferences();
  if (phase >= 9) checkNoCycles();
  if (phase >= 10) {
    if (!fs.existsSync(path.join(dataPath, "spec.json")) && !fs.existsSync(path.join(dataPath, "spec.html"))) {
      errors.push(`SEMANTIC filesystem: neither "spec.json" nor "spec.html" found — one is required`);
    }
    checkFileExists("spec-versions.json");
  }
  if (phase >= 11) {
    if (!fs.existsSync(path.join(dataPath, "plan.json")) && !fs.existsSync(path.join(dataPath, "plan.html"))) {
      errors.push(`SEMANTIC filesystem: neither "plan.json" nor "plan.html" found — one is required`);
    }
    checkWaveOrder();
  }
  if (phase >= 12) {
    if (isProtocolV2) {
      checkWaveStatusV2();
    } else {
      checkStoryStatusInActiveWaves();
    }
  }
}

function checkSpikeFiles() {
  if (!state?.stories) return;
  const spikes = state.stories.filter((s) => s.type === "spike");
  for (const spike of spikes) {
    const spikesDir = path.join(dataPath, "spikes");
    if (!fs.existsSync(spikesDir)) {
      errors.push(`SEMANTIC spikes/: directory missing but spike stories exist`);
      return;
    }
    const files = fs.readdirSync(spikesDir);
    const hasFile = files.some((f) => f.startsWith(spike.id));
    if (!hasFile) {
      errors.push(`SEMANTIC spikes/${spike.id}*: no findings file for spike ${spike.id}`);
    }
  }
}

function checkCrossReferences() {
  if (!state?.stories || !epic) return;
  const partyNames = (epic.parties || []).map((p) => p.name);
  const repoNames = (repos || []).map((r) => r.name);

  for (const story of state.stories) {
    if (story.party && !partyNames.includes(story.party)) {
      errors.push(`SEMANTIC stories[${story.id}].party: "${story.party}" not found in epic.json parties [${partyNames.join(", ")}]`);
    }
    if (story.repo && repoNames.length > 0 && !repoNames.includes(story.repo)) {
      errors.push(`SEMANTIC stories[${story.id}].repo: "${story.repo}" not found in repos.json [${repoNames.join(", ")}]`);
    }
  }
}

function checkNoCycles() {
  if (!state?.stories) return;
  const storyMap = new Map(state.stories.map((s) => [s.id, s]));
  const visited = new Set();
  const inStack = new Set();

  function dfs(id, chain) {
    if (inStack.has(id)) {
      errors.push(`SEMANTIC dependencies: circular dependency detected: ${[...chain, id].join(" → ")}`);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    inStack.add(id);
    const story = storyMap.get(id);
    if (story?.dependencies) {
      for (const dep of story.dependencies) {
        if (!storyMap.has(dep)) {
          errors.push(`SEMANTIC stories[${id}].dependencies: references non-existent story "${dep}"`);
        } else {
          dfs(dep, [...chain, id]);
        }
      }
    }
    inStack.delete(id);
  }

  for (const story of state.stories) {
    dfs(story.id, []);
  }
}

function checkWaveOrder() {
  if (!state?.stories) return;
  const storyMap = new Map(state.stories.map((s) => [s.id, s]));

  for (const story of state.stories) {
    if (story.wave == null || !story.dependencies) continue;
    for (const depId of story.dependencies) {
      const dep = storyMap.get(depId);
      if (!dep || dep.wave == null) continue;
      if (dep.wave >= story.wave) {
        errors.push(`SEMANTIC stories[${story.id}].wave: dependency "${depId}" is in wave ${dep.wave} but ${story.id} is in wave ${story.wave} (deps must be in earlier waves)`);
      }
    }
  }
}

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

function checkStoryStatusInActiveWaves() {
  if (!state?.stories || !state?.waves) return;
  const activeWaves = state.waves.filter((w) => w.status === "in_progress");
  for (const wave of activeWaves) {
    for (const storyId of wave.stories || []) {
      const story = state.stories.find((s) => s.id === storyId);
      if (!story) continue;
      if (!story.status) {
        errors.push(`SEMANTIC stories[${storyId}].status: missing status field but wave "${wave.id}" is in_progress — must be set to a valid state machine value`);
      } else if (story.status === "pending") {
        errors.push(`SEMANTIC stories[${storyId}].status: is "pending" but wave "${wave.id}" is in_progress — should be "in_progress" or later once wave execution begins`);
      }
    }
  }
}

function checkFileExists(filename) {
  const filePath = path.join(dataPath, filename);
  if (!fs.existsSync(filePath)) {
    errors.push(`SEMANTIC filesystem: required file "${filename}" not found`);
  }
}

semanticChecks();

// --- Output ---
if (warnings.length > 0) {
  for (const warn of warnings) {
    console.log(`  ⚠ ${warn}`);
  }
  console.log("");
}

if (errors.length === 0) {
  console.log(`PASS: Phase ${phase} gate passed.`);
  process.exit(0);
} else {
  console.log(`FAIL: Phase ${phase} gate failed with ${errors.length} error(s):\n`);
  for (const err of errors) {
    console.log(`  ✗ ${err}`);
  }
  process.exit(1);
}
