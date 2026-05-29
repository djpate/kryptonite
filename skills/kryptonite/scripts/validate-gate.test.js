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
  const epic = { ...baseEpic, kryptonite_version: "0.9.0", findings: [{ id: "BADID" }] };
  const { dir, epicDir } = makeEpicDir(epic, baseState);
  try {
    const { code } = runGate(epicDir);
    assert.equal(code, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
