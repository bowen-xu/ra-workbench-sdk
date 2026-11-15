import type {NoteDocumentV1, NotePageId} from "@research-assistant/core/notes";

export interface NoteMarkdownImportPreview {
  readonly document: NoteDocumentV1;
  readonly blockCount: number;
  readonly warnings: readonly string[];
}
export interface NoteTransferAsset {
  readonly id: string;
  readonly displayName: string;
  readonly mimeType: string;
}

/** Core conversion/asset mechanics; library traversal remains plugin-owned. */
export declare const MAX_MARKDOWN_IMPORT_BYTES: number;
export declare function chooseNoteExportDirectory(): Promise<string | undefined>;
export declare function previewMarkdownImport(pageId: NotePageId, markdown: string): NoteMarkdownImportPreview;
export declare function safeExportName(value: string): string;
export declare function noteAssetExportPaths(assets: Iterable<NoteTransferAsset>): ReadonlyMap<string, string>;
export declare function collectNoteAssets(document: NoteDocumentV1): readonly NoteTransferAsset[];
export declare function noteDocumentToMarkdown(document: NoteDocumentV1, assetPaths?: ReadonlyMap<string, string>): string;
