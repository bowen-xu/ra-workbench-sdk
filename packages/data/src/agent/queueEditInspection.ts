import { agentQueueEditIntentFromRequest, decodeAgentQueueEditStatusResponse,
  type AgentQueueCommand, type AgentQueueEditStatusResponse } from "@research-assistant/core/agent";
import type { AgentMetadataInvoke } from "./index";

/** Optional capability: old fake queue gateways need not claim status support. */
export interface AgentQueueEditInspection<Request> {
  inspectEdit(request: Request): Promise<AgentQueueEditStatusResponse>;
}

/** Own the native-equivalent request while preserving omitted wire defaults. */
export function freezeQueueEditRequest<Request extends AgentQueueCommand & {readonly conversationId: string}>(
  input: Request, decode: (value: unknown) => Request,
): Request {
  const intent = agentQueueEditIntentFromRequest(input);
  let edit = intent.edit;
  if ("userInput" in edit && !Object.hasOwn(input.edit, "userInput")) {
    const {userInput: _default, ...original} = edit;
    edit = original;
  }
  const request = decode({...input, edit});
  return {...request, edit: structuredClone(edit)};
}

/** Only the original command status RPC is issued; current Q cannot prove its ACK. */
export async function inspectQueueEdit<Request extends AgentQueueCommand & {readonly conversationId: string}>(
  invoke: AgentMetadataInvoke, command: string, input: Request, decode: (value: unknown) => Request,
): Promise<AgentQueueEditStatusResponse> {
  const request = freezeQueueEditRequest(input, decode);
  return decodeAgentQueueEditStatusResponse(await invoke(command, {request: structuredClone(request)}), request);
}
