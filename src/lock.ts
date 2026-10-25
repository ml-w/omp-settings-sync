import fs from "node:fs/promises";
import path from "node:path";
import type { Ctx, Deps } from "./config.js";
import { dirOf } from "./config.js";

const inProcessMutex = new Map<string, Promise<void>>();

export async function acquireInProcessMutex(dir: string): Promise<() => void> {
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = inProcessMutex.get(dir) ?? Promise.resolve();
  inProcessMutex.set(dir, current.then(() => next));
  await current;
  return () => {
    release();
  };
}

export function stateDir(dir: string): string {
  return path.join(dir, ".git-sync");
}

export function lockPath(dir: string): string {
  return path.join(stateDir(dir), "lock");
}

export function isSubagentChild(): boolean {
  if (Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0) return true;
  if (Number(process.env.OMP_SUBAGENT_DEPTH ?? "0") > 0) return true;
  if (process.env.OMP_IS_SUBAGENT === "true" || process.env.OMP_IS_SUBAGENT === "1") return true;
  return false;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

export async function withLock<T>(ctx: Ctx, fn: () => Promise<T>, deps?: Deps): Promise<T | undefined> {
  const dir = dirOf(deps);
  await fs.mkdir(stateDir(dir), { recursive: true });
  const lock = lockPath(dir);

  // 1. Acquire in-process mutex to prevent concurrent async calls in same process
  const releaseInProcess = await acquireInProcessMutex(dir);

  try {
    // 2. Acquire cross-process file lock
    try {
      const handle = await fs.open(lock, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await handle.close();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockRaw = await fs.readFile(lock, "utf8");
        const lockData: unknown = JSON.parse(lockRaw);
        if (
          lockData &&
          typeof lockData === "object" &&
          "pid" in lockData &&
          typeof lockData.pid === "number" &&
          "startedAt" in lockData &&
          typeof lockData.startedAt === "string"
        ) {
          if (lockData.pid !== process.pid && isProcessAlive(lockData.pid)) {
            if (Date.now() - Date.parse(lockData.startedAt) < 600_000) {
              return undefined;
            }
          }
        }
      } catch {}
      await fs.rm(lock, { force: true });
      const handle = await fs.open(lock, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      await handle.close();
    }

    try {
      return await fn();
    } finally {
      await fs.rm(lock, { force: true });
    }
  } finally {
    releaseInProcess();
  }
}

