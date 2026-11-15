import type {WritingNoteCatalogGateway} from "@research-assistant/data/notes";
import type {Manuscript, ManuscriptFile, ManuscriptFileContent, RecoveryDraft, WritingSession} from "@research-assistant/writing";

type WritingRecordStore = "writingProjects" | "writingFiles" | "writingBodies" | "writingSessions" | "writingDrafts" | "writingCheckpoints";
export interface WritingRecordSelection {
  readonly store: WritingRecordStore;
  readonly keys?: readonly string[];
  readonly manuscriptId?: string;
}
export interface WritingRecordChange {
  readonly store: WritingRecordStore;
  readonly key: string;
  readonly value?: unknown;
}
export interface WritingRecordSnapshot {
  readonly revision: number;
  readonly rows: Partial<Record<WritingRecordStore, readonly unknown[]>>;
}
export interface WritingRecordAccess {
  readonly noteCatalog?: WritingNoteCatalogGateway | undefined;
  read(selections: readonly WritingRecordSelection[]): Promise<WritingRecordSnapshot>;
  commit(expectedRevision: number, changes: readonly WritingRecordChange[]): Promise<void>;
}
export interface StoredWritingProject {
  readonly manuscript: Manuscript;
  readonly directories: readonly string[];
}

/** The original Core record owner retains registration, CAS and shutdown. */
export declare function writingRecords(storage: Storage): WritingRecordAccess | undefined;
export declare function writingFileKey(manuscriptId: string, path: string): string;
export declare function decodeWritingProject(value: unknown): StoredWritingProject;
export declare function decodeWritingFile(value: unknown): ManuscriptFile;
export declare function decodeWritingBody(value: unknown): ManuscriptFileContent;
export declare function decodeWritingSession(value: unknown): WritingSession;
export declare function decodeWritingDraft(value: unknown): RecoveryDraft;
