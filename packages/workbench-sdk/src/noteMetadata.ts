import type {NotePage, ReadingNoteBlock, NoteMetadataAction, NoteMetadataBatchReceipt} from "@research-assistant/core/notes";
import type {NoteDocumentSnapshot, NoteTargetQuery} from "@research-assistant/data/notes";
import type {NoteResourceAccess} from "./noteResources.js";

export type NoteMetadataChanged = Pick<NoteMetadataBatchReceipt, "pages" | "bodyChangedIds"> & {readonly action: NoteMetadataAction};

/** Metadata for opened documents and their ancestors, not a whole-library inventory. */
export interface NoteDocumentMetadataOptions {
  readonly client: NoteResourceAccess;
  readonly version: number;
  readonly active: boolean;
  readonly snapshots: readonly NoteDocumentSnapshot[];
  readonly current: NoteDocumentSnapshot | undefined;
  readonly source: ReadingNoteBlock | undefined;
  readonly observe: (pages: readonly NotePage[]) => void;
  readonly onError: (message: string) => void;
}

export interface NoteDocumentMetadata {
  readonly pages: readonly NotePage[];
  readonly readingNotes: readonly ReadingNoteBlock[];
  readonly rememberReadingNote: (note: ReadingNoteBlock) => void;
}

export type ResearchObjectTargetKind = "paper" | "claim" | "manuscript";

export interface ResearchObjectTarget {
  readonly id: string;
  readonly kind: ResearchObjectTargetKind;
  readonly label: string;
  readonly context?: string;
}

/** Core supplies the real hooks and their existing query/observation lifetime. */
export interface NoteMetadataApi {
  readonly useNoteDocumentMetadata: (options: NoteDocumentMetadataOptions) => NoteDocumentMetadata;
  readonly useNoteCatalogTargets: (version: number) => NoteTargetQuery;
  readonly useResearchObjectTargets: (onError: (reason: unknown) => void, enabled?: boolean) => readonly ResearchObjectTarget[];
}

/** Signature-only exports. Core retains each hook's actual state and queries. */
export declare const useNoteDocumentMetadata: NoteMetadataApi["useNoteDocumentMetadata"];
export declare const useNoteCatalogTargets: NoteMetadataApi["useNoteCatalogTargets"];
export declare const useResearchObjectTargets: NoteMetadataApi["useResearchObjectTargets"];
