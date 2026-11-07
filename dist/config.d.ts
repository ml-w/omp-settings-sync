import type { GhClient } from "./gh.js";
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
export declare const DEFAULT_START_IF_STALE_MINUTES = 10;
export declare const DEFAULT_ALWAYS_SYNC_INTERVAL_MINUTES = 1;
export declare const DEFAULT_BACKGROUND_SYNC_INTERVAL_MINUTES = 1;
export declare const DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES = 5;
export declare function resolveSyncSchedule(config: OmpSyncConfig): SyncSchedule;
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
        select?(title: string, options: Array<{
            label: string;
            value?: string;
            description?: string;
        }>): Promise<string | undefined>;
    };
}
export type Ctx = UIContext | undefined;
export declare const DEFAULT_MACHINE_LOCAL_JSON: string[];
export declare const DEFAULT_MACHINE_LOCAL_YAML: string[];
export declare function dirOf(deps?: Deps): string;
export declare function stripJsonComments(input: string): string;
export declare function isValidExtraPath(entry: string): boolean;
export declare function readConfigFile(dir: string): Promise<string | undefined>;
export declare function readConfig(deps?: Deps, ctx?: Ctx): Promise<OmpSyncConfig>;
//# sourceMappingURL=config.d.ts.map