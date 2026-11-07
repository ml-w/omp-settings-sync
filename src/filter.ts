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

/** Line-based YAML helpers inlined into git filter.mjs. Wrappers below eval this same source. */
const YAML_FILTER_RUNTIME = `
function indentOf(line) {
  return line.search(/\\S/);
}

function isKeyLine(line, key) {
  const trimmed = line.trimStart();
  if (trimmed === key + ":") return true;
  if (!trimmed.startsWith(key + ":")) return false;
  const c = trimmed.charAt(key.length + 1);
  return c === "" || c === " " || c === "\\t";
}

function valueEnd(lines, keyIndex) {
  const parentIndent = indentOf(lines[keyIndex]);
  let i = keyIndex + 1;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    if (indentOf(lines[i]) > parentIndent) {
      i++;
      continue;
    }
    return i;
  }
  return i;
}

function findKeyAtIndent(lines, key, expectedIndent, start, end, drop) {
  for (let i = start; i < end; i++) {
    if (drop && drop[i]) continue;
    if (lines[i].trim() === "") continue;
    const ind = indentOf(lines[i]);
    if (ind < expectedIndent) return -1;
    if (ind === expectedIndent && isKeyLine(lines[i], key)) return i;
  }
  return -1;
}

function childIndent(lines, keyIndex) {
  const end = valueEnd(lines, keyIndex);
  const parentIndent = indentOf(lines[keyIndex]);
  for (let i = keyIndex + 1; i < end; i++) {
    if (lines[i].trim() === "") continue;
    const ind = indentOf(lines[i]);
    if (ind > parentIndent) return ind;
  }
  return parentIndent + 2;
}

function findLiteralTopLevel(lines, key, start, drop) {
  return findKeyAtIndent(lines, key, 0, start || 0, lines.length, drop);
}

function findNestedUnder(lines, parts, parentIdx, drop) {
  let start = parentIdx + 1;
  let end = valueEnd(lines, parentIdx);
  let expectedIndent = childIndent(lines, parentIdx);
  const indexes = [];
  for (let p = 0; p < parts.length; p++) {
    const idx = findKeyAtIndent(lines, parts[p], expectedIndent, start, end, drop);
    if (idx < 0) return null;
    indexes.push(idx);
    if (p === parts.length - 1) return { indexes: indexes, leaf: idx };
    expectedIndent = childIndent(lines, idx);
    start = idx + 1;
    end = valueEnd(lines, idx);
  }
  return null;
}

function findNestedPath(lines, parts, from, drop) {
  if (!parts.length) return null;
  let search = from || 0;
  while (search < lines.length) {
    const idx = findKeyAtIndent(lines, parts[0], 0, search, lines.length, drop);
    if (idx < 0) return null;
    if (parts.length === 1) return { indexes: [idx], leaf: idx };
    const inner = findNestedUnder(lines, parts.slice(1), idx, drop);
    if (inner) return { indexes: [idx].concat(inner.indexes), leaf: inner.leaf };
    search = valueEnd(lines, idx);
  }
  return null;
}

function markRange(flags, from, to) {
  for (let i = from; i < to; i++) flags[i] = 1;
}

function findMachineMatch(lines, key, from, drop) {
  const lit = findLiteralTopLevel(lines, key, from, drop);
  if (lit >= 0) return { indexes: [lit], leaf: lit };
  const parts = key.split(".");
  if (parts.length < 2) return null;
  return findNestedPath(lines, parts, from, drop);
}

function stripYamlMachineKeys(text, keys) {
  const lines = text.split(/\\r?\\n/);
  const drop = new Array(lines.length).fill(0);
  for (const key of keys) {
    let from = 0;
    while (from < lines.length) {
      const found = findMachineMatch(lines, key, from, drop);
      if (!found) break;
      markRange(drop, found.leaf, valueEnd(lines, found.leaf));
      for (let a = found.indexes.length - 2; a >= 0; a--) {
        const parent = found.indexes[a];
        const end = valueEnd(lines, parent);
        let anyLive = false;
        for (let j = parent + 1; j < end; j++) {
          if (!drop[j] && lines[j].trim() !== "") {
            anyLive = true;
            break;
          }
        }
        if (!anyLive) markRange(drop, parent, end);
        else break;
      }
      from = found.leaf + 1;
    }
  }
  const filtered = [];
  for (let i = 0; i < lines.length; i++) {
    if (!drop[i]) filtered.push(lines[i]);
  }
  return filtered;
}

function extractYamlMachineKeys(text, keys) {
  const lines = text.split(/\\r?\\n/);
  const keep = new Array(lines.length).fill(0);
  for (const key of keys) {
    let last = null;
    let from = 0;
    while (from < lines.length) {
      const found = findMachineMatch(lines, key, from);
      if (!found) break;
      last = found;
      from = found.leaf + 1;
    }
    if (!last) continue;
    for (const idx of last.indexes) keep[idx] = 1;
    markRange(keep, last.leaf, valueEnd(lines, last.leaf));
  }
  const extracted = [];
  for (let i = 0; i < lines.length; i++) {
    if (keep[i]) extracted.push(lines[i]);
  }
  return extracted;
}

function topLevelKeyName(line) {
  const trimmed = line.trimStart();
  const c = trimmed.indexOf(":");
  return c < 0 ? "" : trimmed.slice(0, c);
}

function mergeYamlSidecar(base, sidecar, lineEnding) {
  const lines = base.split(/\\r?\\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const sLines = sidecar.split(/\\r?\\n/);
  if (sLines.length && sLines[sLines.length - 1] === "") sLines.pop();
  const append = [];
  let i = 0;
  while (i < sLines.length) {
    if (sLines[i].trim() === "") {
      i++;
      continue;
    }
    const end = valueEnd(sLines, i);
    const key = topLevelKeyName(sLines[i]);
    const chunk = sLines.slice(i, end);
    const existing = key ? findLiteralTopLevel(lines, key) : -1;
    const existingAppend = key ? findLiteralTopLevel(append, key) : -1;
    if (existing < 0 && existingAppend < 0) {
      append.push.apply(append, chunk);
    } else if (existing >= 0) {
      const children = chunk.slice(1);
      if (children.length) {
        const dest = valueEnd(lines, existing);
        for (let c = 0; c < children.length; c++) {
          lines.splice(dest + c, 0, children[c]);
        }
      } else if (chunk.length === 1) {
        lines[existing] = chunk[0];
      }
    } else {
      const endA = valueEnd(append, existingAppend);
      append.splice(existingAppend, endA - existingAppend);
      for (let c = 0; c < chunk.length; c++) append.splice(existingAppend + c, 0, chunk[c]);
    }
    i = end;
  }
  const merged = lines.concat(append);
  if (!merged.length) return "";
  return merged.join(lineEnding) + lineEnding;
}
`.trim();

