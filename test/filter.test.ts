import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ensureAttributes,
  ensureFilter,
  generateFilterScript,
  isNodeInterpreter,
  refreshMachineSidecar,
  resolveFilterInterpreter,
} from "../src/filter.js";
import { DEFAULT_MACHINE_LOCAL_YAML } from "../src/config.js";
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
  assert.equal((smudgeResult.match(/^setupVersion:/gm) ?? []).length, 1);
});

test("YAML smudge is idempotent and does not duplicate machine keys", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-idemp-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `theme:\n  dark: titanium\nsetupVersion: 2\n`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);
  await ensureFilter(root, { machineLocalYamlKeys: ["setupVersion"] });
  await refreshMachineSidecar(root, { machineLocalYamlKeys: ["setupVersion"] });

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const run = (mode: string, input: string) =>
    new Promise<string>((resolve, reject) => {
      const p = execFileCb(process.execPath, [filterScript, mode, "yaml"], (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      );
      p.stdin?.end(input);
    });

  const once = await run("smudge", initialConfig);
  const twice = await run("smudge", once);
  assert.equal((once.match(/^setupVersion:/gm) ?? []).length, 1);
  assert.equal(twice, once);
});

test("YAML filter strips nested dotted keys and restores them via sidecar", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-nested-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `theme:\n  dark: titanium\ndev:\n  shared: keep\n  autoqaConsent: denied\n  autoqaPush:\n    token: secret\n    extra: stay\nsetupVersion: 2\n`;
  const keys = ["setupVersion", "dev.autoqaConsent", "dev.autoqaPush.token"];
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);
  await ensureFilter(root, { machineLocalYamlKeys: keys });
  await refreshMachineSidecar(root, { machineLocalYamlKeys: keys });

  const sidecar = await fs.readFile(path.join(root, ".git-sync", "config.machine.yml"), "utf8");
  assert.match(sidecar, /autoqaConsent: denied/);
  assert.match(sidecar, /token: secret/);
  assert.doesNotMatch(sidecar, /shared: keep/);
  assert.doesNotMatch(sidecar, /extra: stay/);

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const cleanResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "clean", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(initialConfig);
  });

  assert.doesNotMatch(cleanResult, /setupVersion/);
  assert.doesNotMatch(cleanResult, /autoqaConsent/);
  assert.doesNotMatch(cleanResult, /token: secret/);
  assert.match(cleanResult, /shared: keep/);
  assert.match(cleanResult, /extra: stay/);

  const smudgeResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "smudge", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(cleanResult);
  });

  assert.match(smudgeResult, /setupVersion: 2/);
  assert.match(smudgeResult, /autoqaConsent: denied/);
  assert.match(smudgeResult, /token: secret/);
  assert.match(smudgeResult, /shared: keep/);
  assert.equal((smudgeResult.match(/^dev:/gm) ?? []).length, 1);
});

test("YAML clean strips multiline block scalars including blank lines", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-block-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `a: 1\nsearxng.basicPassword: |\n  line1\n\n  SECRET-LINE2\nb: 2\n`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);
  await ensureFilter(root, { machineLocalYamlKeys: ["searxng.basicPassword"] });

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const cleanResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "clean", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(initialConfig);
  });

  assert.doesNotMatch(cleanResult, /SECRET-LINE2/);
  assert.doesNotMatch(cleanResult, /searxng\.basicPassword/);
  assert.match(cleanResult, /^a: 1$/m);
  assert.match(cleanResult, /^b: 2$/m);
});

