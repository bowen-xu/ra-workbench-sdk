import type {NoteDocumentV1} from "@research-assistant/core/notes";
import type {Transaction} from "@tiptap/pm/state";

export interface NoteEditorInstallPort {
  /** Enforce native write admission synchronously, before its acknowledgement. */
  setWriteLocked?(locked: boolean): void;
  readonly isInstalling: boolean;
  read(): NoteDocumentV1;
  /** Preflight a full-page, inline-only replacement. Rechecks the live editor at commit. */
  prepare(baseline: NoteDocumentV1, candidate: NoteDocumentV1): () => undefined;
  prepareStructure(baseline: NoteDocumentV1, candidate: NoteDocumentV1, review?: {
    readonly baseline: NoteDocumentV1; readonly origin: "agent" | "review" | "restore";
    readonly requestId?: string; readonly addToHistory?: boolean;
  }, installation?: { readonly addToHistory?: boolean; readonly onTransaction?: (transaction: Transaction) => void }): () => undefined;
  dispose(): void;
}