type YamlFilterFns = {
  stripYamlMachineKeys: (text: string, keys: string[]) => string[];
  extractYamlMachineKeys: (text: string, keys: string[]) => string[];
  mergeYamlSidecar: (base: string, sidecar: string, lineEnding: string) => string;
};

let yamlFilterFns: YamlFilterFns | undefined;

function yamlFns(): YamlFilterFns {
  if (!yamlFilterFns) {
    yamlFilterFns = new Function(
      `${YAML_FILTER_RUNTIME}\nreturn { stripYamlMachineKeys, extractYamlMachineKeys, mergeYamlSidecar };`
    )() as YamlFilterFns;
  }
  return yamlFilterFns;
}

export function stripYamlMachineKeys(text: string, keys: string[]): string {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = yamlFns().stripYamlMachineKeys(text, keys);
  if (!lines.length) return "";
  return lines.join(lineEnding) + (text.endsWith("\n") || text.endsWith("\r\n") || lines.length ? lineEnding : "");
}

export function extractYamlMachineKeys(text: string, keys: string[]): string {
  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = yamlFns().extractYamlMachineKeys(text, keys);
  if (!lines.length) return "";
  return lines.join(lineEnding) + lineEnding;
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

${YAML_FILTER_RUNTIME}

try {
  const lineEnding = text.includes("\\r\\n") ? "\\r\\n" : "\\n";
  if (format === "yaml") {
    if (mode === "clean") {
      const filtered = stripYamlMachineKeys(text, yamlKeys);
      const content = filtered.join(lineEnding);
      process.stdout.write(content ? content + lineEnding : "");
    } else if (mode === "smudge") {
      const sidecarPath = new URL("config.machine.yml", import.meta.url);
      let sidecarText = "";
      try {
        sidecarText = fs.readFileSync(sidecarPath, "utf8");
      } catch {}
      const cleaned = stripYamlMachineKeys(text, yamlKeys).join(lineEnding);
      process.stdout.write(mergeYamlSidecar(cleaned, sidecarText, lineEnding));
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
      for (const key of jsonKeys) delete value[key];
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
  try {
    const info = await fs.readFile(infoAttributes, "utf8");
    const disable = new Set([
      "config.yml -filter",
      "config.yaml -filter",
      "settings.json -filter",
      "mcp.json -filter",
    ]);
    const lines = info.split(/\r?\n/).filter((line, i, arr) => !(i === arr.length - 1 && line === ""));
    const kept = lines.filter((line) => !disable.has(line.trim()));
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
    const keys = machineYamlKeys(config);
    const extracted = extractYamlMachineKeys(raw, keys);
    await fs.writeFile(path.join(stateDir(dir), "config.machine.yml"), extracted);
  } catch {}
}
