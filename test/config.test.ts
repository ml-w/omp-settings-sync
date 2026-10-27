import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dirOf, readConfig, resolveSyncSchedule, stripJsonComments } from "../src/config.js";

test("dirOf resolves ~/.omp/agent by default, respects OMP_PROFILE and PI_CODING_AGENT_DIR", () => {
  const originalProfile = process.env.OMP_PROFILE;
  const originalPiDir = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.OMP_PROFILE;
    delete process.env.PI_CODING_AGENT_DIR;
    assert.equal(dirOf(), path.join(os.homedir(), ".omp", "agent"));

    process.env.OMP_PROFILE = "work";
    assert.equal(dirOf(), path.join(os.homedir(), ".omp", "profiles", "work", "agent"));

    process.env.PI_CODING_AGENT_DIR = "~/custom-agent";
    assert.equal(dirOf(), path.join(os.homedir(), "custom-agent"));

    assert.equal(dirOf({ dir: "/explicit/dir" }), path.resolve("/explicit/dir"));
  } finally {
    if (originalProfile) process.env.OMP_PROFILE = originalProfile; else delete process.env.OMP_PROFILE;
    if (originalPiDir) process.env.PI_CODING_AGENT_DIR = originalPiDir; else delete process.env.PI_CODING_AGENT_DIR;
  }
});

test("readConfig parses JSONC with comments and validates safe extraPaths and machineLocalSettings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-config-test-"));
  const configContent = `{\n  // Auto sync interval in minutes\n  "autoSyncIntervalMinutes": 10,\n  "includeHostname": false,\n  "extraPaths": ["safe-dir", "custom/path", "../unsafe", "auth-token"],\n  "machineLocalSettings": ["setupVersion", "dev.autoqaConsent", ""]\n}`;
  await fs.writeFile(path.join(tempDir, "omp-sync.jsonc"), configContent);

  const config = await readConfig({ dir: tempDir });
  assert.equal(config.autoSyncIntervalMinutes, 10);
  assert.equal(config.includeHostname, false);
  assert.deepEqual(config.extraPaths, ["safe-dir", "custom/path"]);
  assert.deepEqual(config.machineLocalSettings, ["setupVersion", "dev.autoqaConsent"]);
  assert.equal(resolveSyncSchedule(config).syncMode, "startIfStale");
  assert.equal(resolveSyncSchedule(config).autoSyncIntervalMinutes, 10);
});

test("resolveSyncSchedule gates startup when an interval is set and defaults startIfStale to 10 minutes", () => {
  const fromInterval = resolveSyncSchedule({ autoSyncIntervalMinutes: 1440 });
  assert.equal(fromInterval.syncMode, "startIfStale");
  assert.equal(fromInterval.autoSyncIntervalMinutes, 1440);
  assert.equal(fromInterval.remoteCheckIntervalMinutes, 1440);
  assert.equal(fromInterval.backgroundSyncIntervalMinutes, 1);
  assert.equal(fromInterval.syncOnSessionShutdown, true);

  const staleDefault = resolveSyncSchedule({ syncMode: "startIfStale" });
  assert.equal(staleDefault.autoSyncIntervalMinutes, 10);
  assert.equal(staleDefault.remoteCheckIntervalMinutes, 5);

  const always = resolveSyncSchedule({});
  assert.equal(always.syncMode, "always");
  assert.equal(always.autoSyncIntervalMinutes, 1);

  const invalid = resolveSyncSchedule({
    syncMode: "nope" as "always",
    autoSyncIntervalMinutes: -5,
    backgroundSyncIntervalMinutes: 0,
    remoteCheckIntervalMinutes: 30,
    syncOnSessionShutdown: false,
  });
  assert.equal(invalid.syncMode, "always");
  assert.equal(invalid.autoSyncIntervalMinutes, 1);
  assert.equal(invalid.backgroundSyncIntervalMinutes, 0);
  assert.equal(invalid.remoteCheckIntervalMinutes, 30);
  assert.equal(invalid.syncOnSessionShutdown, false);
});
