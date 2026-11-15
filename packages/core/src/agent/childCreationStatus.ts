import { AgentCatalogDecodeError } from "./catalog";
import { catalogObject } from "./catalog-decoding";
import { catalogOperationId } from "./catalogOperationDecoding";
import { decodeAgentCreateBoundStatus, type AgentCreateBoundStatusResponse } from "./createBound";
import { decodeAgentArchiveStatus, type AgentArchiveStatusResponse } from "./catalogArchive";

/** Identifies a saved parent call; never supplies a reconstructed child identity. */
export interface AgentChildCreationStatusRequest {
  readonly schemaVersion: 1;
  readonly conversationId: string;
  readonly turnId: string;
  readonly callId: string;
}
/** A read-only creation-phase snapshot, not permission to retry or resume. */
export interface AgentChildCreationStatusResponse extends AgentChildCreationStatusRequest {
  readonly watermark: number;
  readonly creation: AgentCreateBoundStatusResponse;
  /** A current retained row, not proof of child execution or authorization to resume. */
  readonly submission?: { readonly requestId: string; readonly epoch: string; readonly record: null | { readonly turnId: string; readonly contextSnapshotId: string } };
  readonly cleanup?: AgentArchiveStatusResponse;
}

export function decodeAgentChildCreationStatusRequest(value: unknown): AgentChildCreationStatusRequest {
  const row = catalogObject(value, ["schemaVersion", "conversationId", "turnId", "callId"]);
  if (row.schemaVersion !== 1) throw new AgentCatalogDecodeError();
  return { schemaVersion: 1, conversationId: catalogOperationId(row.conversationId),
    turnId: catalogOperationId(row.turnId), callId: catalogOperationId(row.callId) };
}

export function decodeAgentChildCreationStatusResponse(value: unknown): AgentChildCreationStatusResponse {
  const row = catalogObject(value, ["schemaVersion", "conversationId", "turnId", "callId", "watermark", "creation", "cleanup", "submission"]);
  const request = decodeAgentChildCreationStatusRequest({ schemaVersion: row.schemaVersion,
    conversationId: row.conversationId, turnId: row.turnId, callId: row.callId });
  if (typeof row.watermark !== "number" || !Number.isSafeInteger(row.watermark) || row.watermark < 0) throw new AgentCatalogDecodeError();
  const creation = decodeAgentCreateBoundStatus(row.creation);
  const cleanup = row.cleanup === undefined ? undefined : decodeAgentArchiveStatus(row.cleanup);
  let submission: AgentChildCreationStatusResponse["submission"];
  if (row.submission !== undefined) {
    const snapshot = catalogObject(row.submission, ["requestId", "epoch", "record"]);
    const requestId = catalogOperationId(snapshot.requestId), epoch = catalogOperationId(snapshot.epoch);
    if (creation.status.type !== "committed" || creation.status.proof.epoch !== epoch) throw new AgentCatalogDecodeError();
    const entry = snapshot.record === null ? null : catalogObject(snapshot.record, ["turnId", "contextSnapshotId"]);
    submission = {requestId, epoch, record: entry === null ? null : {turnId: catalogOperationId(entry.turnId), contextSnapshotId: catalogOperationId(entry.contextSnapshotId)}};
  }
  if (cleanup && cleanup.conversationId !== creation.conversationId) throw new AgentCatalogDecodeError();
  return { ...request, watermark: row.watermark, creation, ...(cleanup ? {cleanup} : {}), ...(submission ? {submission} : {}) };
}
