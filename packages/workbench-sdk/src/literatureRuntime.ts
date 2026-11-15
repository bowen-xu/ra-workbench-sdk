import type {CollectionGateway} from "@research-assistant/data/collections";
import type {NalGateway, NalQueryGateway} from "@research-assistant/data/nal";
import type {
  DerivedResearchViewGateway, EvidenceGateway, EvidenceMatrixGateway, LiteratureGateway,
  ReferenceRecordGateway, ResearchExportGateway, ResearchKnowledgeGateway,
} from "@research-assistant/data/literature";

/** Existing methods needed by the production literature workspace's input and management flows.
 * App binds one discovered package identity; no invocation or HTTP handle is exposed. */
export interface RuntimeLiteraturePort {
  readonly literature: Pick<LiteratureGateway,
    "list" | "get" | "save" | "updateMetadataField" | "confirmMetadataFields" | "importBibtex" |
    "listDuplicates" | "listMergeOperations" | "decideDuplicate" | "mergeDuplicate" | "undoMerge" |
    "archive" | "restore" | "trash" | "trashMany" | "restoreTrash" | "listTrash" | "previewDoi" |
    "applyMetadataCandidate" | "applyMetadataCandidateFields" | "rejectMetadataCandidate" |
    "getImportJob" | "cancelImportJob" | "importPdfs" | "attachPdf" | "renameAttachment" |
    "removeAttachment" | "readAttachment" | "revealAttachments" | "saveReadingState" |
    "getReadingState" | "isAttachmentIndexed" | "indexAttachment">;
  readonly researchExport?: ResearchExportGateway;
  readonly evidence?: Pick<EvidenceGateway, "listClaims" | "listSources" | "listClaimEvidence"> & Partial<Pick<EvidenceGateway, "saveClaim" | "linkEvidence" | "createClaimWithEvidence">>;
  readonly evidenceMatrix?: EvidenceMatrixGateway;
  readonly derivedViews?: DerivedResearchViewGateway;
  readonly referenceRecords: Pick<ReferenceRecordGateway, "list" | "save">;
  readonly nal: NalGateway;
  /** Original concept management, human source capture and manual reading units. */
  readonly knowledge: Pick<ResearchKnowledgeGateway, "searchConcepts" | "saveConcept" | "listReadingUnits" | "saveReadingUnit">
    & Partial<Pick<ResearchKnowledgeGateway, "captureConceptUsage" | "saveDefinitionClaim" | "listDefinitionClaims" | "listRevisions" | "searchRelationNodes" | "saveRelationAssertion" | "listRelationAssertions" | "previewConceptMerge" | "mergeConcepts" | "splitConcepts" | "listConceptIdentityEvents" | "analyzeConceptEvolution" | "getConceptAlgorithmRun" | "analyzeSharedFoundations">>;
  /** Startup synchronizes the original query cache through its existing CAS. */
  readonly queries: NalQueryGateway;
}

/** Resolve the original App-selected domain port by identity at each call.
 * Without an explicit port, only browser mode uses the supplied fallback;
 * desktop and preview retain their existing missing-capability errors. */
export declare function resolveLiteratureRuntimeGateway(fallback: LiteratureGateway): LiteratureGateway;
export declare function resolveCollectionRuntimeGateway(fallback: CollectionGateway): CollectionGateway;
export declare function resolveNalRuntimeGateway(fallback: NalGateway): NalGateway;
export declare function resolveNalQueryRuntimeGateway(fallback: NalQueryGateway): NalQueryGateway;
export declare function resolveKnowledgeRuntimeGateway(fallback: ResearchKnowledgeGateway): ResearchKnowledgeGateway;
export declare function resolveEvidenceRuntimeGateway(fallback: EvidenceGateway): EvidenceGateway;
export declare function resolveEvidenceMatrixRuntimeGateway(fallback: EvidenceMatrixGateway): EvidenceMatrixGateway;
export declare function resolveDerivedViewRuntimeGateway(fallback: DerivedResearchViewGateway): DerivedResearchViewGateway;
export declare function resolveReferenceRecordRuntimeGateway(fallback: ReferenceRecordGateway): ReferenceRecordGateway;
/** Browser always retains its domain refusal port. Desktop and preview require
 * the explicitly selected export port, including the original preview transport. */
export declare function resolveResearchExportRuntimeGateway(browserFallback: ResearchExportGateway): ResearchExportGateway;
