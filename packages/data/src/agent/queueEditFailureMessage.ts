import type { AgentQueueStorageFailure } from "@research-assistant/core/agent";

/** The latest matched storage evidence is diagnostic, never a commit receipt.
 * Paper/note resource IDs can carry legacy user text and are not rendered. */
export function queueEditFailureMessage(failure: AgentQueueStorageFailure): string {
  const detail = failure.reason.diagnostic;
  const parts = [`${failure.code}/${failure.reason.code}`, `C=${failure.conversationId}`, `R=${failure.requestId}`,
    `op=${failure.operationId}`, `scope=${failure.scope.kind}`];
  if (failure.scope.kind === "manuscript") parts.push(`M=${failure.scope.manuscriptId}`);
  if (detail?.phase) parts.push(`phase=${detail.phase}`);
  if (detail?.safeCause) parts.push(`cause=${detail.safeCause}`);
  if (detail?.epoch) parts.push(`epoch=${detail.epoch}`);
  if (detail?.sqlFence) parts.push(`sqlFence=${detail.sqlFence}`);
  if (detail?.sqliteCode) parts.push(`sqliteCode=${detail.sqliteCode}`);
  if (detail?.sqliteExtendedCode != null) parts.push(`sqliteExtendedCode=${detail.sqliteExtendedCode}`);
  return `最近存储诊断（当前结果仍未确认）：${parts.join("；")}。`;
}
