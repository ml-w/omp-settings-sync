import type { OmpSyncConfig } from "./config.js";
export declare function stateDir(dir: string): string;
export declare function machineJsonKeys(config: OmpSyncConfig): string[];
export declare function machineYamlKeys(config: OmpSyncConfig): string[];
export declare function generateFilterScript(jsonKeys: string[], yamlKeys: string[]): string;
export declare function ensureAttributes(dir: string): Promise<void>;
export declare function isNodeInterpreter(execPath: string): boolean;
/** Git filters must spawn Node, not a packaged host like omp.exe (that re-enters this extension). */
export declare function resolveFilterInterpreter(execPath?: string, env?: NodeJS.ProcessEnv): string;
export declare function ensureFilter(dir: string, config?: OmpSyncConfig): Promise<void>;
export declare function refreshMachineSidecar(dir: string, config?: OmpSyncConfig): Promise<void>;
interface YamlBlock {
    key: string;
    lines: string[];
}
/** Top-level `key:` blocks, including nested lines that belong to that key. */
export declare function topLevelYamlBlocks(text: string): YamlBlock[];
/**
 * Put machine-local keys back into the working tree.
 *
 * Committed copies have those keys stripped. A checkout restores them only when
 * the smudge filter runs; `filter.required` is false, so a failed filter (for
 * example git invoking the omp binary) leaves `setupVersion` out and omp
 * onboards again. Merging the sidecar back does not depend on that filter.
 * Keys already present in the working tree are left alone.
 */
export declare function applyMachineSidecar(dir: string): Promise<void>;
export {};
//# sourceMappingURL=filter.d.ts.map