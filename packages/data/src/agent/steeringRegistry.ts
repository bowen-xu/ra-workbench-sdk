import { AgentSteeringController } from "./steeringController";
import { PendingOperationRegistry } from "./pendingOperationRegistry";

/** Typed same-turn protocol; lifecycle is shared with queued edits. */
export class AgentSteeringRegistry<S extends { conversationId: string; turnId: string }> {
  private readonly owner = new PendingOperationRegistry<AgentSteeringController<S>>(controller => {
    const phase = controller.getSnapshot().phase;
    return phase === "sending" || phase === "uncertain" || !!controller.getSnapshot().awaitingHistory?.length;
  });
  constructor(private readonly send: (request: S & { inputId: string; text: string }) => Promise<unknown>, private readonly id: () => string,
    private readonly captureNewIntent?: (scope:S)=>((inputId:string)=>Promise<void>)|undefined) {}
  retain(): () => void { return this.owner.retain(); }
  hasPending(): boolean { return this.owner.hasPending(); }
  acquire(key: string, conversationId: string) {
    return this.owner.acquire(key, conversationId, () => new AgentSteeringController<S>(this.send, this.id, this.captureNewIntent));
  }
  forgetConversation(id: string): void { this.owner.forgetConversation(id); }
  dispose(): void { this.owner.dispose(); }
}
