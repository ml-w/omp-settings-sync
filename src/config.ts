import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GhClient } from "./gh.js";
import { isDenied } from "./security.js";

export type SyncMode = "always" | "startIfStale";

export interface OmpSyncConfig {
  syncMode?: SyncMode;
  autoSyncIntervalMinutes?: number;
  backgroundSyncIntervalMinutes?: number;
  remoteCheckIntervalMinutes?: number;
  syncOnSessionShutdown?: boolean;
  includeHostname?: boolean;
  extraPaths?: string[];
  warnOnPublicRemote?: boolean;
  machineLocalSettings?: string[];
  machineLocalYamlKeys?: string[];
  preferRemote?: boolean;
  discardLocalOnConflict?: boolean;
}

export interface SyncSchedule {
  syncMode: SyncMode;
  syncOnSessionShutdown: boolean;
  autoSyncIntervalMinutes: number;
  backgroundSyncIntervalMinutes: number;
  remoteCheckIntervalMinutes: number;
}

export const DEFAULT_START_IF_STALE_MINUTES = 10;
export const DEFAULT_ALWAYS_SYNC_INTERVAL_MINUTES = 1;
export const DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES = 1;
export const DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES = 5;

function finiteMinutes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function resolveSyncSchedule(config: OmpSyncConfig): SyncSchedule {
  const explicit = config.syncMode;
  const configuredInterval = finiteMinutes(config.autoSyncIntervalMinutes);
  let syncMode: SyncMode;
  if (explicit === "always" || explicit === "startIfStale") {
    syncMode = explicit;
  } else if (explicit !== undefined) {
    syncMode = "always";
  } else if (configuredInterval !== undefined && configuredInterval > 0) {
    syncMode = "startIfStale";
  } else {
    syncMode = "always";
  }

  const intervalFallback = syncMode === "startIfStale" ? DEFAULT_START_IF_STALE_MINUTES : DEFAULT_ALWAYS_SYNC_INTERVAL_MINUTES;
  const autoSyncIntervalMinutes =
    configuredInterval !== undefined && configuredInterval > 0 ? configuredInterval : intervalFallback;

  const configuredBackground = finiteMinutes(config.backgroundSyncIntervalMinutes);
  const backgroundSyncIntervalMinutes =
    configuredBackground !== undefined && configuredBackground >= 0
      ? configuredBackground
      : DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES;

  const configuredRemote = finiteMinutes(config.remoteCheckIntervalMinutes);
  const remoteCheckIntervalMinutes =
    configuredRemote !== undefined && configuredRemote > 0
      ? configuredRemote
      : configuredInterval !== undefined && configuredInterval > 0
        ? configuredInterval
        : DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES;

  return {
    syncMode,
    syncOnSessionShutdown: config.syncOnSessionShutdown !== false,
    autoSyncIntervalMinutes,
    backgroundSyncIntervalMinutes,
    remoteCheckIntervalMinutes,
  };
}


export type Level = "info" | "warning" | "error";

export interface Deps {
  dir?: string;
  gh?: GhClient;
  notify?: (message: string, level: Level) => void;
}

export interface UIContext {
  hasUI?: boolean;
  ui?: {
    setStatus(key: string, status?: string): void;
    setWorkingMessage?(message?: string): void;
    notify(message: string, level: Level): void;
    input?(title: string, placeholder?: string): Promise<string | undefined>;
    confirm?(title: string, message: string): Promise<boolean>;
    select?(
      title: string,
      options: Array<{ label: string; value?: string; description?: string }>
    ): Promise<string | undefined>;
  };
}

export type Ctx = UIContext | undefined;

export const DEFAULT_MACHINE_LOCAL_JSON = ["lastChangelogVersion", "setupVersion"];
export const DEFAULT_MACHINE_LOCAL_YAML = [
  "setupVersion",
  "shellPath",
  "dev.autoqaPush.token",
  "dev.autoqaConsent",
  "searxng.token",
  "searxng.basicUsername",
  "searxng.basicPassword",
  "hindsight.apiToken",
  "hindsight.apiUrl",
  "auth.broker.url",
  "auth.broker.token",
  "images.urls.credentials",
  "images.urls.command",
  "python.interpreter",
  "ruby.interpreter",
  "julia.interpreter",
  "browser.cdpUrl",
  "browser.relayUrl",
];

export function dirOf(deps?: Deps): string {
  if (deps?.dir) return path.resolve(deps.dir);
  const explicit = process.env.PI_CODING_AGENT_DIR?.trim();
  if (explicit) {
    if (explicit === "~" || explicit.startsWith("~/") || explicit.startsWith("~\\")) {
      return path.resolve(path.join(os.homedir(), explicit.slice(2)));
    }
    return path.resolve(explicit);
  }
  const profile = process.env.OMP_PROFILE?.trim();
  if (profile) {
    return path.resolve(path.join(os.homedir(), ".omp", "profiles", profile, "agent"));
  }
  return path.resolve(path.join(os.homedir(), ".omp", "agent"));
}

export function stripJsonComments(input: string): string {
  let out = "";
  let quote = "";
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const next = input[i + 1];
    if (quote) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") i++;
      if (input[i] === "\r" && input[i + 1] === "\n") {
        i++;
        out += "\r\n";
      } else {
        out += "\n";
      }
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

export function isValidExtraPath(entry: string): boolean {
  const trimmed = entry.trim();
  return trimmed !== "" && !trimmed.includes("..") && !path.isAbsolute(trimmed) && !isDenied(trimmed);
}

export async function readConfigFile(dir: string): Promise<string | undefined> {
  for (const filename of ["omp-sync.jsonc", "omp-sync.json", "git-sync.jsonc", "git-sync.json"]) {
    try {
      return await fs.readFile(path.join(dir, filename), "utf8");
    } catch {}
  }
  return undefined;
}

export async function readConfig(deps?: Deps, ctx?: Ctx): Promise<OmpSyncConfig> {
  const dir = dirOf(deps);
  const rawText = await readConfigFile(dir);
  if (!rawText) return {};

  try {
    const raw = JSON.parse(stripJsonComments(rawText)) as OmpSyncConfig;
    const extras = (raw.extraPaths ?? []).filter(isValidExtraPath);

    let machineLocalSettings: string[] | undefined;
    if (Array.isArray(raw.machineLocalSettings)) {
      machineLocalSettings = raw.machineLocalSettings.filter(
        (key): key is string => typeof key === "string" && key.trim() !== ""
      );
    }

    let machineLocalYamlKeys: string[] | undefined;
    if (Array.isArray(raw.machineLocalYamlKeys)) {
      machineLocalYamlKeys = raw.machineLocalYamlKeys.filter(
        (key): key is string => typeof key === "string" && key.trim() !== ""
      );
    }

    return {
      ...raw,
      extraPaths: extras,
      machineLocalSettings,
      machineLocalYamlKeys,
    };
  } catch {
    return {};
  }
}
