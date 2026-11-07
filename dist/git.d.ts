export declare function gitEnv(dir: string): NodeJS.ProcessEnv;
export declare function cleanStaleIndexLock(dir: string, maxAgeMs?: number): Promise<void>;
export declare function git(args: string[], dir: string, timeout?: number): Promise<{
    stdout: string;
    stderr: string;
}>;
export declare function gitRaw(args: string[], dir: string): Promise<{
    stdout: Buffer;
    stderr: Buffer;
}>;
export declare function hasDotGit(dir: string): Promise<boolean>;
export declare function hasCommits(dir: string): Promise<boolean>;
export declare function isSyncableRepo(dir?: string): Promise<boolean>;
export declare function upstreamRef(dir: string): Promise<string | undefined>;
export declare function countAheadBehind(upstream: string, dir: string): Promise<{
    behind: number;
    ahead: number;
}>;
export declare function fetchOrigin(dir: string): Promise<boolean>;
export declare function isRemoteReachable(dir: string): Promise<boolean>;
export declare function integrateUpstream(upstream: string, dir: string): Promise<boolean>;
export declare function pushOrigin(first: boolean | undefined, dir: string): Promise<boolean>;
export declare function hasLocalChanges(dir?: string): Promise<boolean>;
export declare function hasRemoteChanges(dir?: string): Promise<boolean>;
export declare function hasAnyChanges(dir?: string, checkRemote?: boolean): Promise<boolean>;
export interface ConflictState {
    hasConflicts: boolean;
    inRebase: boolean;
    inMerge: boolean;
    conflictedFiles: string[];
}
export declare function getConflictState(dir: string): Promise<ConflictState>;
export declare function getSyncDivergence(dir: string): Promise<{
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
}>;
//# sourceMappingURL=git.d.ts.map