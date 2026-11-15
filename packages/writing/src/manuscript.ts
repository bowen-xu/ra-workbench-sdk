import type { ManuscriptPath } from "./manuscriptPath";
import { parseManuscriptPath } from "./manuscriptPath";

export type ManuscriptStatus = "active" | "archived";
export type ManuscriptFileKind = "tex" | "bib" | "image" | "style" | "other";

export interface Manuscript {
  readonly id: string;
  readonly projectId?: string;
  readonly title: string;
  readonly rootPath: ManuscriptPath;
  readonly status: ManuscriptStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ManuscriptDraft {
  readonly title: string;
  readonly rootPath?: string;
}

export interface ManuscriptFile {
  readonly manuscriptId: string;
  readonly relativePath: ManuscriptPath;
  readonly kind: ManuscriptFileKind;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly modifiedAt: string;
}

export interface ManuscriptFileContent {
  readonly relativePath: ManuscriptPath;
  readonly content: string;
  readonly sha256: string;
}

export interface ManuscriptDirectory {
  readonly relativePath: ManuscriptPath;
}

export interface SaveManuscriptFileRequest {
  readonly manuscriptId: string;
  readonly relativePath: ManuscriptPath;
  readonly content: string;
  readonly expectedSha256?: string;
}

export interface WritingSessionDraft {
  readonly manuscriptId: string;
  readonly openPaths: readonly ManuscriptPath[];
  readonly activePath?: ManuscriptPath;
  readonly cursorState: Readonly<Record<string, unknown>>;
  readonly layoutState: Readonly<Record<string, unknown>>;
}

export interface WritingSession extends WritingSessionDraft {
  readonly updatedAt: string;
}

export interface RecoveryDraftInput {
  readonly manuscriptId: string;
  readonly relativePath: ManuscriptPath;
  readonly baseSha256: string;
  readonly content: string;
}

export interface RecoveryDraft extends RecoveryDraftInput {
  readonly updatedAt: string;
}

export interface UpdateManuscriptRequest {
  readonly manuscriptId: string;
  readonly title?: string;
  readonly rootPath?: ManuscriptPath;
}

export interface ManuscriptTransferResult {
  readonly manuscript: Manuscript;
  readonly fileCount: number;
  readonly rootCandidates: readonly ManuscriptPath[];
}

export interface ManuscriptImportPreview {
  readonly fileCount: number;
  readonly byteSize: number;
  readonly rootCandidates: readonly ManuscriptPath[];
}

export interface ManuscriptExportResult {
  readonly destinationPath: string;
  readonly fileCount: number;
  readonly byteSize: number;
}

export interface ManuscriptResourceImportResult {
  readonly importedPaths: readonly ManuscriptPath[];
  readonly byteSize: number;
}

export interface NormalizedManuscriptDraft {
  readonly title: string;
  readonly rootPath: ManuscriptPath;
}

const MAX_TITLE_LENGTH = 180;

export function normalizeManuscriptDraft(draft: ManuscriptDraft): NormalizedManuscriptDraft {
  const title = draft.title.trim();

  if (title.length === 0) {
    throw new Error("稿件标题不能为空");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`稿件标题不能超过 ${MAX_TITLE_LENGTH} 个字符`);
  }

  return {
    title,
    rootPath: parseManuscriptPath(draft.rootPath ?? "main.tex"),
  };
}

export function classifyManuscriptFile(path: ManuscriptPath): ManuscriptFileKind {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "tex") return "tex";
  if (extension === "bib") return "bib";
  if (["png", "jpg", "jpeg", "pdf", "eps", "svg"].includes(extension ?? "")) return "image";
  if (["sty", "cls", "bst", "bbx", "cbx"].includes(extension ?? "")) return "style";
  return "other";
}
