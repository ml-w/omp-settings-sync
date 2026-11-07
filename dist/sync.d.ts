import type { Ctx, Deps } from "./config.js";
export declare const STATUS_KEY = "omp-git-sync";
export declare function renderProgressBar(percentage: number, stage: string): string;
export declare function updateSyncProgress(ctx: Ctx, percentage: number, stage: string): void;
export declare function clearSyncProgress(ctx: Ctx): void;
export declare function prepareCommit(deps?: Deps, ctx?: Ctx): Promise<import("./config.js").OmpSyncConfig>;
export declare function commitLocalChanges(deps?: Deps, commitMessage?: string, ctx?: Ctx): Promise<boolean>;
export declare function runInit(arg: string, ctx?: Ctx, deps?: Deps, options?: {
    password?: string;
    enableVault?: boolean;
}): Promise<void>;
export declare function runLink(arg: string, ctx?: Ctx, deps?: Deps, options?: {
    password?: string;
}): Promise<void>;
export declare function showStatus(ctx: Ctx, deps?: Deps): Promise<void>;
export declare function runReset(ctx: Ctx, deps?: Deps): Promise<void>;
export declare function runSync(ctx: Ctx, options: {
    auto: boolean;
    push: boolean;
    skipPull?: boolean;
    discardLocal?: boolean;
}, deps?: Deps): Promise<void>;
export declare function checkAndBackgroundSync(ctx: Ctx, deps?: Deps): Promise<boolean>;
export declare function runUnlockVault(passwordArg?: string, ctx?: Ctx, deps?: Deps): Promise<void>;
export declare function runEnableVault(passwordArg?: string, ctx?: Ctx, deps?: Deps): Promise<void>;
export declare function runDisableVault(ctx?: Ctx, deps?: Deps): Promise<void>;
export declare function runLockVault(ctx?: Ctx, deps?: Deps): Promise<void>;
//# sourceMappingURL=sync.d.ts.map