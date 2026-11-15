import type {DocumentCommit, DocumentSnapshot} from "@research-assistant/core/hbs";
import type {NoteDocumentV1} from "@research-assistant/core/notes";
import type {NoteDocumentSaveRequest, NoteDocumentSnapshot} from "./contracts";

/** Initial canonical page creation (including empty pages), HBS baseline and
 * optional source entry commit atomically. The historical wire name is kept
 * so earlier recovery records and exact retry receipts remain readable. */
export interface NoteDraftCommit {
  readonly commit: DocumentCommit<NoteDocumentV1>;
  readonly favorite: boolean;
  readonly source?: NoteDocumentSaveRequest;
}
export interface NoteDraftReceipt {
  readonly type: "receipt";
  readonly requestId: string;
  readonly snapshot: DocumentSnapshot<NoteDocumentV1>;
  readonly page: NoteDocumentSnapshot;
  readonly source?: NoteDocumentSnapshot;
}
