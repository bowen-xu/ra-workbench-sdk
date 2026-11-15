import type { AgentEventPayload } from "./events";
import { AgentProjectionError, agentConversationRequiresToolRecovery, type AgentConversationProjection } from "./projectionState";

/** Mirrors Rust projection_rollback.rs: count user-containing turns, including
 * steers within one turn once, and hide their suffix without changing facts. */
export function rollbackAgentConversation(
  state: AgentConversationProjection,
  payload: Extract<AgentEventPayload, { type: "conversationRolledBack" }>,
): AgentConversationProjection {
  if (state.activeTurn !== null || agentConversationRequiresToolRecovery(state)
    || state.turnOrder.at(-1) !== payload.turnId || !Number.isInteger(payload.userTurns)
    || payload.userTurns <= 0 || payload.userTurns > 0xffff_ffff) {
    throw new AgentProjectionError("invalidTransition");
  }
  let remaining = payload.userTurns;
  let cut = -1;
  for (let index = state.turnOrder.length - 1; index >= 0; index -= 1) {
    const id = state.turnOrder[index];
    const turn = id === undefined ? undefined : state.turns.get(id);
    if (turn && [...turn.items.values()].some(item => item.kind.type === "userMessage")) {
      remaining -= 1;
      if (remaining === 0) { cut = index; break; }
    }
  }
  if (cut < 0) throw new AgentProjectionError("invalidTransition");

  const turns = new Map(state.turns);
  const rolledBackTurnIds = new Set(state.rolledBackTurnIds);
  const rolledBackItemIds = new Set(state.rolledBackItemIds);
  for (const id of state.turnOrder.slice(cut)) {
    rolledBackTurnIds.add(id);
    for (const itemId of turns.get(id)?.items.keys() ?? []) rolledBackItemIds.add(itemId);
    turns.delete(id);
  }
  return { ...state, turnOrder: state.turnOrder.slice(0, cut), turns, rolledBackTurnIds, rolledBackItemIds };
}
