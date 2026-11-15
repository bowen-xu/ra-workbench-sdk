import { AgentWorkspaceDecodeError, decodeAgentWritingFileDeliveryAdmission, decodeAgentWritingFileDeliveryRequest,
  decodeAgentWritingFileDeliveryPage, type AgentWritingFileDeliveryAdmission, type AgentWritingFileDeliveryRequest,
  type AgentWritingFileDeliveryPage } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentWritingFileDeliveryGateway {
  list(request: AgentWritingFileDeliveryRequest): Promise<AgentWritingFileDeliveryPage>;
  acknowledge(request: AgentWritingFileDeliveryAdmission): Promise<void>;
}
/** Native discovery verifies new admission records; historical proposals are not a queue. */
export function createAgentWritingFileDeliveryGateway(invoke: AgentMetadataInvoke): AgentWritingFileDeliveryGateway {
  return {
    async list(input) {
      const request = decodeAgentWritingFileDeliveryRequest(input);
      const page = decodeAgentWritingFileDeliveryPage(await invoke("agent_list_writing_file_deliveries", { request }));
      if (page.manuscriptId !== request.manuscriptId || page.items.length > request.limit
        || (page.nextCursor !== null && page.items.length !== request.limit)
        || page.items.some((item) => item.id <= (request.after ?? 0))) throw new AgentWorkspaceDecodeError();
      return page;
    },
    async acknowledge(input) {
      const request = decodeAgentWritingFileDeliveryAdmission(input);
      if (await invoke("agent_acknowledge_writing_file_delivery", { request }) !== null) throw new AgentWorkspaceDecodeError();
    },
  };
}
