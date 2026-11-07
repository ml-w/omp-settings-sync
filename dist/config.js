import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDenied } from "./security.js";
export const DEFAULT_START_IF_STALE_MINUTES = 10;
export const DEFAULT_ALWAYS_SYNC_INTERVAL_MINUTES = 1;
export const DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES = 1;
export const DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES = 5;
function finiteMinutes(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
    return value;
}
export function resolveSyncSchedule(config) {
    const explicit = config.syncMode;
    const configuredInterval = finiteMinutes(config.autoSyncIntervalMinutes);
    let syncMode;
    if (explicit === "always" || explicit === "startIfStale") {
        syncMode = explicit;
    }
    else if (explicit !== undefined) {
        syncMode = "always";
    }
    else if (configuredInterval !== undefined && configuredInterval > 0) {
        syncMode = "startIfStale";
    }
    else {
        syncMode = "always";
    }
    const intervalFallback = syncMode === "startIfStale" ? DEFAULT_START_IF_STALE_MINUTES : DEFAULT_ALWAYS_SYNC_INTERVAL_MINUTES;
    const autoSyncIntervalMinutes = configuredInterval !== undefined && configuredInterval > 0 ? configuredInterval : intervalFallback;
    const configuredBackground = finiteMinutes(config.backgroundSyncIntervalMinutes);
    const backgroundSyncIntervalMinutes = configuredBackground !== undefined && configuredBackground >= 0
        ? configuredBackground
        : DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES;
    const configuredRemote = finiteMinutes(config.remoteCheckIntervalMinutes);
    const remoteCheckIntervalMinutes = configuredRemote !== undefined && configuredRemote > 0
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
export function dirOf(deps) {
    if (deps?.dir)
        return path.resolve(deps.dir);
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
export function stripJsonComments(input) {
    let out = "";
    let quote = "";
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        const next = input[i + 1];
        if (quote) {
            out += c;
            if (escaped)
                escaped = false;
            else if (c === "\\")
                escaped = true;
            else if (c === quote)
                quote = "";
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            out += c;
        }
        else if (c === "/" && next === "/") {
            while (i < input.length && input[i] !== "\n" && input[i] !== "\r")
                i++;
            if (input[i] === "\r" && input[i + 1] === "\n") {
                i++;
                out += "\r\n";
            }
            else {
                out += "\n";
            }
        }
        else if (c === "/" && next === "*") {
            i += 2;
            while (i < input.length && !(input[i] === "*" && input[i + 1] === "/"))
                i++;
            i++;
        }
        else {
            out += c;
        }
    }
    return out;
}
export function isValidExtraPath(entry) {
    const trimmed = entry.trim();
    return trimmed !== "" && !trimmed.includes("..") && !path.isAbsolute(trimmed) && !isDenied(trimmed);
}
export async function readConfigFile(dir) {
    for (const filename of ["omp-sync.jsonc", "omp-sync.json", "git-sync.jsonc", "git-sync.json"]) {
        try {
            return await fs.readFile(path.join(dir, filename), "utf8");
        }
        catch { }
    }
    return undefined;
}
export async function readConfig(deps, ctx) {
    const dir = dirOf(deps);
    const rawText = await readConfigFile(dir);
    if (!rawText)
        return {};
    try {
        const raw = JSON.parse(stripJsonComments(rawText));
        const extras = (raw.extraPaths ?? []).filter(isValidExtraPath);
        let machineLocalSettings;
        if (Array.isArray(raw.machineLocalSettings)) {
            machineLocalSettings = raw.machineLocalSettings.filter((key) => typeof key === "string" && key.trim() !== "");
        }
        let machineLocalYamlKeys;
        if (Array.isArray(raw.machineLocalYamlKeys)) {
            machineLocalYamlKeys = raw.machineLocalYamlKeys.filter((key) => typeof key === "string" && key.trim() !== "");
        }
        return {
            ...raw,
            extraPaths: extras,
            machineLocalSettings,
            machineLocalYamlKeys,
        };
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=config.js.map