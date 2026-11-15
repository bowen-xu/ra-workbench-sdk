export type NotesErrorCode =
  | "operation_unknown"
  | "storage_error"
  | "invalid_input"
  | "not_found"
  | "revision_conflict"
  | "database_busy"
  | "db_query_worker_failed"
  | "source_unavailable"
  | "index_failed"
  | "index_busy"
  | "catalog_preparing"
  | "operation_cancelled"
  | "transfer_failed";

export class NotesGatewayError extends Error {
  readonly code: NotesErrorCode;
  readonly currentRevision: number | undefined;

  constructor(code: NotesErrorCode, message: string, currentRevision?: number) {
    super(message);
    this.name = "NotesGatewayError";
    this.code = code;
    this.currentRevision = currentRevision;
  }
}
