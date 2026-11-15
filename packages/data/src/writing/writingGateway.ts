/** Public domain contract. No platform adapter or UI implementation imports. */
import type { Manuscript, ManuscriptDraft, ManuscriptFile, ManuscriptFileContent, ManuscriptDirectory, SaveManuscriptFileRequest, WritingSessionDraft, CompileRun, CompileOptions, LatexEngine, LatexToolchainInfo, BibliographyEntryInput, BibliographyStatus, CitationBinding, CitationCandidate, CitationScope, RecoveryDraft, RecoveryDraftInput, UpdateManuscriptRequest, WritingSession, ManuscriptImportPreview, ManuscriptTransferResult, ManuscriptExportResult, SynctexPdfLocation, SynctexSourceLocation, ManuscriptResourceImportResult } from "@research-assistant/writing";

export interface WritingGateway {
  /** Read-only source of the unified note catalog; absent capabilities fail explicitly. */
  readonly noteCatalog?: import("@research-assistant/data/notes").WritingNoteCatalogGateway;
  rekeyCitations(manuscriptId: string, assignments: readonly import("@research-assistant/writing").CitationKeyAssignment[]): Promise<import("./citationKeyMigration").CitationKeyMigration>;
  listBibliographyEntries(manuscriptId: string, includeUnusedAutomatic?: boolean): Promise<readonly import("@research-assistant/writing").ProjectBibliographyEntry[]>;
  removeUnusedImportedBibliographyEntries(manuscriptId: string): Promise<number>;
  linkBibliographyEntry(manuscriptId: string, entryId: string, literatureItemId: string): Promise<void>;
  updateBibliographyEntry(manuscriptId: string, entryId: string, expectedBibtex: string, draft: import("@research-assistant/core/literature").LiteratureDraft): Promise<void>;
  listManuscripts(): Promise<readonly Manuscript[]>;
  createManuscript(draft: ManuscriptDraft): Promise<Manuscript>;
  duplicateManuscript?(manuscriptId: string): Promise<Manuscript>;
  archiveManuscript(manuscriptId: string): Promise<Manuscript>;
  deleteManuscript(manuscriptId: string): Promise<void>;
  restoreManuscript(manuscriptId: string): Promise<Manuscript>;
  updateManuscript(request: UpdateManuscriptRequest): Promise<Manuscript>;
  listFiles(manuscriptId: string): Promise<readonly ManuscriptFile[]>;
  readFile(manuscriptId: string, relativePath: string): Promise<ManuscriptFileContent>;
  saveFile(request: SaveManuscriptFileRequest): Promise<ManuscriptFileContent>;
  createFile(manuscriptId: string, relativePath: string, content?: string): Promise<ManuscriptFileContent>;
  renameFile(manuscriptId: string, fromPath: string, toPath: string): Promise<Manuscript>;
  deleteFile(manuscriptId: string, relativePath: string): Promise<void>;
  listDirectories(manuscriptId: string): Promise<readonly ManuscriptDirectory[]>;
  createDirectory(manuscriptId: string, relativePath: string): Promise<ManuscriptDirectory>;
  renameDirectory(manuscriptId: string, fromPath: string, toPath: string): Promise<Manuscript>;
  deleteDirectory(manuscriptId: string, relativePath: string): Promise<void>;
  importResources(manuscriptId: string, destinationDirectory: string, sourcePaths: readonly string[]): Promise<ManuscriptResourceImportResult>;
  saveSession(draft: WritingSessionDraft): Promise<void>;
  getSession(manuscriptId: string): Promise<WritingSession | undefined>;
  saveRecoveryDraft(draft: RecoveryDraftInput): Promise<RecoveryDraft>;
  listRecoveryDrafts(manuscriptId: string): Promise<readonly RecoveryDraft[]>;
  clearRecoveryDraft(manuscriptId: string, relativePath: string): Promise<void>;
  previewImport(sourcePath: string): Promise<ManuscriptImportPreview>;
  importProject(title: string, sourcePath: string, rootPath: string): Promise<ManuscriptTransferResult>;
  exportSource(manuscriptId: string, destinationPath: string): Promise<ManuscriptExportResult>;
  exportPdf(manuscriptId: string, destinationPath: string): Promise<ManuscriptExportResult>;
  forwardSynctex(runId: string, relativePath: string, line: number, column: number): Promise<readonly SynctexPdfLocation[]>;
  inverseSynctex(runId: string, page: number, x: number, y: number): Promise<readonly SynctexSourceLocation[]>;
  detectToolchain(): Promise<LatexToolchainInfo>;
  startCompile(manuscriptId: string, engine: LatexEngine, options?: CompileOptions): Promise<CompileRun>;
  getCompileRun(runId: string): Promise<CompileRun>;
  getLatestCompileRun(manuscriptId: string): Promise<CompileRun | undefined>;
  getLatestPdfCompileRun(manuscriptId: string): Promise<CompileRun | undefined>;
  isCompileCurrent(runId: string): Promise<boolean>;
  cancelCompile(runId: string): Promise<void>;
  readCompilePdf(runId: string): Promise<Uint8Array>;
  searchCitations(manuscriptId: string, query: string, scope: CitationScope): Promise<readonly CitationCandidate[]>;
  listCitationBindings(manuscriptId: string): Promise<readonly CitationBinding[]>;
  bindCitation(manuscriptId: string, entry: BibliographyEntryInput): Promise<CitationBinding>;
  syncBibliography(manuscriptId: string, entries: readonly BibliographyEntryInput[]): Promise<BibliographyStatus>;
  getBibliographyStatus(manuscriptId: string): Promise<BibliographyStatus>;
  regenerateBibliography(manuscriptId: string): Promise<BibliographyStatus>;
  preserveBibliographyEdits(manuscriptId: string): Promise<BibliographyStatus>;
  readonly supportsCompilation: boolean;
}
