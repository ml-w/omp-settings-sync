export interface EncryptedVaultFile {
    version: 1;
    kdf: "scrypt";
    salt: string;
    iv: string;
    tag: string;
    ciphertext: string;
}
export interface VaultPayload {
    updatedAt: string;
    files: Record<string, string>;
}
export declare function encryptPayload(payload: VaultPayload, password: string): string;
export declare function decryptPayload(encryptedJson: string, password: string): VaultPayload;
export declare function atomicWriteFile(targetPath: string, content: string | Buffer, mode?: number): Promise<void>;
export declare function vaultPath(dir: string): string;
export declare function hasVaultFile(dir: string): Promise<boolean>;
export declare function readVaultFile(dir: string): Promise<string | undefined>;
export declare function writeVaultFile(dir: string, content: string): Promise<void>;
export declare function deleteVaultFile(dir: string): Promise<void>;
export declare function cacheVaultPassword(dir: string, password: string): Promise<void>;
export declare function getCachedVaultPassword(dir: string): Promise<string | undefined>;
export declare function clearCachedVaultPassword(dir: string): Promise<void>;
export declare const SYNCABLE_SENSITIVE_FILES: string[];
export declare function hashSensitiveFiles(dir: string): Promise<string>;
export declare function getSavedSensitiveHash(dir: string): Promise<string | undefined>;
export declare function saveSensitiveHash(dir: string, hash: string): Promise<void>;
export declare function hasSensitiveChanges(dir: string): Promise<boolean>;
export declare function packSensitiveFiles(dir: string): Promise<VaultPayload>;
export declare function unpackSensitiveFiles(dir: string, payload: VaultPayload): Promise<string[]>;
export declare function getVaultStatus(dir: string): Promise<"disabled" | "locked" | "unlocked">;
//# sourceMappingURL=vault.d.ts.map