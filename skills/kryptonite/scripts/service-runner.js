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