test("YAML clean does not strip machine keys nested under a list", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-list-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `items:\n  - setupVersion: 1\nsetupVersion: 2\n`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);
  await ensureFilter(root, { machineLocalYamlKeys: ["setupVersion"] });

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const cleanResult = await new Promise<string>((resolve, reject) => {
    const p = execFileCb(process.execPath, [filterScript, "clean", "yaml"], (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    );
    p.stdin?.end(initialConfig);
  });

  assert.match(cleanResult, /items:\n {2}- setupVersion: 1/);
  assert.doesNotMatch(cleanResult, /^setupVersion: 2$/m);
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

test("generated yaml filter strips nested keys, block scalars, and smudges once", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-nested-"));
  await sh("git", ["init", "-b", "main"], root);

  const initialConfig = `theme:
  dark: titanium
dev:
  autoqaConsent: denied
  keepMe: yes
searxng.basicPassword: |
  line1

  SECRET-LINE2
setupVersion: 2
`;
  await fs.writeFile(path.join(root, "config.yml"), initialConfig);
  await ensureFilter(root, {
    machineLocalYamlKeys: ["setupVersion", "dev.autoqaConsent", "searxng.basicPassword"],
  });
  await refreshMachineSidecar(root, {
    machineLocalYamlKeys: ["setupVersion", "dev.autoqaConsent", "searxng.basicPassword"],
  });

  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const run = (mode: string, input: string) =>
    new Promise<string>((resolve, reject) => {
      const p = execFileCb(process.execPath, [filterScript, mode, "yaml"], (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      );
      p.stdin?.end(input);
    });

  const cleanResult = await run("clean", initialConfig);
  assert.doesNotMatch(cleanResult, /setupVersion/);
  assert.doesNotMatch(cleanResult, /autoqaConsent/);
  assert.doesNotMatch(cleanResult, /SECRET-LINE2/);
  assert.match(cleanResult, /keepMe/);
  assert.match(cleanResult, /titanium/);

  const sidecar = await fs.readFile(path.join(root, ".git-sync", "config.machine.yml"), "utf8");
  assert.match(sidecar, /setupVersion/);
  assert.match(sidecar, /autoqaConsent/);
  assert.match(sidecar, /SECRET-LINE2/);

  const smudgeOnce = await run("smudge", cleanResult);
  const smudgeTwice = await run("smudge", smudgeOnce);
  assert.equal(smudgeTwice, smudgeOnce);
  assert.equal([...smudgeOnce.matchAll(/^setupVersion:/gm)].length, 1);
  assert.match(smudgeOnce, /keepMe/);
  assert.match(smudgeOnce, /autoqaConsent/);
});

test("generateFilterScript embeds nested yaml helpers", () => {
  const source = generateFilterScript(["setupVersion"], DEFAULT_MACHINE_LOCAL_YAML);
  assert.match(source, /function stripYamlMachineKeys/);
  assert.match(source, /function mergeYamlSidecar/);
  assert.match(source, /dev\.autoqaConsent/);
});

test("refreshMachineSidecar extracts nested yaml keys", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-sidecar-"));
  await fs.writeFile(
    path.join(root, "config.yml"),
    `theme: x\nsetupVersion: 2\ndev:\n  autoqaConsent: denied\n`
  );
  await refreshMachineSidecar(root, { machineLocalYamlKeys: ["setupVersion", "dev.autoqaConsent"] });
  const sidecar = await fs.readFile(path.join(root, ".git-sync", "config.machine.yml"), "utf8");
  assert.match(sidecar, /^setupVersion: 2/m);
  assert.match(sidecar, /^dev:/m);
  assert.match(sidecar, /autoqaConsent: denied/);
  assert.doesNotMatch(sidecar, /theme/);
});

test("default yaml keys clean duplicate setupVersion and nested autoqaConsent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-filter-user-config-"));
  await sh("git", ["init", "-b", "main"], root);
  const input = `modelRoles:
  default: poe/gemini-3-flash
retry:
  fallbackChains:
    default:
      - cursor/cursor-grok-4.6-fast
setupVersion: 2
setupVersion: 2
dev:
  autoqaConsent: denied
`;
  await fs.writeFile(path.join(root, "config.yml"), input);
  await ensureFilter(root);
  await refreshMachineSidecar(root);
  const filterScript = path.join(root, ".git-sync", "filter.mjs");
  const run = (mode: string, stdin: string) =>
    new Promise<string>((resolve, reject) => {
      const p = execFileCb(process.execPath, [filterScript, mode, "yaml"], (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      );
      p.stdin?.end(stdin);
    });
  const cleaned = await run("clean", input);
  assert.doesNotMatch(cleaned, /setupVersion/);
  assert.doesNotMatch(cleaned, /autoqaConsent/);
  assert.doesNotMatch(cleaned, /^dev:/m);
  assert.match(cleaned, /modelRoles:/);
  assert.match(cleaned, /muse-wonder|cursor-grok|fallbackChains/);
  const once = await run("smudge", cleaned);
  const twice = await run("smudge", once);
  assert.equal(twice, once);
  assert.equal([...once.matchAll(/^setupVersion:/gm)].length, 1);
  assert.match(once, /autoqaConsent: denied/);
});
