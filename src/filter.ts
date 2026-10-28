import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OmpSyncConfig } from "./config.js";
import { DEFAULT_MACHINE_LOCAL_JSON, DEFAULT_MACHINE_LOCAL_YAML } from "./config.js";
import { git, hasDotGit } from "./git.js";

export function stateDir(dir: string): string {
  return path.join(dir, ".git-sync");
}

export function machineJsonKeys(config: OmpSyncConfig): string[] {
  return config.machineLocalSettings ?? DEFAULT_MACHINE_LOCAL_JSON;
}

export function machineYamlKeys(config: OmpSyncConfig): string[] {
  return config.machineLocalYamlKeys ?? DEFAULT_MACHINE_LOCAL_YAML;
}

export function generateFilterScript(jsonKeys: string[], yamlKeys: string[]): string {
  return `import fs from "node:fs";

const jsonKeys = ${JSON.stringify(jsonKeys)};
const yamlKeys = ${JSON.stringify(yamlKeys)};

const mode = process.argv[2];
const format = process.argv[3] || "json";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks);
const text = raw.toString("utf8");

function cleanYamlLine(line, keys) {
  const trimmed = line.trimStart();
  for (const key of keys) {
    const prefix = key + ":";
    if (trimmed.startsWith(prefix) && line.search(/\\S/) === 0) {
      return true;
    }
  }
  return false;
}

try {
  const lineEnding = text.includes("\\r\\n") ? "\\r\\n" : "\\n";
  if (format === "yaml") {
    if (mode === "clean") {
      const lines = text.split(/\\r?\\n/);
      const filtered = [];
      let skippingBlock = false;
      let blockIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const indent = line.search(/\\S/);

        if (skippingBlock) {
          if (indent > blockIndent && line.trim() !== "") {
            continue;
          } else {
            skippingBlock = false;
          }
        }

        if (cleanYamlLine(line, yamlKeys)) {
          skippingBlock = true;
          blockIndent = indent >= 0 ? indent : 0;
          continue;
        }

        filtered.push(line);
      }
      process.stdout.write(filtered.join(lineEnding));
    } else if (mode === "smudge") {
      const sidecarPath = new URL("config.machine.yml", import.meta.url);
      let sidecarText = "";
      try {
        sidecarText = fs.readFileSync(sidecarPath, "utf8");
      } catch {}
      const combined =
        (text.trim() ? text.trim() + lineEnding : "") +
        sidecarText.trim() +
        (sidecarText.trim() ? lineEnding : "");
      process.stdout.write(combined);
    } else {
      process.stdout.write(raw);
    }
  } else {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("not object");

    if (mode === "clean") {
      for (const key of jsonKeys) delete value[key];
      process.stdout.write(JSON.stringify(value, null, 2) + lineEnding);
    } else if (mode === "smudge") {
      const sidecarPath = new URL("settings.machine.json", import.meta.url);
      let sidecar = {};
      try {
        sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      } catch {}
      process.stdout.write(JSON.stringify({ ...value, ...sidecar }, null, 2) + lineEnding);
    } else {
      process.stdout.write(raw);
    }
  }
} catch {
  process.stdout.write(raw);
}
`;
}

export async function ensureAttributes(dir: string): Promise<void> {
  const file = path.join(dir, ".gitattributes");
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch {}

  const rules = [
    "config.yml filter=omp-config-sync-yaml",
    "config.yaml filter=omp-config-sync-yaml",
    "settings.json filter=omp-config-sync-json",
    "mcp.json filter=omp-config-sync-json",
  ];

  const existing = new Set(current.split(/\r?\n/).map((l) => l.trim()));
  const missing = rules.filter((r) => !existing.has(r));

  if (missing.length) {
    const next = (current.trim() ? `${current.trim()}\n` : "") + missing.join("\n") + "\n";
    await fs.writeFile(file, next);
  }

  // $GIT_DIR/info/attributes wins over .gitattributes. A previous workaround
  // unset these filters; leave that in place and git never runs the driver.
  const infoAttributes = path.join(dir, ".git", "info", "attributes");
  const disabledFilter: Record<string, true> = {
    "config.yml -filter": true,
    "config.yaml -filter": true,
    "settings.json -filter": true,
    "mcp.json -filter": true,
  };
  try {
    const info = await fs.readFile(infoAttributes, "utf8");
    const lines = info.split(/\r?\n/).filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
    const kept = lines.filter((line) => !disabledFilter[line.trim()]);
    if (kept.length !== lines.length) {
      if (kept.length === 0) {
        await fs.rm(infoAttributes, { force: true });
      } else {
        await fs.writeFile(infoAttributes, kept.join("\n") + "\n");
      }
    }
  } catch {}
}

