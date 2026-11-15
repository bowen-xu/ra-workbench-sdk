import { decodeAgentSkillCatalog, type AgentSkillCatalog } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentSkillCatalogGateway {
  list(): Promise<AgentSkillCatalog>;
  setEnabled(sourceId: string, revision: string, enabled: boolean): Promise<AgentSkillCatalog>;
}

export function createAgentSkillCatalogGateway(invoke: AgentMetadataInvoke): AgentSkillCatalogGateway {
  return {
    async list() { return decodeAgentSkillCatalog(await invoke("agent_list_application_skills", {})); },
    async setEnabled(sourceId, revision, enabled) {
      if (!sourceId.startsWith(".agents/skills/") || !sourceId.endsWith("/SKILL.md") || !revision.trim()) throw new Error("invalid application skill identity");
      return decodeAgentSkillCatalog(await invoke("agent_set_application_skill_enabled", { request: { sourceId, revision, enabled } }));
    },
  };
}
