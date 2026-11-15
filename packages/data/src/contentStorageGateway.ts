export interface ContentGcStatus {
  readonly phase: "idle" | "recovery" | "backfill" | "prune" | "mark" | "sweep" | "failed" | string;
  readonly isCancellable: boolean;
}

export interface ContentStorageReport {
  readonly totalObjectCount: number;
  readonly totalBytes: number;
  readonly currentReferencedObjectCount: number;
  readonly currentReferencedBytes: number;
  readonly historyOnlyObjectCount: number;
  readonly historyOnlyBytes: number;
  readonly pinnedHistoryObjectCount: number;
  readonly pinnedHistoryBytes: number;
  readonly graceObjectCount: number;
  readonly graceBytes: number;
  readonly reclaimableObjectCount: number;
  readonly reclaimableBytes: number;
  readonly availableBytes: number;
  readonly isLowDiskSpace: boolean;
  readonly backfillStatus: "pending" | "running" | "complete" | "blocked" | string;
  readonly gcStatus: ContentGcStatus;
  readonly lastMarkAt?: string;
  readonly lastSweepAt?: string;
  readonly lastSuccessCount: number;
  readonly lastSuccessBytes: number;
  readonly lastErrorCode?: string;
}

export interface ContentGcRunReport {
  readonly prunedRevisionCount: number;
  readonly markedObjectCount: number;
  readonly deletedObjectCount: number;
  readonly deletedBytes: number;
  readonly cleanupWarnings: readonly string[];
}

export interface ContentStorageGateway {
  getReport(): Promise<ContentStorageReport>;
  getStatus(): Promise<ContentGcStatus>;
  scan(): Promise<number>;
  clean(includeGracePeriod: boolean): Promise<ContentGcRunReport>;
  cancel(): Promise<boolean>;
}
