import { decodeAgentPaperContextPrepareRequest, decodeAgentPaperContextPreparation,
  decodeAgentPaperContextRequest, decodeAgentPaperContextPreview,
  type AgentPaperContextPrepareRequest, type AgentPaperContextPreparation,
  type AgentPaperContextRequest, type AgentPaperContextPreview } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentPaperContextGateway {
  /** Freeze the current parsed paper inputs into a versioned snapshot without starting inference. */
  prepare(request: AgentPaperContextPrepareRequest): Promise<AgentPaperContextPreparation>;
  /** Local frozen manifest only; does not authorize disclosure, read image files or run a model. */
  preview(request: AgentPaperContextRequest): Promise<AgentPaperContextPreview>;
}
export function createAgentPaperContextGateway(invoke: AgentMetadataInvoke): AgentPaperContextGateway {
  return {
    async prepare(request) {
      const frozen = decodeAgentPaperContextPrepareRequest(request);
      return decodeAgentPaperContextPreparation(
        await invoke("agent_prepare_paper_context", { request: { paperId: frozen.paperId, attachmentIds: [...frozen.attachmentIds], ...(frozen.imageAssets === undefined ? {} : { imageAssets: frozen.imageAssets.map((asset) => ({ ...asset })) }) } }),
        frozen,
      );
    },
    async preview(request) {
      const frozen = decodeAgentPaperContextRequest(request);
      const result = await invoke("agent_preview_paper_context", { request: { ...frozen } });
      return decodeAgentPaperContextPreview(result, frozen);
    },
  };
}
