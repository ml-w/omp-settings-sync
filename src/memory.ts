import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteFile } from "./vault.js";

/**
 * Plaintext sync of the mnemopi memory databases.
 *
 * Live databases (`*.db`) are in the hard deny list and run in WAL mode, so they are never
 * tracked directly. Instead a consistent `VACUUM INTO` snapshot is written next to each one as
 * `mnemopi.snap` (tracked by git), and snapshots pulled from the remote are restored over the
 * live databases.
 */

const MNEMOPI_DIR = "memories/mnemopi";
const LIVE_NAME = "mnemopi.db";
const SNAP_NAME = "mnemopi.snap";
const BACKUP_SUFFIX = ".pre-sync";

interface SqliteHandle {
  exec(sql: string): unknown;
  close(): void;
}

/** Relative (forward-slash) paths of `name` in the main mnemopi dir and every bank dir. */
async function memoryPaths(dir: string, name: string): Promise<string[]> {
  const candidates = [`${MNEMOPI_DIR}/${name}`];
  try {
    const banks = await fs.readdir(path.join(dir, MNEMOPI_DIR, "banks"), { withFileTypes: true });
    for (const bank of banks) {
      if (bank.isDirectory()) candidates.push(`${MNEMOPI_DIR}/banks/${bank.name}/${name}`);
    }
  } catch {}

  const found: string[] = [];
  for (const rel of candidates) {
    try {
      await fs.access(path.join(dir, rel));
      found.push(rel);
    } catch {}
  }
  return found.sort();
}

const snapOf = (liveRel: string) => liveRel.slice(0, -LIVE_NAME.length) + SNAP_NAME;
const liveOf = (snapRel: string) => snapRel.slice(0, -SNAP_NAME.length) + LIVE_NAME;

async function openReadOnly(file: string): Promise<SqliteHandle> {
  // Runtime-selected: omp is a Bun build while the tests run on Node, and a static import of
  // either module fails to load on the other runtime.
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return new DatabaseSync(file, { readOnly: true });
  } catch (nodeErr) {
    const spec = "bun:sqlite";
    let mod: { Database: new (p: string, o: { readonly: boolean }) => SqliteHandle };
    try {
      mod = await import(spec);
    } catch {
      throw nodeErr;
    }
    return new mod.Database(file, { readonly: true });
  }
}

/**
 * Point-in-time copy of a live database, including rows still in the -wal file.
 * `VACUUM INTO` output is byte-identical for identical content, so it can be diffed.
 */
async function snapshotLive(file: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `omp-sync-snap-${crypto.randomBytes(6).toString("hex")}.db`);
  try {
    const db = await openReadOnly(file);
    try {
      db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    } finally {
      db.close();
    }
    return await fs.readFile(tmp);
  } catch (err) {
    throw new Error(`${path.basename(path.dirname(file))}/${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

async function readIfExists(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch {
    return undefined;
  }
}

/** Write fresh snapshots of every live database. Unchanged databases leave the repo untouched. */
export async function writeMemorySnapshots(dir: string): Promise<{ updated: string[]; errors: string[] }> {
  const updated: string[] = [];
  const errors: string[] = [];
  for (const liveRel of await memoryPaths(dir, LIVE_NAME)) {
    try {
      const fresh = await snapshotLive(path.join(dir, liveRel));
      const snapPath = path.join(dir, snapOf(liveRel));
      const current = await readIfExists(snapPath);
      if (!current || !current.equals(fresh)) {
        await atomicWriteFile(snapPath, fresh);
        updated.push(snapOf(liveRel));
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { updated, errors };
}

/** True when a live database has content that its tracked snapshot does not. */
export async function memoryHasChanges(dir: string): Promise<boolean> {
  for (const liveRel of await memoryPaths(dir, LIVE_NAME)) {
    try {
      const fresh = await snapshotLive(path.join(dir, liveRel));
      const current = await readIfExists(path.join(dir, snapOf(liveRel)));
      if (!current || !current.equals(fresh)) return true;
    } catch {}
  }
  return false;
}

/** sha256 of every snapshot file currently in the working tree, keyed by relative path. */
export async function memorySnapshotHashes(dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const rel of await memoryPaths(dir, SNAP_NAME)) {
    const content = await fs.readFile(path.join(dir, rel));
    hashes.set(rel, crypto.createHash("sha256").update(content).digest("hex"));
  }
  return hashes;
}

/**
 * Restore snapshots over the live databases. With `only`, restore just those snapshot paths
 * (used after a pull so that unrelated local writes are not overwritten). A live database whose
 * content differs is first saved as `mnemopi.db.pre-sync` (hard-denied, never committed).
 * Restart omp afterwards: a running process keeps the old database open.
 */
export async function restoreMemorySnapshots(dir: string, only?: Iterable<string>): Promise<string[]> {
  const filter = only ? new Set(only) : undefined;
  const restored: string[] = [];

  for (const snapRel of await memoryPaths(dir, SNAP_NAME)) {
    if (filter && !filter.has(snapRel)) continue;

    const snap = await fs.readFile(path.join(dir, snapRel));
    const livePath = path.join(dir, liveOf(snapRel));

    if (await readIfExists(livePath)) {
      let liveContent: Buffer | undefined;
      try {
        liveContent = await snapshotLive(livePath);
      } catch {
        liveContent = await readIfExists(livePath);
      }
      if (liveContent?.equals(snap)) continue;
      if (liveContent) await atomicWriteFile(livePath + BACKUP_SUFFIX, liveContent);
    }

    // A stale WAL/SHM would be replayed onto the restored database.
    await fs.rm(`${livePath}-wal`, { force: true });
    await fs.rm(`${livePath}-shm`, { force: true });
    await atomicWriteFile(livePath, snap);
    restored.push(liveOf(snapRel));
  }
  return restored;
}
