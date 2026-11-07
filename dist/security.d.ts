import type { OmpSyncConfig } from "./config.js";
export declare const START_MARKER = "# >>> omp-config-sync managed \u2014 do not edit inside this block";
export declare const END_MARKER = "# <<< omp-config-sync managed";
export declare const LEGACY_MARKERS: Array<[string, string]>;
export declare const DEFAULT_ALLOWED_PATHS: string[];
export declare const HARD_DENY_PATTERNS: string[];
export declare function isDenied(file: string): boolean;
export declare function ensureIgnoreRules(dir: string, config?: OmpSyncConfig): Promise<void>;
export declare function ensureInfoExclude(dir: string): Promise<void>;
export declare function stagedSecretFiles(dir: string): Promise<string[]>;
export declare function trackedSecretFiles(dir: string): Promise<string[]>;
//# sourceMappingURL=security.d.ts.map