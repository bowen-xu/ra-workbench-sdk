export interface ConceptRetrievalPreviewDraft {
  readonly clientRequestId: string;
  readonly paperId?: string;
  readonly query: string;
}

export interface ConceptRetrievalSeed {
  readonly conceptId: string;
  readonly conceptRevision: number;
  readonly label: string;
  readonly preferredTerm: string;
  readonly matchedBy: readonly ("lexical" | "vector")[];
  readonly lexicalRank?: number;
  readonly vectorRank?: number;
  readonly vectorDistance?: number;
  readonly rrfScore: number;
}

export interface ConceptRetrievalEdge {
  readonly relationAssertionId: string;
  readonly relationRevision: number;
  readonly subjectConceptId: string;
  readonly subjectLabel: string;
  readonly predicateKind: string;
  readonly objectConceptId: string;
  readonly objectLabel: string;
  readonly hop: number;
}

export interface ConceptRetrievalSource {
  readonly anchorId: string;
  readonly conceptId: string;
  readonly conceptLabel: string;
  readonly paperId: string;
  readonly paperTitle: string;
  readonly sourceKind: "definition_claim" | "term_usage";
  readonly sourceSubjectId: string;
  readonly sourceSubjectRevision: number;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly quoteExact: string;
  readonly contextText: string;
  readonly selected: boolean;
  readonly omissionReason?: "source_limit" | "duplicate_anchor";
}

export interface ConceptRetrievalPreview {
  readonly traceId: string;
  readonly semanticStatus: "used" | "unavailable";
  readonly embeddingSpaceId?: string;
  readonly indexGenerationId?: string;
  readonly seeds: readonly ConceptRetrievalSeed[];
  readonly edges: readonly ConceptRetrievalEdge[];
  readonly sources: readonly ConceptRetrievalSource[];
  readonly selectedSourceCount: number;
  readonly externalPaperCount: number;
  readonly contextSha256: string;
  readonly expiresAt: string;
}
