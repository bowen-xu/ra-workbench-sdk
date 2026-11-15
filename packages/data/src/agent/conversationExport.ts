import { AgentExportDecodeError, decodeAgentConversationExport, decodeAgentConversationDownload, type AgentConversationExport, type AgentConversationDownload } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentConversationExportGateway {
  snapshot(conversationId: string): Promise<AgentConversationExport>;
  download(conversationId: string): Promise<AgentConversationDownload>;
}
export function createAgentConversationExportGateway(invoke: AgentMetadataInvoke): AgentConversationExportGateway {
  return {
    async download(conversationId) {
      validateIdentity(conversationId);
      const result = decodeAgentConversationDownload(await invoke("agent_download_conversation", { request: { conversationId } }));
      if (result.conversationId !== conversationId.toLowerCase()) throw new AgentExportDecodeError();
      return result;
    },
    async snapshot(conversationId) {
      validateIdentity(conversationId);
      const result = decodeAgentConversationExport(await invoke("agent_export_conversation_snapshot", { request: { conversationId } }));
      if (result.conversation.id !== conversationId.toLowerCase()) throw new AgentExportDecodeError();
      return result;
    },
  };
}
function validateIdentity(conversationId: string): void {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(conversationId)
    || conversationId === "00000000-0000-0000-0000-000000000000") throw new AgentExportDecodeError();
}
