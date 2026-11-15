import type {
  NoteBlockId,
  NoteDocumentV1,
  NoteLifecycleStatus,
  NoteLink,
  NoteLinkDraft,
  NotePage,
  NotePageDraft,
  NotePageId,
  NoteMetadataBatchRequest,
  NoteMetadataBatchReceipt,
  NoteRevisionId,
  ReadingNoteBlock,
  ReadingNoteDraft,
} from "@research-assistant/core/notes";
import type { SourceRect } from "@research-assistant/core/literature";

export interface NoteListQuery {
  readonly kind?: "ordinary" | "all";
  readonly status?: NoteLifecycleStatus;
  readonly parentPageId?: NotePageId;
  readonly projectId?: string;
  readonly tagId?: string;
  readonly search?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface ReadingNoteListQuery extends NoteListQuery {
  readonly paperId?: string;
  readonly noteType?: ReadingNoteBlock["noteType"];
  readonly sourceState?: ReadingNoteBlock["source"]["state"];
}

export interface NotePageMoveRequest {
  readonly pageId: NotePageId;
  readonly parentPageId?: NotePageId;
  readonly position: number;
  readonly expectedRevision: number;
}

export interface NotePageMetadataUpdate {
  readonly pageId: NotePageId;
  readonly title?: string;
  readonly isFavorite?: boolean;
  readonly projectIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly expectedRevision: number;
}

export interface NoteStatusUpdate<TId extends string> {
  readonly id: TId;
  readonly status: NoteLifecycleStatus;
  readonly expectedRevision: number;
}

export interface NotePermanentDeleteRequest<TId extends string> {
  readonly id: TId;
  readonly expectedRevision: number;
}

export interface NotePermanentDeleteReport {
  readonly scheduledAssetCount: number;
  readonly estimatedReclaimableBytes: number;
  readonly cleanupWarnings: readonly string[];
}

export interface NoteDocumentSnapshot {
  readonly page: NotePage;
  readonly document: NoteDocumentV1;
}

export interface NoteDocumentSaveRequest {
  readonly document: NoteDocumentV1;
  readonly expectedRevision: number;
  readonly saveReason: "autosave" | "manual" | "import" | "restore" | "structure";
}

/** Atomic sidebar gesture: all bodies and the complete favorite order use CAS. */
export interface NoteNavigationCommit {
  readonly documents: readonly NoteDocumentSaveRequest[];
  readonly expectedFavoriteIds: readonly NotePageId[];
  readonly favoriteIds: readonly NotePageId[];
}

/** One atomic, idempotent user resolution of body and obsolete review state. */
export interface NoteConflictResolutionRequest {
  readonly requestId: string;
  readonly document: NoteDocumentV1;
  readonly expectedRevision: number;
  readonly copy: boolean;
}
export interface NoteConflictResolutionReceipt {
  readonly original: NoteDocumentSnapshot;
  readonly copy?: NoteDocumentSnapshot;
}

export interface NoteRevisionSummary {
  readonly id: NoteRevisionId;
  readonly pageId: NotePageId;
  readonly pageRevision: number;
  readonly reason: NoteDocumentSaveRequest["saveReason"];
  readonly createdAt: string;
  readonly isPinned: boolean;
}

export interface ReadingNoteUpdate {
  readonly id: NoteBlockId;
  readonly color?: string;
  /** Only unquoted position annotations may move within their source page. */
  readonly position?: SourceRect;
  readonly isFavorite?: boolean;
  readonly projectIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly expectedRevision: number;
}

export interface NoteSearchQuery extends ReadingNoteListQuery {
  readonly objectKinds?: readonly ("note_page" | "reading_note")[];
  readonly isFavorite?: boolean;
}

export interface NoteSearchResult {
  readonly objectKind: "note_page" | "reading_note";
  readonly objectId: string;
  readonly title: string;
  readonly snippet: string;
  readonly updatedAt: string;
  readonly source?: ReadingNoteBlock["source"];
}

export interface NoteSearchPage {
  readonly items: readonly NoteSearchResult[];
  readonly nextCursor?: string;
  readonly indexState: "ready" | "dirty" | "rebuilding" | "failed";
}

export interface NoteAsset {
  readonly id: string;
  readonly displayName: string;
  readonly mimeType: string;
  readonly byteSize: number;
}

export interface NoteAssetImportRequest {
  readonly displayName: string;
  readonly mimeType: string;
  readonly bytes: readonly number[];
}

export interface NoteAssetGateway {
  importNoteAsset(request: NoteAssetImportRequest): Promise<NoteAsset>;
  cancelNoteAssetImport(): Promise<boolean>;
  readNoteAsset(id: string): Promise<Uint8Array>;
}

export interface NoteExportFile {
  readonly relativePath: string;
  readonly contents: string;
}

export interface NoteExportAsset {
  readonly id: string;
  readonly relativePath: string;
}

export interface NoteExportRequest {
  readonly targetDirectory: string;
  readonly folderName: string;
  readonly manifestJson: string;
  readonly files: readonly NoteExportFile[];
  readonly assets: readonly NoteExportAsset[];
}

export interface NoteExportReport {
  readonly folderName: string;
  readonly fileCount: number;
  readonly assetCount: number;
}

export interface NoteTransferGateway {
  exportNotes(request: NoteExportRequest): Promise<NoteExportReport>;
  cancelNoteExport(): Promise<boolean>;
}

export interface NoteTag {
  readonly id: string;
  readonly name: string;
}

export interface NoteTagGateway {
  listNoteTags(): Promise<readonly NoteTag[]>;
  ensureNoteTag(name: string): Promise<NoteTag>;
}

export interface NotePageGateway {
  listPageMetadata(ids: readonly NotePageId[]): Promise<readonly NotePage[]>;
  applyMetadataBatch(request: NoteMetadataBatchRequest): Promise<NoteMetadataBatchReceipt>;
  replayMetadataBatch?(request:import("@research-assistant/core/notes").NoteMetadataReplayRequest):Promise<NoteMetadataBatchReceipt>;
  listFavoritePageIds(): Promise<readonly NotePageId[]>;
  reorderFavorites(request: { readonly pageIds: readonly NotePageId[]; readonly expectedPageIds: readonly NotePageId[] }): Promise<void>;
  /** Independent paper-linked documents, including unquoted page/position sticky notes. */
  listLiteratureNotes(paperId: string): Promise<readonly LiteratureNoteSummary[]>;
  createLiteratureNote(paperId: string): Promise<NoteDocumentSnapshot>;
  listPages(query?: NoteListQuery): Promise<readonly NotePage[]>;
  createPage(draft: NotePageDraft): Promise<NoteDocumentSnapshot>;
  updatePage(request: NotePageMetadataUpdate): Promise<NotePage>;
  movePage(request: NotePageMoveRequest): Promise<NotePage>;
  duplicatePage(pageId: NotePageId): Promise<NoteDocumentSnapshot>;
  setPageStatus(request: NoteStatusUpdate<NotePageId>): Promise<NotePage>;
  permanentlyDeletePage(request: NotePermanentDeleteRequest<NotePageId>): Promise<NotePermanentDeleteReport>;
}

export interface LiteratureNoteSummary {
  readonly page: NotePage;
  readonly preview: string;
}

export interface NoteIndexDocument {
  readonly pageId: NotePageId;
  readonly revision: number;
  readonly document: NoteDocumentV1;
}

export interface NoteDocumentGateway {
  /** Read-only index projection; at most 20 pages in one consistent snapshot. */
  loadIndexDocuments(pageIds: readonly NotePageId[]): Promise<readonly NoteIndexDocument[]>;
  commitNavigation(request: NoteNavigationCommit): Promise<readonly NoteDocumentSnapshot[]>;
  resolveConflict(request: NoteConflictResolutionRequest): Promise<NoteConflictResolutionReceipt>;
  loadRevision(pageId: NotePageId, revisionId: NoteRevisionId): Promise<NoteDocumentV1>;
  loadDocument(pageId: NotePageId): Promise<NoteDocumentSnapshot>;
  saveDocument(request: NoteDocumentSaveRequest): Promise<NoteDocumentSnapshot>;
  listRevisions(pageId: NotePageId): Promise<readonly NoteRevisionSummary[]>;
  setRevisionPinned(pageId: NotePageId, revisionId: NoteRevisionId, isPinned: boolean): Promise<NoteRevisionSummary>;
  restoreRevision(pageId: NotePageId, revisionId: NoteRevisionId, expectedRevision: number): Promise<NoteDocumentSnapshot>;
}

export interface ReadingNoteGateway {
  listReadingNotes(query?: ReadingNoteListQuery): Promise<readonly ReadingNoteBlock[]>;
  getReadingNote(id: NoteBlockId): Promise<ReadingNoteBlock>;
  createReadingNote(draft: ReadingNoteDraft): Promise<ReadingNoteBlock>;
  updateReadingNote(request: ReadingNoteUpdate): Promise<ReadingNoteBlock>;
  setReadingNoteStatus(request: NoteStatusUpdate<NoteBlockId>): Promise<ReadingNoteBlock>;
  permanentlyDeleteReadingNote(request: NotePermanentDeleteRequest<NoteBlockId>): Promise<NotePermanentDeleteReport>;
}

export interface NoteSourceLabel {
  readonly pageId: NotePageId;
  readonly label: string;
}

export interface NoteLinkGateway {
  /** Display-only paper/manuscript snapshots, at most 500 source pages. */
  listSourceLabels(pageIds: readonly NotePageId[]): Promise<readonly NoteSourceLabel[]>;
  upsertLink(draft: NoteLinkDraft): Promise<NoteLink>;
  removeLink(id: string): Promise<void>;
  listOutgoing(pageId: NotePageId): Promise<readonly NoteLink[]>;
  listBacklinks(targetKind: NoteLink["target"]["kind"], targetId: string): Promise<readonly NoteLink[]>;
}

export interface NoteSearchGateway {
  searchNotes(query: NoteSearchQuery): Promise<NoteSearchPage>;
  rebuildNoteIndex(): Promise<void>;
  cancelNoteIndexRebuild(): Promise<boolean>;
  getNoteIndexState(): Promise<NoteSearchPage["indexState"]>;
}

export interface NotesGateway
  extends NotePageGateway,
    NoteDocumentGateway,
    ReadingNoteGateway,
    NoteLinkGateway,
    NoteSearchGateway,
    NoteAssetGateway,
    NoteTransferGateway,
    NoteTagGateway {
  /** Metadata/search provider bound to this same storage and permission owner.
   * Adapters without the capability must not fall back to full-body probing. */
  readonly pageCatalog?: import("./catalog").NotePageCatalogGateway;
}

export type { NoteLinkDraft, NotePageDraft, ReadingNoteDraft };
