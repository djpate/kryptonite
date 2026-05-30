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

const rawPhase = values.phase;
const dataPath = values["data-path"];

if (!rawPhase || !dataPath) {
  console.error("Usage: node validate-gate.js --phase <N> --data-path <path-to-epic-dir>");
  console.error("       Phase may be an integer (e.g. 8) or a fractional inter-phase gate (e.g. 7.5)");
  process.exit(2);
}

// Phase may be an integer (8 → 08.json) or a fractional inter-phase gate
// (7.5 → 07_5.json). Internally we keep `phase` as a number for the
// semantic-check ordering logic; `phaseFile` is just the filename slug.
const phase = Number(rawPhase);
if (!Number.isFinite(phase) || phase <= 0) {
  console.error(`Invalid --phase value: ${rawPhase}`);
  process.exit(2);
}

function phaseFilename(p) {
  if (Number.isInteger(p)) return String(p).padStart(2, "0");
  // Fractional → split int+frac and join with underscore (7.5 → "07_5").
  const [intPart, fracPart] = String(p).split(".");
  return `${intPart.padStart(2, "0")}_${fracPart}`;
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

const phaseSlug = phaseFilename(phase);
const schemaFile = path.join(gatesDir, `${phaseSlug}.json`);
if (!fs.existsSync(schemaFile)) {
  console.error(`No gate schema found for phase ${phase}: ${schemaFile}`);
  process.exit(2);
}

const schema = loadJSON(schemaFile);
const storySchema = loadJSON(path.join(refsDir, "story-schema.json"));
const epicSchema = loadJSON(path.join(refsDir, "epic-schema.json"));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

if (storySchema) {
  ajv.addSchema(storySchema, "story-schema.json");
}
if (epicSchema) {
  ajv.addSchema(epicSchema, "epic-schema.json");
}

// Schemas suffixed with a version (e.g. 03.0.6.0.json) hold the *additional*
// requirements introduced at that version. They are applied on top of the base
// gate when the epic was created on that version or later. Older epics aren't
// held to newer requirements — they keep passing on the schema they were
// created under.
function compareSemver(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

const supplementalSchemas = [];
if (epicVersion) {
  const phasePrefix = `${phaseSlug}.`;
  const candidates = fs.readdirSync(gatesDir)
    .filter((f) => f.startsWith(phasePrefix) && f.endsWith(".json") && f !== `${phaseSlug}.json`);

  for (const candidate of candidates) {
    const versionPart = candidate.slice(phasePrefix.length, -".json".length);
    if (/^\d+\.\d+\.\d+$/.test(versionPart) && compareSemver(epicVersion, versionPart) >= 0) {
      const supplemental = loadJSON(path.join(gatesDir, candidate));
      if (supplemental) {
        supplementalSchemas.push({ version: versionPart, schema: supplemental });
      }
    }
  }
  // Sort by version ascending so error messages are deterministic.
  supplementalSchemas.sort((a, b) => compareSemver(a.version, b.version));
}

const errors = [];
const warnings = [];

// --- Version check ---
if (epicVersion && epicVersion !== currentVersion) {
  warnings.push(`Epic was created with kryptonite v${epicVersion} (current: v${currentVersion}). Check references/schema-changelog.json for migration steps if gate checks fail.`);
}

// --- Schema validation ---
const wrapper = { epic, state, repos };

function runSchema(schemaToRun, label) {
  const validate = ajv.compile(schemaToRun);
  const valid = validate(wrapper);
  if (!valid) {
    for (const err of validate.errors) {
      const fieldPath = err.instancePath || "/";
      const msg = err.message || "validation failed";
      const detail = err.params ? JSON.stringify(err.params) : "";
      errors.push(`SCHEMA${label ? ` (${label})` : ""} ${fieldPath}: ${msg}${detail ? " " + detail : ""}`);
    }
  }
}

runSchema(schema);
for (const { version, schema: supplemental } of supplementalSchemas) {
  runSchema(supplemental, `v${version}+`);
}

// --- Semantic validation (phase-dependent) ---

function semanticChecks() {
  if (phase >= 5) checkSpikeFiles();
  if (phase >= 8) checkCrossReferences();
  if (phase >= 9) checkNoCycles();
  if (phase >= 10) {
    checkFileExists("spec.json");
    checkFileExists("spec-versions.json");
  }
  if (phase >= 11) {
    checkFileExists("plan.json");
    checkWaveOrder();
  }
  if (phase >= 12) checkWaveStatus();
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

function checkWaveStatus() {
  if (!state?.waves) return;
  const validStoryStatuses = ["pending", "in_progress", "merged", "done", "blocked", "cancelled", "deferred"];
  for (const wave of state.waves) {
    if (wave.status === "in_progress" || wave.status === "gates_running") {
      for (const storyId of wave.stories || []) {
        const story = state.stories.find((s) => s.id === storyId);
        if (!story) continue;
        if (story.status && !validStoryStatuses.includes(story.status)) {
          errors.push(`SEMANTIC stories[${storyId}].status: invalid status "${story.status}" — expected one of ${validStoryStatuses.join(", ")}`);
        }
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
