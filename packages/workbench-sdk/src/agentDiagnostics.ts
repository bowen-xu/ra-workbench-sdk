import type {AgentTurnProjection} from "@research-assistant/core/agent";

/** Original allowlisted diagnostics retain their safe causes and operation identities. */
export declare function diagnosticError(reason: unknown): Record<string, unknown>;
export declare function agentFailureDiagnostics(
  conversationId: string,
  turnId: string,
  turn: AgentTurnProjection,
): string;
export declare function agentHistoryErrorMessage(error: unknown, conversationId: string): string;

/** Display-only finite source diagnostics. Never proof of commit or rejection. */
export declare function writingPreparationSourceMessage(reason: unknown): string | undefined;
