import {decodeAgentNoteReviewScope,decodeAgentNoteRewriteReview,type AgentNoteReviewScope,type AgentNoteRewriteReview} from "@research-assistant/core/agent";
import type {AgentMetadataInvoke} from "./index";

export interface AgentNoteReviewGateway {
  review(scope:AgentNoteReviewScope):Promise<AgentNoteRewriteReview>;
}
export function createAgentNoteReviewGateway(invoke:AgentMetadataInvoke):AgentNoteReviewGateway {
  return {async review(scope) {
    const expected=decodeAgentNoteReviewScope(scope);
    return decodeAgentNoteRewriteReview(await invoke("agent_review_note_rewrite",{request:{...expected}}),expected);
  }};
}
