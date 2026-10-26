import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { isDenied } from "../src/security.js";
import { memoryHasChanges, restoreMemorySnapshots, writeMemorySnapshots } from "../src/memory.js";

function rows(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT v FROM m ORDER BY v").all().map((r) => String(r.v));
  } finally {
    db.close();
  }
}

test("memory snapshots capture uncheckpointed WAL rows, skip unchanged dbs, and restore over a stale db", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-memory-test-"));
  const mainDir = path.join(dir, "memories", "mnemopi");
  const bankDir = path.join(mainDir, "banks", "b1");
  await fs.mkdir(bankDir, { recursive: true });

  const live = [mainDir, bankDir].map((d) => {
    const db = new DatabaseSync(path.join(d, "mnemopi.db"));
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE m(v TEXT); INSERT INTO m VALUES ('${path.basename(d)}')`);
    return db;
  });
  assert.ok((await fs.stat(path.join(mainDir, "mnemopi.db-wal"))).size > 0);
  assert.equal(await memoryHasChanges(dir), true);

  const first = await writeMemorySnapshots(dir);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.updated, ["memories/mnemopi/banks/b1/mnemopi.snap", "memories/mnemopi/mnemopi.snap"]);
  assert.equal(await memoryHasChanges(dir), false);
  assert.deepEqual((await writeMemorySnapshots(dir)).updated, [], "unchanged dbs must not rewrite snapshots");

  // Local row added after the snapshot was taken, then the snapshot is restored (as after a pull).
  live[0]!.exec("INSERT INTO m VALUES ('local-only')");
  for (const db of live) db.close();
  const restored = await restoreMemorySnapshots(dir);
  assert.deepEqual(restored, ["memories/mnemopi/mnemopi.db"]);
  assert.deepEqual(rows(path.join(mainDir, "mnemopi.db")), ["mnemopi"]);
  assert.deepEqual(rows(path.join(mainDir, "mnemopi.db.pre-sync")), ["local-only", "mnemopi"]);
  assert.deepEqual(rows(path.join(bankDir, "mnemopi.db")), ["b1"]);

  await fs.rm(dir, { recursive: true, force: true });
});

test("snapshots are syncable while live databases and backups stay hard-denied", () => {
  assert.equal(isDenied("memories/mnemopi/mnemopi.snap"), false);
  assert.equal(isDenied("memories/mnemopi/banks/b1/mnemopi.snap"), false);
  assert.equal(isDenied("memories/mnemopi/mnemopi.db"), true);
  assert.equal(isDenied("memories/mnemopi/mnemopi.db-wal"), true);
  assert.equal(isDenied("memories/mnemopi/mnemopi.db.pre-sync"), true);
});
