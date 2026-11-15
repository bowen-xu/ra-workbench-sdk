export type EmbeddingJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";

export interface EmbeddingJobSummary {
  readonly jobId: string;
  readonly representationId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly status: EmbeddingJobState;
  readonly attempt: number;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly finishedAt?: string;
}

export interface SemanticIndexSpaceStatus {
  readonly embeddingSpaceId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision: string;
  readonly dimension: number;
  readonly generation: number;
  readonly generationStatus: "building" | "ready" | "active";
  readonly namespace:
    | "accepted_concepts"
    | "candidate_staging"
    | "definition_claims"
    | "source_passages";
  readonly readyCount: number;
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly staleCount: number;
}

export interface SemanticIndexStatus {
  readonly spaces: readonly SemanticIndexSpaceStatus[];
  readonly runningJobIds: readonly string[];
  readonly reconciliationRequired: boolean;
}

export interface SemanticIndexReconciliationSummary {
  readonly runId: string;
  readonly status: "running" | "succeeded" | "failed" | "canceled" | "interrupted";
  readonly checkedCount: number;
  readonly missingCount: number;
  readonly orphanCount: number;
  readonly repairedCount: number;
  readonly errorCode?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
}

export interface SemanticIndexGenerationSummary {
  readonly generationId: string;
  readonly embeddingSpaceId: string;
  readonly namespace: SemanticIndexSpaceStatus["namespace"];
  readonly generation: number;
  readonly status: "building" | "ready" | "active" | "superseded" | "failed";
  readonly recordCount: number;
  readonly readyCount: number;
  readonly createdAt: string;
  readonly activatedAt?: string;
}

export interface SemanticIndexGateway {
  getStatus(): Promise<SemanticIndexStatus>;
  getJob(jobId: string): Promise<EmbeddingJobSummary>;
  retryRepresentation(representationId: string): Promise<EmbeddingJobSummary>;
  cancelJob(jobId: string): Promise<boolean>;
  reconcile(): Promise<SemanticIndexReconciliationSummary>;
  rebuild(embeddingSpaceId: string): Promise<SemanticIndexGenerationSummary>;
}
