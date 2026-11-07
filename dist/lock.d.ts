import type { Ctx, Deps } from "./config.js";
export declare const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES = 1;
export declare const DEFAULT_REMOTE_CHECK_INTERVAL_MINUTES = 5;
export declare function acquireInProcessMutex(dir: string): Promise<() => void>;
export declare function stateDir(dir: string): string;
export declare function lockPath(dir: string): string;
export declare function statePath(dir: string): string;
export declare function isSubagentChild(): boolean;
export interface SyncState {
    lastAutoSyncAt?: string;
    lastRemoteCheckAt?: string;
}
export declare function readSyncState(dir: string): Promise<SyncState>;
export declare function writeSyncState(state: Partial<SyncState>, dir?: string): Promise<void>;
export declare function shouldAutoSync(deps?: Deps): Promise<boolean>;
export declare function shouldCheckRemote(deps?: Deps, minIntervalMinutes?: number): Promise<boolean>;
export declare function withLock<T>(ctx: Ctx, fn: () => Promise<T>, deps?: Deps): Promise<T | undefined>;
//# sourceMappingURL=lock.d.ts.map