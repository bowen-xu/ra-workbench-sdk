export type ConceptAlgorithmKind = "concept_evolution" | "shared_foundations";

export interface ConceptEvolutionEvent {
  readonly ordinal: number;
  readonly conceptId: string;
  readonly conceptRevision: number;
  readonly conceptLabel: string;
  readonly paperId: string;
  readonly paperTitle: string;
  readonly issuedYear?: number;
  readonly assertionId: string;
  readonly assertionRevision: number;
  readonly paperFunction: "foundational" | "prerequisite" | "focal";
  readonly noveltyStatus: "pre_existing" | "adapted_by_paper" | "introduced_by_paper" | "unclear";
  readonly eventKind: "introduced" | "adapted" | "reused" | "unclear";
  readonly explanation: string;
  readonly evidenceAnchorId?: string;
}

export interface SharedFoundationConcept {
  readonly conceptId: string;
  readonly conceptRevision: number;
  readonly label: string;
  readonly weight: number;
}

export interface PaperFoundationSimilarity {
  readonly ordinal: number;
  readonly leftPaperId: string;
  readonly leftPaperTitle: string;
  readonly rightPaperId: string;
  readonly rightPaperTitle: string;
  readonly sharedConcepts: readonly SharedFoundationConcept[];
  readonly weightedJaccard: number;
  readonly sharedConceptCount: number;
  readonly leftFoundationCount: number;
  readonly rightFoundationCount: number;
}

export interface ConceptAlgorithmRun {
  readonly id: string;
  readonly algorithmKind: ConceptAlgorithmKind;
  readonly algorithmId: string;
  readonly algorithmVersion: number;
  readonly parametersHash: string;
  readonly conceptRevisionWatermark: number;
  readonly relationRevisionWatermark: number;
  readonly paperScopeHash: string;
  readonly status: "running" | "succeeded" | "failed" | "canceled" | "stale";
  readonly resultCount: number;
  readonly createdAt: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly evolutionEvents: readonly ConceptEvolutionEvent[];
  readonly foundationSimilarities: readonly PaperFoundationSimilarity[];
}

export interface SharedFoundationsDraft {
  readonly paperIds: readonly string[];
}