async function gitConfigValue(key: string, dir: string): Promise<string | undefined> {
  try {
    return (await git(["config", "--get", key], dir)).stdout.trim();
  } catch {
    return undefined;
  }
}

export function isNodeInterpreter(execPath: string): boolean {
  const name = path.basename(execPath).toLowerCase();
  return name === "node" || name === "node.exe";
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path");
  if (!key || !env[key]) return [];
  return env[key].split(path.delimiter).filter(Boolean);
}

/** Git filters must spawn Node, not a packaged host like omp.exe (that re-enters this extension). */
export function resolveFilterInterpreter(
  execPath = process.execPath,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (isNodeInterpreter(execPath)) {
    return execPath.replaceAll("\\", "/");
  }

  const names = process.platform === "win32" ? ["node.exe", "node"] : ["node"];
  for (const dir of pathDirs(env)) {
    if (/WindowsApps/i.test(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate) && isNodeInterpreter(candidate)) {
        return candidate.replaceAll("\\", "/");
      }
    }
  }

  throw new Error(
    "omp-sync git filter requires a Node.js executable. The host binary is not node, and node was not found on PATH."
  );
}

function formatFilterCommand(interpreter: string, scriptPath: string, mode: string, format: string): string {
  const nodeExec = interpreter.replaceAll("\\", "/");
  const script = scriptPath.replaceAll("\\", "/");
  return `"${nodeExec}" "${script}" ${mode} ${format}`;
}

export async function ensureFilter(dir: string, config: OmpSyncConfig = {}): Promise<void> {
  if (!(await hasDotGit(dir))) return;

  await fs.mkdir(stateDir(dir), { recursive: true });
  const scriptPath = path.join(stateDir(dir), "filter.mjs");
  const source = generateFilterScript(machineJsonKeys(config), machineYamlKeys(config));

  try {
    if ((await fs.readFile(scriptPath, "utf8")) !== source) {
      await fs.writeFile(scriptPath, source);
    }
  } catch {
    await fs.writeFile(scriptPath, source);
  }

  const interpreter = resolveFilterInterpreter();
  const configs: Record<string, string> = {
    "filter.omp-config-sync-yaml.clean": formatFilterCommand(interpreter, scriptPath, "clean", "yaml"),
    "filter.omp-config-sync-yaml.smudge": formatFilterCommand(interpreter, scriptPath, "smudge", "yaml"),
    "filter.omp-config-sync-yaml.required": "false",
    "filter.omp-config-sync-json.clean": formatFilterCommand(interpreter, scriptPath, "clean", "json"),
    "filter.omp-config-sync-json.smudge": formatFilterCommand(interpreter, scriptPath, "smudge", "json"),
    "filter.omp-config-sync-json.required": "false",
  };

  let changed = false;
  for (const [k, v] of Object.entries(configs)) {
    if ((await gitConfigValue(k, dir)) !== v) {
      await git(["config", k, v], dir);
      changed = true;
    }
  }

  if (changed) {
    try {
      await git(["add", "--renormalize", "config.yml", "settings.json", "mcp.json"], dir);
    } catch {}
  }
}

