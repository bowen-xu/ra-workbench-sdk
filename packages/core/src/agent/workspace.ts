import { AgentWorkspaceDecodeError, row, id, validPath } from "./workspaceDecoding";
export { AgentWorkspaceDecodeError } from "./workspaceDecoding";
export interface AgentWorkspaceScope {
  readonly conversationId: string;
  readonly requestId: string;
  readonly manuscriptId: string;
  readonly contextSnapshotId: string;
}
export interface AgentWorkspaceBuffer {
  readonly path: string;
  readonly expectedDiskSha256: string;
  readonly sessionId: string;
  readonly revision: string;
  readonly text: string;
}
/** Local durable workspace metadata; never substitutes a new editor session. */
export function decodeAgentWorkspaceBuffer(value: unknown): AgentWorkspaceBuffer {
  const buffer = row(value, ["path", "expectedDiskSha256", "sessionId", "revision", "text"]);
  if (typeof buffer.path !== "string" || !validPath(buffer.path) || typeof buffer.expectedDiskSha256 !== "string" || typeof buffer.text !== "string") throw new AgentWorkspaceDecodeError();
  return {path: buffer.path, expectedDiskSha256: buffer.expectedDiskSha256, sessionId: id(buffer.sessionId), revision: id(buffer.revision), text: buffer.text};
}
/** CAS evidence for a reliable file checkpoint, never an editor receipt. */
export interface AgentWorkspaceCheckpointVersion {
  readonly path: string;
  readonly revision: number;
  readonly stateVersion: number;
}
export interface AgentWorkspacePrepare {
  readonly scope: AgentWorkspaceScope;
  readonly buffers: readonly AgentWorkspaceBuffer[];
}
export interface AgentWorkspaceConfirmation {
  readonly scope: AgentWorkspaceScope;
  readonly turnId: string;
  readonly leaseId: string;
  readonly manifestHash: string;
}
export interface AgentWorkspacePreview extends AgentWorkspaceScope {
  readonly schemaVersion: 1;
  readonly turnId: string;
  readonly leaseId: string;
  readonly manifestHash: string;
  readonly policy: "offline_workspace_v1";
  readonly approved: boolean;
  readonly files: readonly { readonly path: string; readonly byteSize: number; readonly hasEditorBuffer: boolean }[];
}
export function decodeAgentWorkspacePreview(value: unknown): AgentWorkspacePreview {
  const result = row(value, ["schemaVersion", "conversationId", "requestId", "manuscriptId", "contextSnapshotId", "turnId", "leaseId", "manifestHash", "policy", "approved", "files"]);
  if (result.schemaVersion !== 1 || result.policy !== "offline_workspace_v1" || typeof result.approved !== "boolean"
    || typeof result.manifestHash !== "string" || !/^[0-9a-f]{64}$/.test(result.manifestHash)
    || !Array.isArray(result.files) || result.files.length > 10000) throw new AgentWorkspaceDecodeError();
  const paths = new Set<string>();
  let total = 0;
  const files = result.files.map((entry: unknown) => {
    const file = row(entry, ["path", "byteSize", "hasEditorBuffer"]);
    if (typeof file.path !== "string" || !validPath(file.path) || paths.has(file.path)
      || typeof file.byteSize !== "number" || !Number.isSafeInteger(file.byteSize) || file.byteSize < 0 || file.byteSize > 256 * 1024 * 1024
      || typeof file.hasEditorBuffer !== "boolean") throw new AgentWorkspaceDecodeError();
    paths.add(file.path); total += file.byteSize;
    if (total > 512 * 1024 * 1024) throw new AgentWorkspaceDecodeError();
    return { path: file.path, byteSize: file.byteSize, hasEditorBuffer: file.hasEditorBuffer };
  });
  return { schemaVersion: 1, conversationId: id(result.conversationId), requestId: id(result.requestId), manuscriptId: id(result.manuscriptId), contextSnapshotId: id(result.contextSnapshotId),
    turnId: id(result.turnId), leaseId: id(result.leaseId), manifestHash: result.manifestHash, policy: result.policy, approved: result.approved, files };
}
