export interface GhClient {
    available(): Promise<boolean>;
    currentUser(): Promise<string>;
    repoExists(id: string): Promise<boolean>;
    isPrivate(id: string): Promise<boolean | undefined>;
    createPrivateRepo(id: string): Promise<void>;
    remoteUrl(id: string): string;
    setupGit(dir?: string): Promise<void>;
}
export declare const DEFAULT_SYNC_REPO_NAME = "OhMyPiSyncData";
export declare const LIKELY_SYNC_REPO_NAMES: string[];
export declare function parseRepoReference(input: string, fallbackOwner: string): {
    owner: string;
    name: string;
} | undefined;
export declare function remoteFromArg(arg: string, fallbackOwner: string): string | undefined;
export declare const defaultGh: GhClient;
//# sourceMappingURL=gh.d.ts.map