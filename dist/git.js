import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { dirOf } from "./config.js";
const exec = promisify(execFile);
export function gitEnv(dir) {
    const ceiling = path.dirname(path.resolve(dir)).replaceAll("\\", "/");
    return {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CEILING_DIRECTORIES: ceiling,
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "omp-sync",
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "sync@omp.sh",
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "omp-sync",
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "sync@omp.sh",
    };
}
export async function cleanStaleIndexLock(dir, maxAgeMs = 15_000) {
    const lockFile = path.join(dir, ".git", "index.lock");
    try {
        const stats = await fs.stat(lockFile);
        if (Date.now() - stats.mtimeMs >= maxAgeMs) {
            await fs.rm(lockFile, { force: true });
        }
    }
    catch { }
}
export async function git(args, dir, timeout = 15_000) {
    if (args.some((a) => ["add", "commit", "rebase", "merge", "reset", "checkout", "pull", "push"].includes(a))) {
        await cleanStaleIndexLock(dir);
    }
    return exec("git", args, {
        cwd: dir,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        env: gitEnv(dir),
    });
}
export async function gitRaw(args, dir) {
    return exec("git", args, {
        cwd: dir,
        timeout: 15_000,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "buffer",
        env: gitEnv(dir),
    });
}
export async function hasDotGit(dir) {
    try {
        await fs.access(path.join(dir, ".git"));
        return true;
    }
    catch {
        return false;
    }
}
export async function hasCommits(dir) {
    try {
        await git(["rev-parse", "HEAD"], dir);
        return true;
    }
    catch {
        return false;
    }
}
export async function isSyncableRepo(dir = dirOf()) {
    if (!(await hasDotGit(dir)))
        return false;
    try {
        const { stdout } = await git(["remote"], dir);
        return stdout.split(/\r?\n/).includes("origin");
    }
    catch {
        return false;
    }
}
export async function upstreamRef(dir) {
    try {
        return (await git(["rev-parse", "--abbrev-ref", "@{u}"], dir)).stdout.trim();
    }
    catch {
        return undefined;
    }
}
export async function countAheadBehind(upstream, dir) {
    const { stdout } = await git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], dir);
    const [behind = "0", ahead = "0"] = stdout.trim().split(/\s+/);
    return { behind: Number(behind), ahead: Number(ahead) };
}
export async function fetchOrigin(dir) {
    try {
        await git(["fetch", "origin"], dir);
        return true;
    }
    catch {
        return false;
    }
}
export async function isRemoteReachable(dir) {
    try {
        await git(["ls-remote", "--heads", "origin"], dir, 8000);
        return true;
    }
    catch {
        return false;
    }
}
export async function integrateUpstream(upstream, dir) {
    try {
        await git(["merge", "--ff-only", upstream], dir);
        return true;
    }
    catch { }
    try {
        await git(["rebase", upstream], dir);
        return true;
    }
    catch {
        try {
            await git(["rebase", "--abort"], dir);
        }
        catch { }
        return false;
    }
}
export async function pushOrigin(first = false, dir) {
    try {
        await git(["push", "-u", "origin", "HEAD"], dir, 20_000);
        return true;
    }
    catch {
        return false;
    }
}
import { memoryHasChanges } from "./memory.js";
import { getVaultStatus, hasSensitiveChanges } from "./vault.js";
export async function hasLocalChanges(dir = dirOf()) {
    try {
        const { stdout } = await git(["status", "--porcelain"], dir);
        if (stdout.trim().length > 0)
            return true;
        if (await memoryHasChanges(dir))
            return true;
        const vaultStatus = await getVaultStatus(dir);
        if (vaultStatus === "unlocked") {
            return await hasSensitiveChanges(dir);
        }
        return false;
    }
    catch {
        return false;
    }
}
export async function hasRemoteChanges(dir = dirOf()) {
    try {
        if (!(await fetchOrigin(dir)))
            return false;
        const upstream = await upstreamRef(dir);
        if (!upstream)
            return false;
        const { ahead, behind } = await countAheadBehind(upstream, dir);
        return ahead > 0 || behind > 0;
    }
    catch {
        return false;
    }
}
export async function hasAnyChanges(dir = dirOf(), checkRemote = true) {
    if (await hasLocalChanges(dir))
        return true;
    if (!checkRemote)
        return false;
    return await hasRemoteChanges(dir);
}
export async function getConflictState(dir) {
    let inRebase = false;
    let inMerge = false;
    const conflictedFiles = [];
    for (const rebaseDir of [".git/rebase-merge", ".git/rebase-apply"]) {
        try {
            await fs.access(path.join(dir, rebaseDir));
            inRebase = true;
            break;
        }
        catch { }
    }
    try {
        await fs.access(path.join(dir, ".git", "MERGE_HEAD"));
        inMerge = true;
    }
    catch { }
    try {
        const { stdout } = await git(["status", "--porcelain"], dir);
        for (const line of stdout.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            const code = line.slice(0, 2);
            const filename = line.slice(3).trim();
            if (["UU", "AA", "UD", "DU", "DD", "AU", "UA"].includes(code) || code.includes("U")) {
                conflictedFiles.push(filename);
            }
        }
    }
    catch { }
    const hasConflicts = inRebase || inMerge || conflictedFiles.length > 0;
    return { hasConflicts, inRebase, inMerge, conflictedFiles };
}
export async function getSyncDivergence(dir) {
    let branch = "main";
    try {
        branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], dir)).stdout.trim();
    }
    catch { }
    const upstream = await upstreamRef(dir);
    if (!upstream) {
        return { branch, upstream: undefined, ahead: 0, behind: 0 };
    }
    const { ahead, behind } = await countAheadBehind(upstream, dir);
    return { branch, upstream, ahead, behind };
}
//# sourceMappingURL=git.js.map