export async function refreshMachineSidecar(dir: string, config: OmpSyncConfig = {}): Promise<void> {
  await fs.mkdir(stateDir(dir), { recursive: true });

  // 1. JSON sidecar
  try {
    const raw = await fs.readFile(path.join(dir, "settings.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = machineJsonKeys(config);
      const settingsRecord = parsed as Record<string, unknown>;
      const sidecar = Object.fromEntries(
        keys.filter((k) => Object.hasOwn(settingsRecord, k)).map((k) => [k, settingsRecord[k]])
      );
      await fs.writeFile(path.join(stateDir(dir), "settings.machine.json"), JSON.stringify(sidecar, null, 2) + "\n");
    }
  } catch {}

  // 2. YAML sidecar
  try {
    const raw = await fs.readFile(path.join(dir, "config.yml"), "utf8");
    const keys = new Set(machineYamlKeys(config));
    const lines = raw.split(/\r?\n/);
    const extracted: string[] = [];
    let capturing = false;
    let captureIndent = 0;

    for (const line of lines) {
      const indent = line.search(/\S/);
      if (capturing) {
        if (indent > captureIndent && line.trim() !== "") {
          extracted.push(line);
          continue;
        } else {
          capturing = false;
        }
      }
      const trimmed = line.trimStart();
      for (const key of keys) {
        if (trimmed.startsWith(`${key}:`) && indent === 0) {
          capturing = true;
          captureIndent = indent;
          extracted.push(line);
          break;
        }
      }
    }

    if (extracted.length) {
      await fs.writeFile(path.join(stateDir(dir), "config.machine.yml"), extracted.join("\n") + "\n");
    }
  } catch {}
}

interface YamlBlock {
  key: string;
  lines: string[];
}

/** Top-level `key:` blocks, including nested lines that belong to that key. */
export function topLevelYamlBlocks(text: string): YamlBlock[] {
  const blocks: YamlBlock[] = [];
  let current: YamlBlock | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (current) current.lines.push(line);
      continue;
    }
    const indent = line.search(/\S/);
    const match = indent === 0 ? /^([^:#\s][^:]*):/.exec(line) : undefined;
    if (match?.[1]) {
      current = { key: match[1], lines: [line] };
      blocks.push(current);
      continue;
    }
    if (current && indent > 0) current.lines.push(line);
  }
  for (const block of blocks) {
    while (block.lines.length > 1 && block.lines[block.lines.length - 1]?.trim() === "") block.lines.pop();
  }
  return blocks;
}

async function applyYamlSidecar(target: string, sidecarPath: string): Promise<void> {
  let sidecarText: string;
  let current: string;
  try {
    sidecarText = await fs.readFile(sidecarPath, "utf8");
    current = await fs.readFile(target, "utf8");
  } catch {
    return;
  }
  const present = new Set(topLevelYamlBlocks(current).map((block) => block.key));
  const missing = topLevelYamlBlocks(sidecarText).filter((block) => !present.has(block.key));
  if (missing.length === 0) return;
  const ending = current.includes("\r\n") ? "\r\n" : "\n";
  const base = current.endsWith("\n") ? current : current + ending;
  await fs.writeFile(target, base + missing.map((block) => block.lines.join(ending)).join(ending) + ending);
}

async function applyJsonSidecar(target: string, sidecarPath: string): Promise<void> {
  try {
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8")) as unknown;
    const parsed = JSON.parse(await fs.readFile(target, "utf8")) as unknown;
    if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) return;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const record = parsed as Record<string, unknown>;
    let changed = false;
    for (const [key, value] of Object.entries(sidecar)) {
      if (!Object.hasOwn(record, key)) {
        record[key] = value;
        changed = true;
      }
    }
    if (changed) await fs.writeFile(target, JSON.stringify(record, null, 2) + "\n");
  } catch {}
}

/**
 * Put machine-local keys back into the working tree.
 *
 * Committed copies have those keys stripped. A checkout restores them only when
 * the smudge filter runs; `filter.required` is false, so a failed filter (for
 * example git invoking the omp binary) leaves `setupVersion` out and omp
 * onboards again. Merging the sidecar back does not depend on that filter.
 * Keys already present in the working tree are left alone.
 */
export async function applyMachineSidecar(dir: string): Promise<void> {
  const state = stateDir(dir);
  const yamlSidecar = path.join(state, "config.machine.yml");
  await applyYamlSidecar(path.join(dir, "config.yml"), yamlSidecar);
  await applyYamlSidecar(path.join(dir, "config.yaml"), yamlSidecar);
  await applyJsonSidecar(path.join(dir, "settings.json"), path.join(state, "settings.machine.json"));
}
