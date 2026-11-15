import { AgentSubmissionDecodeError } from "./submission";

export interface AgentCompileResultIdentity {
  readonly conversationId: string;
  readonly requestId: string;
  readonly turnId: string;
  readonly contextSnapshotId: string;
  readonly manuscriptId: string;
  readonly leaseId: string;
  readonly manifestHash: string;
}

export interface AgentCompileResult {
  readonly status: "succeeded" | "failed" | "cancelled" | "timed_out" | "io_failure";
  readonly resultId: string;
  readonly compileVersion: string;
  readonly identity: AgentCompileResultIdentity;
  readonly rootPath: string;
  readonly exitCode: number | null;
  readonly diagnostics: readonly unknown[];
  readonly artifacts: { readonly pdf: boolean; readonly synctex: boolean };
  readonly retained: boolean;
  readonly createdAtUnixSeconds: number;
  readonly expiresAfterSeconds: number;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") throw new AgentSubmissionDecodeError();
  return value;
}
function uuid(value: unknown): string {
  const result = text(value).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result)) throw new AgentSubmissionDecodeError();
  return result;
}
function hash(value: unknown): string {
  const result = text(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(result)) throw new AgentSubmissionDecodeError();
  return result;
}
function artifactAvailable(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.byteSize === "number" && Number.isSafeInteger(row.byteSize) && row.byteSize > 0;
}

export function decodeAgentCompileResult(value: unknown): AgentCompileResult {
  const row = object(value);
  const identity = object(row.identity);
  const status = text(row.status);
  if (!["succeeded", "failed", "cancelled", "timed_out", "io_failure"].includes(status)) throw new AgentSubmissionDecodeError();
  const artifacts = object(row.artifacts);
  const diagnostics = row.diagnostics;
  if (!Array.isArray(diagnostics) || typeof row.retained !== "boolean" || typeof row.createdAtUnixSeconds !== "number" || !Number.isSafeInteger(row.createdAtUnixSeconds) || row.createdAtUnixSeconds <= 0 || typeof row.expiresAfterSeconds !== "number" || !Number.isInteger(row.expiresAfterSeconds) || row.expiresAfterSeconds <= 0) throw new AgentSubmissionDecodeError();
  return {
    status: status as AgentCompileResult["status"],
    resultId: uuid(row.resultId), compileVersion: uuid(row.compileVersion),
    identity: { conversationId: uuid(identity.conversationId), requestId: uuid(identity.requestId), turnId: uuid(identity.turnId), contextSnapshotId: uuid(identity.contextSnapshotId), manuscriptId: uuid(identity.manuscriptId), leaseId: uuid(identity.leaseId), manifestHash: hash(identity.manifestHash) },
    rootPath: text(row.rootPath), exitCode: row.exitCode === null ? null : typeof row.exitCode === "number" && Number.isInteger(row.exitCode) ? row.exitCode : (() => { throw new AgentSubmissionDecodeError(); })(),
    diagnostics, artifacts: { pdf: artifactAvailable(artifacts.pdf), synctex: artifactAvailable(artifacts.synctex) }, retained: row.retained, createdAtUnixSeconds: row.createdAtUnixSeconds, expiresAfterSeconds: row.expiresAfterSeconds,
  };
}
