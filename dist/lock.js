import fs from "node:fs/promises";
import path from "node:path";
import { dirOf, readConfig, resolveSyncSchedule } from "./config.js";
import { isSyncableRepo } from "./git.js";
export const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES = 1;
export const DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES = 5;
const inProcessMutex = new Map();
export async function acquireInProcessMutex(dir) {
    let release = () => { };
    const next = new Promise((resolve) => {
        release = resolve;
    });
    const current = inProcessMutex.get(dir) ?? Promise.resolve();
    inProcessMutex.set(dir, current.then(() => next));
    await current;
    return () => {
        release();
    };
}
export function stateDir(dir) {
    return path.join(dir, ".git-sync");
}
export function lockPath(dir) {
    return path.join(stateDir(dir), "lock");
}
export function statePath(dir) {
    return path.join(stateDir(dir), "state.json");
}
export function isSubagentChild() {
    if (Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0)
        return true;
    if (Number(process.env.OMP_SUBAGENT_DEPTH ?? "0") > 0)
        return true;
    if (process.env.OMP_IS_SUBAGENT === "true" || process.env.OMP_IS_SUBAGENT === "1")
        return true;
    return false;
}
export async function readSyncState(dir) {
    try {
        const raw = await fs.readFile(statePath(dir), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            return parsed;
        }
        return {};
    }
    catch {
        return {};
    }
}
export async function writeSyncState(state, dir = dirOf()) {
    await fs.mkdir(stateDir(dir), { recursive: true });
    const current = await readSyncState(dir);
    const next = { ...current, ...state };
    await fs.writeFile(statePath(dir), JSON.stringify(next, null, 2) + "\n");
}
export async function shouldAutoSync(deps) {
    const dir = dirOf(deps);
    if (isSubagentChild() || !(await isSyncableRepo(dir)))
        return false;
    const state = await readSyncState(dir);
    if (!state.lastAutoSyncAt)
        return true;
    const schedule = resolveSyncSchedule(await readConfig(deps));
    const intervalMs = schedule.autoSyncIntervalMinutes * 60_000;
    return Date.now() - Date.parse(state.lastAutoSyncAt) >= intervalMs;
}
export async function shouldCheckRemote(deps, minIntervalMinutes) {
    const dir = dirOf(deps);
    const state = await readSyncState(dir);
    if (!state.lastRemoteCheckAt)
        return true;
    const minutes = minIntervalMinutes ?? resolveSyncSchedule(await readConfig(deps)).remoteCheckIntervalMinutes;
    const intervalMs = minutes * 60_000;
    return Date.now() - Date.parse(state.lastRemoteCheckAt) >= intervalMs;
}
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === "EPERM") {
            return true;
        }
        return false;
    }
}
export async function withLock(ctx, fn, deps) {
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
        }
        catch (error) {
            if (error.code !== "EEXIST")
                throw error;
            try {
                const lockRaw = await fs.readFile(lock, "utf8");
                const lockData = JSON.parse(lockRaw);
                if (lockData &&
                    typeof lockData === "object" &&
                    "pid" in lockData &&
                    typeof lockData.pid === "number" &&
                    "startedAt" in lockData &&
                    typeof lockData.startedAt === "string") {
                    if (lockData.pid !== process.pid && isProcessAlive(lockData.pid)) {
                        if (Date.now() - Date.parse(lockData.startedAt) < 600_000) {
                            return undefined;
                        }
                    }
                }
            }
            catch { }
            await fs.rm(lock, { force: true });
            const handle = await fs.open(lock, "wx");
            await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
            await handle.close();
        }
        try {
            return await fn();
        }
        finally {
            await fs.rm(lock, { force: true });
        }
    }
    finally {
        releaseInProcess();
    }
}
//# sourceMappingURL=lock.js.map