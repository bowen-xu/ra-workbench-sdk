import { decodeAgentChildTaskSummaries, decodeAgentChildTaskSummary, type AgentChildTaskSummary } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSubtaskGateway {
  list(parentConversationId: string, limit?: number): Promise<readonly AgentChildTaskSummary[]>;
  /** Parent-scoped durable child state invalidation, without response content. */
  subscribe?(parentConversationId: string, changed: () => void): Promise<() => void>;
  reconcile(parentConversationId: string, childConversationId: string): Promise<AgentChildTaskSummary>;
  resumeWriting(parentConversationId: string, childConversationId: string, manuscriptId: string): Promise<void>;
  resumePaper(parentConversationId: string, childConversationId: string, paperId: string): Promise<void>;
  resumeNote(parentConversationId: string, childConversationId: string, pageId: string): Promise<void>;
  resumeReadingNote(parentConversationId: string, childConversationId: string, readingNoteId: string): Promise<void>;
}

export function createAgentSubtaskGateway(invoke: AgentMetadataInvoke): AgentSubtaskGateway {
  return {
    async list(parentConversationId, limit = 64) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parentConversationId) || !Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error("invalid child task request");
      return decodeAgentChildTaskSummaries(await invoke("agent_list_child_tasks", { parentConversationId, limit }));
    },
    async reconcile(parentConversationId, childConversationId) {
      if (![parentConversationId, childConversationId].every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) throw new Error("invalid child task request");
      return decodeAgentChildTaskSummary(await invoke("agent_reconcile_child_task", { parentConversationId, childConversationId }));
    },
    async resumeWriting(parentConversationId, childConversationId, manuscriptId) {
      if (![parentConversationId, childConversationId, manuscriptId].every((id) => uuid.test(id))) throw new Error("invalid child task request");
      await invoke("agent_resume_writing_child", { parentConversationId, childConversationId, manuscriptId });
    },
    async resumePaper(parentConversationId, childConversationId, paperId) {
      if (![parentConversationId, childConversationId].every((id) => uuid.test(id)) || paperId.trim() === "") throw new Error("invalid child task request");
      await invoke("agent_resume_paper_child", { parentConversationId, childConversationId, paperId });
    },
    async resumeNote(parentConversationId, childConversationId, pageId) {
      if (![parentConversationId, childConversationId, pageId].every((id) => uuid.test(id))) throw new Error("invalid child task request");
      await invoke("agent_resume_note_child", { parentConversationId, childConversationId, pageId });
    },
    async resumeReadingNote(parentConversationId, childConversationId, readingNoteId) {
      if (![parentConversationId, childConversationId, readingNoteId].every((id) => uuid.test(id))) throw new Error("invalid child task request");
      await invoke("agent_resume_reading_note_child", { parentConversationId, childConversationId, readingNoteId });
    },
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
