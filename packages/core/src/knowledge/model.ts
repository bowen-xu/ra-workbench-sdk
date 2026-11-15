export type KnowledgeProvenanceKind =
  | "human_original"
  | "ai_accepted_unchanged"
  | "ai_accepted_after_edit"
  | "legacy_ai";

export type KnowledgeEpistemicRole =
  | "assertion"
  | "source_paraphrase"
  | "synthesis"
  | "inference"
  | "hypothesis"
  | "question"
  | "definition"
  | "working_note";

export type ResearchObjectKind =
  | "claim"
  | "reading_unit"
  | "term"
  | "concept"
  | "term_usage"
  | "definition_claim"
  | "relation_assertion";

export interface ResearchObjectRevision {
  readonly id: string;
  readonly objectKind: ResearchObjectKind;
  readonly objectId: string;
  readonly revision: number;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly editorKind: "human" | "migration" | "ai_review" | "system";
  readonly changeReason: string;
  readonly createdAt: string;
}

export const STRUCTURED_READING_UNIT_KINDS = [
  "research_question",
  "approach",
  "key_result",
  "conclusion",
  "limitation",
  "open_question",
  "argument",
  "objection",
  "response",
  "other",
] as const;

export type StructuredReadingUnitKind = (typeof STRUCTURED_READING_UNIT_KINDS)[number];

export type ReadingProfileKind =
  | "generic"
  | "technical_empirical"
  | "philosophical_conceptual";

export interface ReadingProfileRef {
  readonly profileId: string;
  readonly profileVersion: number;
}

export interface ReadingProfile extends ReadingProfileRef {
  readonly profileKind: ReadingProfileKind;
  readonly label: string;
  readonly description: string;
  readonly fieldKinds: readonly StructuredReadingUnitKind[];
  readonly reviewStatus: "approved";
  readonly createdAt: string;
}

export interface PaperReadingProfileSelectionDraft {
  readonly paperId: string;
  readonly profiles: readonly ReadingProfileRef[];
  readonly expectedRevision: number;
  readonly changeReason?: string;
}

