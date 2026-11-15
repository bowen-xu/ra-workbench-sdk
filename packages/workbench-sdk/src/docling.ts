interface DoclingParseTaskStatus {
  readonly id: string;
  readonly state: "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  readonly stage: string;
  readonly completedPages: number;
  readonly totalPages: number;
  readonly parseRunId?: string | null;
  readonly error?: {readonly code: string; readonly message: string} | null;
}
interface DoclingParseRunSummary {
  readonly id: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly serviceBaseUrl: string;
  readonly doclingStatus: string;
  readonly parseStatus: "running" | "success" | "partial_success" | "failure";
  readonly errorMessage?: string;
  readonly processingTimeSeconds?: number;
  readonly createdAt: string;
  readonly finishedAt: string;
}
interface DoclingParseRunDetail extends DoclingParseRunSummary {
  readonly jsonContent?: unknown;
  readonly rawResponse: unknown;
}

export interface DoclingOverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface DoclingOverlayRegion {
  readonly pageIndex: number;
  readonly rect: DoclingOverlayRect;
}
export interface DoclingOverlayItem {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly textPreview?: string;
  readonly regions: readonly DoclingOverlayRegion[];
  readonly rawRef: string;
}
export interface DoclingPageOverlay {
  readonly attachmentId: string;
  readonly parseRunId: string;
  readonly pageIndex: number;
  readonly pageSize?: {readonly width: number; readonly height: number};
  readonly items: readonly DoclingOverlayItem[];
}

/** Matches Core's existing seven-operation parser Pick. Model installation,
 * service configuration and shared execution ownership remain outside it. */
export interface DoclingParserGateway {
  startParseTask(itemId: string, attachmentId: string, options?: {readonly force: boolean}): Promise<DoclingParseTaskStatus>;
  getParseTask(taskId: string): Promise<DoclingParseTaskStatus>;
  cancelParseTask(taskId: string): Promise<DoclingParseTaskStatus>;
  parseAttachment(itemId: string, attachmentId: string, options?: {readonly force: boolean}): Promise<DoclingParseRunDetail>;
  listParseRuns(itemId: string): Promise<readonly DoclingParseRunSummary[]>;
  getParseRun(runId: string): Promise<DoclingParseRunDetail>;
  getPageOverlay(attachmentId: string, pageIndex: number, parseRunId?: string): Promise<DoclingPageOverlay>;
}

/** Uses the original runtime-selected Core adapter and task/recovery path. */
export declare function getDoclingParserGateway(): DoclingParserGateway;
export declare function doclingErrorMessage(reason: unknown): string;

/** Reuses Core's task, cancellation and global feedback across panel navigation.
 * Display metadata does not confer service-lifecycle or model-management access. */
export declare function runDoclingParse(
  gateway: DoclingParserGateway,
  itemId: string,
  attachmentId: string,
  document: {readonly paperTitle: string; readonly fileName: string},
  force?: boolean,
): Promise<DoclingParseRunDetail | undefined>;
