import type {AgentWorkspaceConfirmation} from "@research-assistant/core/agent";
import type {AgentWorkspaceSuccessorIdentity} from "@research-assistant/data/agent";
import type {WritingSubmissionAdmission} from "./agentWriting.js";

export interface WritingDeliveryToolRequest extends WritingSubmissionAdmission {
  readonly requestId: string;
  readonly binding: AgentWorkspaceConfirmation;
}

export interface WritingDeliveryToolResult {
  readonly request: WritingDeliveryToolRequest;
  readonly complete: boolean;
  readonly message: string;
}

export interface WritingDeliveryToolGateway {
  listen(receive: (request: WritingDeliveryToolRequest) => void): Promise<() => void>;
  report(result: WritingDeliveryToolResult): Promise<void>;
}

export interface WritingSuccessorToolRequest extends AgentWorkspaceSuccessorIdentity {
  readonly requestId: string;
}

export interface WritingSuccessorToolGateway {
  listen(receive: (request: WritingSuccessorToolRequest) => void): Promise<() => void>;
  report(result: {
    request: WritingSuccessorToolRequest;
    confirmation: AgentWorkspaceConfirmation | null;
  }): Promise<void>;
}

/** The original Core handshake retains event validation and report ownership. */
export declare const writingDeliveryToolGateway: WritingDeliveryToolGateway;
export declare const writingSuccessorToolGateway: WritingSuccessorToolGateway;
