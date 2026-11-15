/** Pure literature gateway contracts. Adapters and domain decoding retain their existing owners. */
import type { AttachmentSummary, AttachmentRemovalResult, DuplicateCandidate, ImportJob, LiteratureDraft, LiteratureItem, LiteratureMetadataPatch, MergeOperation, MetadataCandidateFieldDecision, MetadataCandidateTrust, MetadataPreview, PageText, PdfImportCandidate } from "@research-assistant/core/literature";
import type { ReaderViewStateV2 } from "@research-assistant/core/reader";
import type { Concept, ConceptAlgorithmRun, ConceptCaptureDraft, ConceptCaptureResult, ConceptDraft, ConceptIdentityEvent, ConceptMergeDraft, ConceptMergeImpact, ConceptSplitDraft, DefinitionClaim, DefinitionClaimDraft, PaperReadingProfileSelection, PaperReadingProfileSelectionDraft, ReadingProfile, RelationAssertion, RelationAssertionDraft, RelationNodeSummary, ResearchObjectKind, ResearchObjectRevision, StructuredReadingUnit, StructuredReadingUnitDraft, SharedFoundationsDraft } from "@research-assistant/core/knowledge";
import type { Claim, ClaimDraft, EvidenceLink, EvidenceLinkDraft, NewEvidenceDraft, SourceAnchorSummary } from "@research-assistant/core/evidence";
import type { EvidenceMatrix, EvidenceMatrixCell, EvidenceMatrixCellDraft, EvidenceMatrixDraft } from "@research-assistant/core/synthesis";
import type { DerivedResearchView, DerivedResearchViewDraft } from "@research-assistant/core/synthesis";
import type { ReferenceRecord, ReferenceRecordDraft } from "@research-assistant/core/synthesis";

export interface LiteratureGateway {
  list(query?: string): Promise<readonly LiteratureItem[]>;
  listTrash(query?: string): Promise<readonly LiteratureItem[]>;
  get(id: string): Promise<LiteratureItem>;
  save(draft: LiteratureDraft): Promise<LiteratureItem>;
  updateMetadataField(itemId: string, patch: LiteratureMetadataPatch): Promise<LiteratureItem>;
  confirmMetadataFields(itemId: string, fieldNames: readonly string[]): Promise<LiteratureItem>;
  importPdfs(candidates: readonly PdfImportCandidate[]): Promise<ImportJob>;
  importBibtex(drafts: readonly LiteratureDraft[]): Promise<ImportJob>;
  getImportJob(id: string): Promise<ImportJob>;
  listImportJobs(): Promise<readonly ImportJob[]>;
  cancelImportJob(id: string): Promise<void>;
  attachPdf(itemId: string, path: string): Promise<AttachmentSummary>;
  renameAttachment(itemId: string, attachmentId: string, displayName: string): Promise<void>;
  removeAttachment(itemId: string, attachmentId: string): Promise<AttachmentRemovalResult>;
  previewDoi(doi: string, itemId?: string): Promise<MetadataPreview>;
  applyMetadataCandidate(candidateId: string, draft: LiteratureDraft): Promise<LiteratureItem>;
  applyMetadataCandidateFields(
    candidateId: string,
    decisions: readonly MetadataCandidateFieldDecision[],
    candidateTrust: MetadataCandidateTrust,
  ): Promise<LiteratureItem>;
  rejectMetadataCandidate(candidateId: string): Promise<void>;
  readAttachment(attachmentId: string): Promise<Uint8Array>;
  revealAttachments(attachmentIds: readonly string[]): Promise<void>;
  saveReadingState(
    itemId: string,
    attachmentId: string,
    viewState: ReaderViewStateV2,
  ): Promise<void>;
  getReadingState(itemId: string, attachmentId: string): Promise<ReaderViewStateV2 | undefined>;
  listDuplicates(): Promise<readonly DuplicateCandidate[]>;
  decideDuplicate(candidateId: string, decision: "keep_both" | "dismiss"): Promise<void>;
  mergeDuplicate(candidateId: string, survivorItemId: string): Promise<MergeOperation>;
  listMergeOperations(): Promise<readonly MergeOperation[]>;
  undoMerge(operationId: string): Promise<void>;
  setProjects(itemId: string, projectIds: readonly string[]): Promise<void>;
  archive(itemId: string): Promise<void>;
  restore(itemId: string): Promise<void>;
  trash(itemId: string): Promise<void>;
  trashMany(itemIds: readonly string[]): Promise<void>;
  restoreTrash(itemId: string): Promise<void>;
  isAttachmentIndexed(attachmentId: string): Promise<boolean>;
  indexAttachment(itemId: string, attachmentId: string, pages: readonly PageText[]): Promise<void>;
}

export interface ConceptCaptureSourcePreview {
  readonly paperId: string;
  readonly paperTitle: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly quoteExact: string;
}


