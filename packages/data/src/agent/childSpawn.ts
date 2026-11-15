import type { AgentMetadataInvoke } from "./index";

export interface AgentChildSpawnResponse {
  schemaVersion: number;
  childConversationId: string;
  requestId: string;
  turnId: string;
  contextSnapshotId: string;
}

export interface AgentChildSpawnGateway {
  spawnPaper(request: {
    parentConversationId: string;
    parentTurnId: string;
    paperId: string;
    paperContextSnapshotId: string;
    expectedContextHash: string;
    prompt: string;
  }): Promise<AgentChildSpawnResponse>;
  spawnNote(request: {
    parentConversationId: string;
    parentTurnId: string;
    pageId: string;
    prompt: string;
  }): Promise<AgentChildSpawnResponse>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decode(value: unknown): AgentChildSpawnResponse {
  if (!value || typeof value !== "object") throw new Error("Invalid child spawn response");
  const result = value as Record<string, unknown>;
  const fields = ["childConversationId", "requestId", "turnId", "contextSnapshotId"];
  if (result.schemaVersion !== 1 || fields.some((field) => typeof result[field] !== "string" || !uuid.test(result[field] as string))) {
    throw new Error("Invalid child spawn response");
  }
  return result as unknown as AgentChildSpawnResponse;
}

function requirePrompt(prompt: string): void {
  if (prompt.trim().length === 0 || prompt.length > 16_384) throw new Error("Invalid child prompt");
}

export function createAgentChildSpawnGateway(invoke: AgentMetadataInvoke): AgentChildSpawnGateway {
  return {
    async spawnPaper(request) {
      if (![request.parentConversationId, request.parentTurnId].every((value) => uuid.test(value))) throw new Error("Invalid parent identity");
      if (request.paperId.trim() === "" || request.paperContextSnapshotId.trim() === "" || request.expectedContextHash.trim() === "") throw new Error("Invalid paper scope");
      requirePrompt(request.prompt);
      return decode(await invoke("agent_spawn_paper_child", { request }));
    },
    async spawnNote(request) {
      if (![request.parentConversationId, request.parentTurnId, request.pageId].every((value) => uuid.test(value))) throw new Error("Invalid note scope");
      requirePrompt(request.prompt);
      return decode(await invoke("agent_spawn_note_child", { request }));
    },
  };
}
