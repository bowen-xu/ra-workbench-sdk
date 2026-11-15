import { decodeAgentInstructionTrust, instructionTrustId, type AgentInstructionTrust } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";
export function createAgentInstructionTrustGateway(invoke: AgentMetadataInvoke) {
  function scoped(value: unknown, id: string): AgentInstructionTrust {
    const result = decodeAgentInstructionTrust(value);
    if (result.manuscriptId !== id) throw new Error("Instruction trust scope mismatch");
    return result;
  }
  return {
    async read(manuscriptId: string): Promise<AgentInstructionTrust> {
      const id = instructionTrustId(manuscriptId);
      return scoped(await invoke("agent_read_manuscript_instruction_trust", { request: { manuscriptId: id } }), id);
    },
    async update(manuscriptId: string, expectedRevision: number, granted: boolean): Promise<AgentInstructionTrust> {
      const id = instructionTrustId(manuscriptId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || typeof granted !== "boolean") throw new Error("Invalid instruction trust update");
      const result = scoped(await invoke("agent_update_manuscript_instruction_trust", { request: { manuscriptId: id, expectedRevision, granted } }), id);
      if (result.revision !== expectedRevision + 1 || result.granted !== granted || result.rootMatches !== granted) throw new Error("Instruction trust update mismatch");
      return result;
    },
  };
}
