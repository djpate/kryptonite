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