export interface ResearchKnowledgeGateway {
  /** Lists immutable, reviewed reading profile versions. */
  listReadingProfiles(): Promise<readonly ReadingProfile[]>;
  /** Reads the paper's confirmed profile composition or its implicit generic default. */
  getPaperReadingProfileSelection(paperId: string): Promise<PaperReadingProfileSelection>;
  /** Revisions a user-confirmed paper profile composition. */
  savePaperReadingProfileSelection(
    draft: PaperReadingProfileSelectionDraft,
  ): Promise<PaperReadingProfileSelection>;
  /** Reads current manual reading units. Rejects when persisted boundary data is invalid. */
  listReadingUnits(projectId?: string, paperId?: string): Promise<readonly StructuredReadingUnit[]>;
  /** Creates or revisions one manual reading unit and its requested evidence link atomically. */
  saveReadingUnit(draft: StructuredReadingUnitDraft): Promise<StructuredReadingUnit>;
  /** Finds concepts without merging records that happen to share a term. */
  searchConcepts(query: string): Promise<readonly Concept[]>;
  /** Previews a user-selected concept identity merge without changing knowledge. */
  previewConceptMerge(draft: ConceptMergeDraft): Promise<ConceptMergeImpact>;
  /** Creates reversible old-ID mappings after an explicit preview. */
  mergeConcepts(draft: ConceptMergeDraft): Promise<ConceptIdentityEvent>;
  /** Restores selected old concept IDs from one merge event. */
  splitConcepts(draft: ConceptSplitDraft): Promise<ConceptIdentityEvent>;
  /** Lists immutable merge/split history with currently active mappings. */
  listConceptIdentityEvents(): Promise<readonly ConceptIdentityEvent[]>;
  /** Creates or revisions one concept, rejecting stale expected revisions. */
  saveConcept(draft: ConceptDraft): Promise<Concept>;
  /** Persists a selected term usage and its explicit resolution without AI involvement. */
  captureConceptUsage(
    draft: ConceptCaptureDraft,
    source: ConceptCaptureSourcePreview,
  ): Promise<ConceptCaptureResult>;
  /** Reads the competing definition claims currently attached to a concept. */
  listDefinitionClaims(conceptId: string): Promise<readonly DefinitionClaim[]>;
  /** Creates or revisions one definition claim, rejecting stale expected revisions. */
  saveDefinitionClaim(draft: DefinitionClaimDraft): Promise<DefinitionClaim>;
  /** Searches heterogeneous graph endpoints without merging similarly named objects. */
  searchRelationNodes(query: string): Promise<readonly RelationNodeSummary[]>;
  /** Creates or revisions one human relation assertion and optional evidence link as one operation. */
  saveRelationAssertion(draft: RelationAssertionDraft): Promise<RelationAssertion>;
  /** Reads current relation assertions, optionally scoped to one project. */
  listRelationAssertions(projectId?: string): Promise<readonly RelationAssertion[]>;
  /** Reads immutable history snapshots for one research object. */
  listRevisions(
    objectKind: ResearchObjectKind,
    objectId: string,
  ): Promise<readonly ResearchObjectRevision[]>;
  /** Builds a dated timeline from accepted paper-concept assertions without generating new facts. */
  analyzeConceptEvolution(conceptId: string): Promise<ConceptAlgorithmRun>;
  /** Compares selected papers on the accepted Paper–foundational Concept bipartite graph. */
  analyzeSharedFoundations(draft: SharedFoundationsDraft): Promise<ConceptAlgorithmRun>;
  /** Reloads one immutable derived algorithm result. */
  getConceptAlgorithmRun(runId: string): Promise<ConceptAlgorithmRun>;
}

export interface EvidenceGateway {
  /** Reads current claims; rejects when boundary data cannot be decoded safely. */
  listClaims(projectId?: string): Promise<readonly Claim[]>;
  /** Creates or revisions one manual claim and rejects stale expected revisions. */
  saveClaim(draft: ClaimDraft): Promise<Claim>;
  /** Reads source anchors without changing their attachment-version identity. */
  listSources(projectId?: string): Promise<readonly SourceAnchorSummary[]>;
  /** Adds one evidence relation to an existing claim. */
  linkEvidence(draft: EvidenceLinkDraft): Promise<EvidenceLink>;
  /** Creates or revisions a claim and adds its evidence relation in one desktop transaction. */
  createClaimWithEvidence(claim: ClaimDraft, evidence: NewEvidenceDraft): Promise<Claim>;
  /** Reads all evidence relations for one claim. */
  listClaimEvidence(claimId: string): Promise<readonly EvidenceLink[]>;
}

export interface EvidenceMatrixGateway {
  list(projectId: string): Promise<readonly EvidenceMatrix[]>;
  save(draft: EvidenceMatrixDraft): Promise<EvidenceMatrix>;
  listCells(matrixId: string): Promise<readonly EvidenceMatrixCell[]>;
  saveCell(draft: EvidenceMatrixCellDraft): Promise<EvidenceMatrixCell>;
}

export interface DerivedResearchViewGateway {
  list(projectId: string): Promise<readonly DerivedResearchView[]>;
  save(draft: DerivedResearchViewDraft): Promise<DerivedResearchView>;
}

export interface ReferenceRecordGateway {
  list(paperId: string): Promise<readonly ReferenceRecord[]>;
  save(draft: ReferenceRecordDraft): Promise<ReferenceRecord>;
}

export type ResearchExportErrorCode =
  | "invalid_target"
  | "destination_exists"
  | "too_large"
  | "busy"
  | "operation_cancelled"
  | "export_failed"
  | "unavailable";

export interface ResearchExportReport {
  readonly folderName: string;
  readonly fileCount: number;
  readonly objectCount: number;
  readonly sourceCount: number;
}

export interface ResearchExportGateway {
  exportAll(targetDirectory: string): Promise<ResearchExportReport>;
  cancel(): Promise<boolean>;
}

/** App provides only the two fixed wire operations; domain decoding stays in
 * the literature adapter before any result is accepted by its consumers. */
export interface ResearchExportTransport {
  exportAll(targetDirectory: string): Promise<unknown>;
  cancel(): Promise<unknown>;
}
