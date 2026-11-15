import type { SourceRect } from "./literature";
import type { KnowledgeEpistemicRole, KnowledgeProvenanceKind } from "./knowledge/model";

export type ClaimOrigin = "user" | "ai";
export type EvidenceStance = "supports" | "opposes" | "context";

export interface ClaimDraft {
  readonly id?: string;
  readonly projectId?: string;
  readonly statement: string;
  readonly epistemicRole: Extract<
    KnowledgeEpistemicRole,
    "assertion" | "source_paraphrase" | "synthesis" | "inference" | "hypothesis" | "question" | "working_note"
  >;
  readonly expectedRevision?: number;
  readonly changeReason?: string;
}

export interface Claim {
  readonly id: string;
  readonly projectId?: string;
  readonly projectTitle?: string;
  readonly statement: string;
  readonly origin: ClaimOrigin;
  readonly provenanceKind: KnowledgeProvenanceKind;
  readonly epistemicRole: ClaimDraft["epistemicRole"];
  readonly revision: number;
  readonly evidenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceAnchorSummary {
  readonly anchorId: string;
  readonly annotationId?: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly attachmentId: string;
  readonly attachmentName: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly SourceRect[];
  readonly quoteExact: string;
  readonly quotePrefix: string;
  readonly quoteSuffix: string;
  readonly annotationType?: "highlight" | "note";
  readonly annotationBody: string;
  readonly createdAt: string;
}

export interface EvidenceLinkDraft {
  readonly claimId: string;
  readonly anchorId: string;
  readonly stance: EvidenceStance;
  readonly rationale: string;
}

export interface NewEvidenceDraft {
  readonly anchorId: string;
  readonly stance: EvidenceStance;
  readonly rationale: string;
}

export interface EvidenceLink {
  readonly id: string;
  readonly claimId: string;
  readonly stance: EvidenceStance;
  readonly rationale: string;
  readonly source: SourceAnchorSummary;
  readonly createdAt: string;
}
