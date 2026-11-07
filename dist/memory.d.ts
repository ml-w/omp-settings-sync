/** Write fresh snapshots of every live database. Unchanged databases leave the repo untouched. */
export declare function writeMemorySnapshots(dir: string): Promise<{
    updated: string[];
    errors: string[];
}>;
/** True when a live database has content that its tracked snapshot does not. */
export declare function memoryHasChanges(dir: string): Promise<boolean>;
/** sha256 of every snapshot file currently in the working tree, keyed by relative path. */
export declare function memorySnapshotHashes(dir: string): Promise<Map<string, string>>;
/**
 * Restore snapshots over the live databases. With `only`, restore just those snapshot paths
 * (used after a pull so that unrelated local writes are not overwritten). A live database whose
 * content differs is first saved as `mnemopi.db.pre-sync` (hard-denied, never committed).
 * Restart omp afterwards: a running process keeps the old database open.
 */
export declare function restoreMemorySnapshots(dir: string, only?: Iterable<string>): Promise<string[]>;
//# sourceMappingURL=memory.d.ts.map