import type { AgentQueueState } from "@research-assistant/core/agent";
import { AgentInputQueueController, type AgentQueueGateway } from "./inputQueueController";
import { PendingOperationRegistry } from "./pendingOperationRegistry";

/** Scope keys include host kind, resource and conversation. Pending requests
 * never migrate to another host even when it can read the same durable queue. */
export class AgentInputQueueRegistry<S extends { conversationId: string }, Q extends AgentQueueState> {
  private readonly owner = new PendingOperationRegistry<AgentInputQueueController<S, Q>>(controller => {
    const state = controller.getSnapshot();
    return state.editing || state.uncertain || state.pending === true;
  });
  constructor(private readonly gateway: AgentQueueGateway<S, Q>, private readonly key: (scope: S) => string,
    private readonly id: () => string,
    private readonly captureNewIntent?: (scope: S) => ((requestId: string) => Promise<void>) | undefined) {}
  retain(): () => void { return this.owner.retain(); }
  hasPending(): boolean { return this.owner.hasPending(); }
  acquire(scope: S) {
    return this.owner.acquire(this.key(scope), scope.conversationId,
      () => new AgentInputQueueController(this.gateway, scope, this.id, this.captureNewIntent));
  }
  forgetConversation(id: string): void { this.owner.forgetConversation(id); }
  dispose(): void { this.owner.dispose(); }
}
