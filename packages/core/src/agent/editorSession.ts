/** Live editor boundary. The native coordinator owns approval and durable recovery. */
export interface AgentEditorSnapshot {
  readonly documentKey: string;
  readonly sessionId: string;
  readonly revision: string;
  readonly text: string;
  /** UTF-16 offsets in the live editor document; omitted when there is no selection. */
  readonly selection?: { readonly startUtf16: number; readonly endUtf16: number };
}
export interface AgentEditorEdit {
  readonly operationId: string;
  readonly expected: AgentEditorSnapshot;
  readonly text: string;
}
export type AgentEditorEditResult =
  | { readonly status: "applied"; readonly operationId: string; readonly snapshot: AgentEditorSnapshot }
  | { readonly status: "conflict" | "unavailable" | "unconfirmed" };
export interface AgentEditorSessionPort {
  read(): AgentEditorSnapshot | null;
  /** Read the last observed operation receipt without dispatching. File owners
   * may restore a reliably checkpointed observation with its original identity;
   * it does not grant a new live session permission to dispatch again. Null means
   * no evidence, never proof that an operation had no effect. A receipt remains
   * historical after subsequent typing or undo.
   */
  readReceipt(operationId: string): Extract<AgentEditorEditResult, {status: "applied"}> | null;
  /** Only for native-validated edits. Never a model tool or a persistence command.
   * An applied receipt describes that operation, not the latest editor state.
   * Unconfirmed requires reconciliation; never fall back to writing disk.
   */
  apply(edit: AgentEditorEdit): AgentEditorEditResult;
}
