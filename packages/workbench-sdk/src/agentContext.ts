import type {AgentContextSelection} from "@research-assistant/core/agent";

/** Candidate observations remain Core-owned suggestions, not a change to a
 * conversation's explicit resource selection or execution authorization. */
export declare function useAgentContextCandidate(candidate: AgentContextSelection | null, active?: boolean, surface?: "tab" | "floating"): void;
