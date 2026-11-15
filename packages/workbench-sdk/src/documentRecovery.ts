export interface RecoveryDraftIdentity {
  readonly scope: string;
  readonly resourceId: string;
  readonly slot: string;
}
export interface RecoveryDraftEnvelope<T> extends RecoveryDraftIdentity {
  readonly schemaVersion: 1;
  readonly baseRevision?: number;
  readonly baseHash?: string;
  readonly payload: T;
  readonly updatedAt: string;
}

/** The original Core-selected recovery store and C00 consumer call forms.
 * These declarations add no Storage argument or runtime argument rejection.
 * A recovery draft preserves input; it is not an S/B commit or Keep receipt. */
export declare function clearRecoveryDraft(identity: RecoveryDraftIdentity): void;
export declare function createRecoveryDraft<T>(identity: RecoveryDraftIdentity, payload: T,
  base?: {readonly revision?: number; readonly hash?: string}): RecoveryDraftEnvelope<T>;
export declare function loadRecoveryDraft(identity: RecoveryDraftIdentity): RecoveryDraftEnvelope<unknown> | undefined;
export declare function saveRecoveryDraft<T>(draft: RecoveryDraftEnvelope<T>): void;
export declare const EDITOR_AUTOSAVE_IDLE_MS: 3000;
