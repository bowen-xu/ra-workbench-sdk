import { AgentSubmissionDecodeError } from "./submission";

export type AgentChildTaskStatus = "running" | "completed" | "canceled" | "failed" | "recovery_required";
export interface AgentChildTaskSummary {
  readonly schemaVersion: 1;
  readonly childConversationId: string;
  readonly parentConversationId: string;
  readonly parentContextSnapshotId: string;
  readonly childContextSnapshotId: string;
  readonly depth: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly status: AgentChildTaskStatus;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

const uuid = (value: unknown): string => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AgentSubmissionDecodeError();
  return value.toLowerCase();
};
const text = (value: unknown): string => { if (typeof value !== "string" || value.trim() === "") throw new AgentSubmissionDecodeError(); return value; };
const integer = (value: unknown, max: number): number => { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) throw new AgentSubmissionDecodeError(); return value; };

export function decodeAgentChildTaskSummary(value: unknown): AgentChildTaskSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AgentSubmissionDecodeError();
  const row = value as Record<string, unknown>;
  const status = text(row.status);
  if (!(["running", "completed", "canceled", "failed", "recovery_required"] as const).includes(status as AgentChildTaskStatus) || row.schemaVersion !== 1) throw new AgentSubmissionDecodeError();
  return { schemaVersion: 1, childConversationId: uuid(row.childConversationId), parentConversationId: uuid(row.parentConversationId), parentContextSnapshotId: uuid(row.parentContextSnapshotId), childContextSnapshotId: uuid(row.childContextSnapshotId), depth: integer(row.depth, 2), modelCalls: integer(row.modelCalls, 2 ** 32 - 1), toolCalls: integer(row.toolCalls, 2 ** 32 - 1), status: status as AgentChildTaskStatus, createdAt: text(row.createdAt), finishedAt: row.finishedAt === null ? null : text(row.finishedAt) };
}

export function decodeAgentChildTaskSummaries(value: unknown): readonly AgentChildTaskSummary[] {
  if (!Array.isArray(value) || value.length > 128) throw new AgentSubmissionDecodeError();
  return value.map(decodeAgentChildTaskSummary);
}
