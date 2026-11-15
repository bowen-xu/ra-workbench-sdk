/** Return Core's currently selected Storage instance. Existing reads, writes
 * and errors are unchanged; a captured object retains its original owner
 * after another runtime is selected. This does not expose runtime selection. */
export declare function getAppStorage(): Storage;

/** Persistence belongs to the captured Storage owner. */
export interface StoragePersistence {
  readonly backend: "IndexedDB";
  readonly pending: boolean;
  readonly error: Error | undefined;
  readonly resetting: boolean;
  flush(): Promise<void>;
  assertCurrent?(): Promise<void>;
  retry(): Promise<void>;
  reset(beforeClear?: () => void): Promise<void>;
  subscribe(changed: () => void): () => void;
  close(): void;
}

export declare function storagePersistence(storage: Storage): StoragePersistence | undefined;
export declare function flushStorage(storage: Storage): Promise<void>;
