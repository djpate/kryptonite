import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDetachedCheckout, applyPatch } from "./worktree-manager.js";

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-test-"));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  const g = (cmd) => execSync(cmd, { cwd: repo, encoding: "utf-8" });
  g("git init -q");
  g("git config user.email t@t.test");
  g("git config user.name Test");
  fs.writeFileSync(path.join(repo, "a.txt"), "line1\n");
  g("git add a.txt");
  g("git commit -qm initial");
  return { dir, repo, g };
}

test("createDetachedCheckout creates a worktree at a ref with no branch", () => {
  const { dir, repo } = tmpRepo();
  const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
  const coPath = path.join(dir, "checkout-1");
  const res = createDetachedCheckout(repo, coPath, head);
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(coPath, "a.txt")), true);
  const coHead = execSync("git rev-parse HEAD", { cwd: coPath, encoding: "utf-8" }).trim();
  assert.equal(coHead, head);
  const branch = execSync("git symbolic-ref -q HEAD || true", { cwd: coPath, encoding: "utf-8" }).trim();
  assert.equal(branch, "");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("createDetachedCheckout fails if path already exists", () => {
  const { dir, repo } = tmpRepo();
  const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
  const coPath = path.join(dir, "exists");
  fs.mkdirSync(coPath);
  const res = createDetachedCheckout(repo, coPath, head);
  assert.equal(res.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

function makePatch(repo, dir, name, mutate) {
  const head = execSync("git rev-parse HEAD", { cwd: repo, encoding: "utf-8" }).trim();
  const co = path.join(dir, `gen-${name}`);
  createDetachedCheckout(repo, co, head);
  const g = (cmd) => execSync(cmd, { cwd: co, encoding: "utf-8" });
  mutate(co, g);
  g("git add -A");
  g(`git commit -qm "story ${name}"`);
  const patch = execSync(`git format-patch ${head}..HEAD --stdout`, { cwd: co, encoding: "utf-8" });
  const patchPath = path.join(dir, `${name}.patch`);
  fs.writeFileSync(patchPath, patch);
  return patchPath;
}

test("applyPatch applies a clean patch onto the mount", () => {
  const { dir, repo } = tmpRepo();
  const p = makePatch(repo, dir, "clean", (co) => {
    fs.writeFileSync(path.join(co, "b.txt"), "new file\n");
  });
  const res = applyPatch(repo, p);
  assert.equal(res.ok, true);
  assert.equal(fs.existsSync(path.join(repo, "b.txt")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("applyPatch reports conflict and leaves no in-progress am on overlap", () => {
  const { dir, repo, g } = tmpRepo();
  const p1 = makePatch(repo, dir, "one", (co) => {
    fs.writeFileSync(path.join(co, "a.txt"), "EDIT-ONE\n");
  });
  const p2 = makePatch(repo, dir, "two", (co) => {
    fs.writeFileSync(path.join(co, "a.txt"), "EDIT-TWO\n");
  });
  assert.equal(applyPatch(repo, p1).ok, true);
  const res = applyPatch(repo, p2);
  assert.equal(res.ok, false);
  assert.equal(res.conflict, true);
  assert.equal(fs.existsSync(path.join(repo, ".git", "rebase-apply")), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