export interface PaperReadingProfileSelection {
  readonly paperId: string;
  readonly profiles: readonly ReadingProfileRef[];
  readonly revision: number;
  readonly isPersisted: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface StructuredReadingUnitDraft {
  readonly id?: string;
  readonly projectId?: string;
  readonly paperId?: string;
  readonly unitKind: StructuredReadingUnitKind;
  readonly title: string;
  readonly body: string;
  readonly epistemicRole: Exclude<KnowledgeEpistemicRole, "assertion" | "definition">;
  readonly anchorId?: string;
  readonly evidenceStance?: "supports" | "opposes" | "context";
  readonly evidenceRationale?: string;
  readonly expectedRevision?: number;
  readonly changeReason?: string;
}

export interface StructuredReadingUnit {
  readonly templateField?: { readonly portraitCandidateId: string; readonly fieldId: string };
  readonly id: string;
  readonly projectId?: string;
  readonly projectTitle?: string;
  readonly paperId?: string;
  readonly paperTitle?: string;
  readonly unitKind: StructuredReadingUnitKind;
  readonly title: string;
  readonly body: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly epistemicRole: StructuredReadingUnitDraft["epistemicRole"];
  readonly revision: number;
  readonly evidenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Term {
  readonly id: string;
  readonly text: string;
  readonly normalizedText: string;
  readonly language: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConceptDraft {
  readonly id?: string;
  readonly preferredTerm: string;
  readonly language?: string;
  readonly label: string;
  readonly explanation: string;
  readonly disambiguation: string;
  readonly domain: string;
  readonly tradition: string;
  readonly period: string;
  readonly expectedRevision?: number;
  readonly changeReason?: string;
}

export interface Concept {
  readonly id: string;
  readonly preferredTerm: Term;
  readonly terms: readonly Term[];
  readonly label: string;
  readonly explanation: string;
  readonly disambiguation: string;
  readonly domain: string;
  readonly tradition: string;
  readonly period: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly revision: number;
  readonly definitionCount: number;
  readonly sourceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConceptIdentitySummary {
  readonly id: string;
  readonly label: string;
  readonly revision: number;
  readonly termCount: number;
  readonly definitionCount: number;
  readonly sourceCount: number;
}

export interface ConceptMergeImpact {
  readonly survivor: ConceptIdentitySummary;
  readonly sources: readonly ConceptIdentitySummary[];
  readonly affectedRelationIds: readonly string[];
}

export interface ConceptMergeDraft {
  readonly survivorId: string;
  readonly survivorExpectedRevision: number;
  readonly sources: readonly { readonly id: string; readonly expectedRevision: number }[];
  readonly rationale: string;
}

export interface ConceptSplitDraft {
  readonly mergeEventId: string;
  readonly sourceConceptIds: readonly string[];
  readonly rationale: string;
}

export interface ConceptIdentityEvent {
  readonly id: string;
  readonly operation: "merge" | "split";
  readonly survivor: ConceptIdentitySummary;
  readonly sources: readonly ConceptIdentitySummary[];
  readonly affectedRelationIds: readonly string[];
  readonly activeSourceIds: readonly string[];
  readonly rationale: string;
  readonly createdAt: string;
}

export interface DefinitionClaimDraft {
  readonly id?: string;
  readonly conceptId: string;
  readonly statement: string;
  readonly scopeNote: string;
  readonly anchorId?: string;
  readonly expectedRevision?: number;
  readonly changeReason?: string;
}

export interface DefinitionClaim {
  readonly id: string;
  readonly conceptId: string;
  readonly statement: string;
  readonly scopeNote: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly epistemicRole: "definition";
  readonly revision: number;
  readonly evidenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TermUsage {
  readonly id: string;
  readonly term: Term;
  readonly conceptId?: string;
  readonly anchorId: string;
  readonly paperId: string;
  readonly paperTitle: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly quoteExact: string;
  readonly usageText: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ConceptResolutionDraft =
  | {
      readonly kind: "create_new";
      readonly concept: Omit<ConceptDraft, "id" | "preferredTerm" | "language" | "expectedRevision">;
      readonly definitionStatement?: string;
    }
  | {
      readonly kind: "link_existing";
      readonly conceptId: string;
      readonly definitionStatement?: string;
    }
  | { readonly kind: "unresolved" };

export interface ConceptCaptureDraft {
  readonly termText: string;
  readonly language?: string;
  readonly anchorId: string;
  readonly usageText: string;
  readonly resolution: ConceptResolutionDraft;
}

export interface ConceptCaptureResult {
  readonly term: Term;
  readonly concept?: Concept;
  readonly usage: TermUsage;
  readonly definitionClaim?: DefinitionClaim;
}

export const RELATION_NODE_KINDS = [
  "concept",
  "definition_claim",
  "reading_unit",
  "paper",
  "note_page",
] as const;

export type RelationNodeKind = (typeof RELATION_NODE_KINDS)[number];

export const RELATION_PREDICATE_KINDS = [
  "broader_than",
  "narrower_than",
  "competes_with",
  "historically_derived_from",
  "approximately_corresponds_to",
  "defines",
  "discusses",
  "supports",
  "opposes",
  "related_to",
  "depends_on",
  "builds_on",
  "extends",
  "redefines",
  "contrasts_with",
  "part_of",
] as const;

export type RelationPredicateKind = (typeof RELATION_PREDICATE_KINDS)[number];

export interface RelationNodeRef {
  readonly kind: RelationNodeKind;
  readonly id: string;
}

export interface RelationNodeSummary extends RelationNodeRef {
  readonly label: string;
  readonly detail: string;
}

export interface RelationAssertionDraft {
  readonly id?: string;
  readonly projectId?: string;
  readonly subject: RelationNodeRef;
  readonly predicateKind: RelationPredicateKind;
  readonly object: RelationNodeRef;
  readonly scopeNote: string;
  readonly anchorId?: string;
  readonly evidenceStance?: "supports" | "opposes" | "context";
  readonly evidenceRationale?: string;
  readonly expectedRevision?: number;
  readonly changeReason?: string;
}

export interface RelationAssertion {
  readonly id: string;
  readonly projectId?: string;
  readonly projectTitle?: string;
  readonly subject: RelationNodeSummary;
  readonly predicateKind: RelationPredicateKind;
  readonly object: RelationNodeSummary;
  readonly scopeNote: string;
  readonly provenanceKind: Exclude<KnowledgeProvenanceKind, "legacy_ai">;
  readonly epistemicRole: "assertion";
  readonly revision: number;
  readonly evidenceCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
