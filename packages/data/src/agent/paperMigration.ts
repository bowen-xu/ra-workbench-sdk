import {
  decodeAgentPaperReadingHistoryMigrationRequest,
  decodeAgentPaperReadingHistoryMigrationResult,
  type AgentPaperReadingHistoryMigrationRequest,
  type AgentPaperReadingHistoryMigrationResult,
} from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

export interface AgentPaperReadingHistoryMigrationGateway {
  migrate(request: AgentPaperReadingHistoryMigrationRequest): Promise<AgentPaperReadingHistoryMigrationResult>;
}
export function createAgentPaperReadingHistoryMigrationGateway(invoke: AgentMetadataInvoke): AgentPaperReadingHistoryMigrationGateway {
  return { async migrate(request) {
    const frozen = decodeAgentPaperReadingHistoryMigrationRequest(request);
    return decodeAgentPaperReadingHistoryMigrationResult(await invoke("agent_migrate_paper_reading_history", { request: frozen }));
  }};
}
