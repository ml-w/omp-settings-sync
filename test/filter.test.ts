import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureAttributes,
  ensureFilter,
  isNodeInterpreter,
  refreshMachineSidecar,
  resolveFilterInterpreter,
} from "../src/filter.js";
import { sh } from "./helpers.js";

test("filter cleans machine keys and smudges them back for YAML config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-test-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `theme:\n  dark: titanium\nsetupVersion: 2\nshellPath: /bin/zsh\n`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);

  await ensureFilter(root, { machineLocalYamlKeys: ["setupVersion", "shellPath"] });
  await refreshMachineSidecar(root, { machineLocalYamlKeys: ["setupVersion", "shellPath"] });

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  assert.ok(await fs.stat(filterScript));

  // Run clean filter over stdin
  const cleanResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "clean", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(initialConfig);
  });

  assert.doesNotMatch(cleanResult, /setupVersion/);
  assert.doesNotMatch(cleanResult, /shellPath/);
  assert.match(cleanResult, /titanium/);

  // Run smudge filter over stdin
  const smudgeResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "smudge", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(cleanResult);
  });

  assert.match(smudgeResult, /setupVersion/);
  assert.match(smudgeResult, /shellPath/);
  assert.match(smudgeResult, /titanium/);
});

test("resolveFilterInterpreter uses node, never a packaged host binary", () => {
  assert.equal(isNodeInterpreter("C:/Users/lwong/AppData/Local/omp/omp.exe"), false);
  assert.equal(isNodeInterpreter("C:/Program Files/nodejs/node.exe"), true);
  assert.equal(isNodeInterpreter("/usr/bin/node"), true);

  const fromNode = resolveFilterInterpreter(process.execPath);
  assert.equal(isNodeInterpreter(fromNode), true);

  const fromHost = resolveFilterInterpreter("C:/Users/lwong/AppData/Local/omp/omp.exe");
  assert.equal(isNodeInterpreter(fromHost), true);
  assert.doesNotMatch(fromHost, /omp\.exe$/i);

  assert.throws(
    () => resolveFilterInterpreter("C:/Users/lwong/AppData/Local/omp/omp.exe", { PATH: "", Path: "" }),
    /Node\.js executable/
  );
});

test("ensureAttributes removes local -filter overrides that would skip the driver", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-attrs-"));
  await sh("git", ["init", "-b", "main"], root);
  await fs.mkdir(path.join(root, ".git", "info"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".git", "info", "attributes"),
    "config.yml -filter\nsettings.json -filter\ncustom.bin -text\n"
  );

  await ensureAttributes(root);

  const info = await fs.readFile(path.join(root, ".git", "info", "attributes"), "utf8");
  assert.doesNotMatch(info, /-filter/);
  assert.match(info, /custom\.bin -text/);
  const bound = (await sh("git", ["check-attr", "filter", "--", "config.yml"], root)).stdout;
  assert.match(bound, /omp-config-sync-yaml/);
});

test("ensureFilter registers a node interpreter and git add runs the clean filter", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-git-"));
  await sh("git", ["init", "-b", "main"], root);
  await sh("git", ["config", "user.email", "tests@omp-settings-sync.invalid"], root);
  await sh("git", ["config", "user.name", "omp-settings-sync tests"], root);

  const initialConfig = `theme:\n  dark: titanium\nsetupVersion: 2\nshellPath: /bin/zsh\n`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);

  await ensureAttributes(root);
  await ensureFilter(root, { machineLocalYamlKeys: ["setupVersion", "shellPath"] });

  const cleanCmd = (await sh("git", ["config", "--get", "filter.omp-config-sync-yaml.clean"], root)).stdout.trim();
  const smudgeCmd = (await sh("git", ["config", "--get", "filter.omp-config-sync-yaml.smudge"], root)).stdout.trim();
  assert.match(cleanCmd, /node(\.exe)?/i);
  assert.doesNotMatch(cleanCmd, /omp\.exe/i);
  assert.match(smudgeCmd, /node(\.exe)?/i);
  assert.doesNotMatch(smudgeCmd, /omp\.exe/i);

  await sh("git", ["add", "config.yml"], root);
  const staged = (await sh("git", ["show", ":config.yml"], root)).stdout;
  assert.doesNotMatch(staged, /setupVersion/);
  assert.doesNotMatch(staged, /shellPath/);
  assert.match(staged, /titanium/);
});
