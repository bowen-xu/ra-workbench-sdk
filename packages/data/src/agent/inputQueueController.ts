import { decodeAgentQueueEditStatusResponse, decodeAgentQueueStorageFailure, type AgentQueueEditStatusResponse,
  type AgentQueueStorageFailure, type AgentQueueEdit, type AgentQueueCommand,
  type AgentQueueState, type AgentWritingQueueResponse, type AgentWritingQueueScope } from "@research-assistant/core/agent";
import { queueEditFailureMessage } from "./queueEditFailureMessage";
export interface AgentQueueGateway<S,Q extends AgentQueueState> {
  read(scope:S):Promise<Q>;
  edit(request:S & AgentQueueCommand):Promise<Q>;
  inspectEdit?(request:S & AgentQueueCommand):Promise<AgentQueueEditStatusResponse>;
}

export interface AgentInputQueueState<Q extends AgentQueueState = AgentWritingQueueResponse> {
  readonly queue: Q | null;
  readonly loading: boolean;
  readonly editing: boolean;
  readonly error: string | null;
  /** Original read failure and its frozen scope, for safe diagnostic presentation. */
  readonly readFailure?: { readonly cause: unknown; readonly scope: unknown } | null;
  readonly uncertain: boolean;
  /** Includes a reserved command whose reliable beforeSend step has not run. */
  readonly pending?: boolean;
  readonly retrying?: boolean;
  /** In-memory revision of successful queue reads, independent of queue edits. */
  readonly readSequence?: number;
}
function queueValueKey(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}
/** One controller per host/conversation. Dispose fences every late response;
 * uncertain writes keep their original request even after a successful reload. */
export class AgentInputQueueController<S = AgentWritingQueueScope,Q extends AgentQueueState = AgentWritingQueueResponse> {
  private state: AgentInputQueueState<Q> = { queue: null, loading: false, editing: false, error: null, uncertain: false, pending: false };
  private readonly listeners = new Set<() => void>();
  private pending: (S & AgentQueueCommand) | null = null;
  private acknowledgment: (() => void) | undefined;
  private beforeSend: ((request: S & AgentQueueCommand) => Promise<void>) | undefined;
  private beforeSendReady = false;
  private prepareNewIntent: ((requestId: string) => Promise<void>) | undefined;
  private isAdmissionDisabled: (() => boolean) | undefined;
  private mayHaveDispatched = false;
  private live = true;
  private readEpoch = 0;
  private readSequence = 0;
  private deferredReload: {readonly promise:Promise<void>;readonly resolve:()=>void} | undefined;
  private readonly runningDeferredReloads = new Set<()=>void>();
  private cancelBackoff: (() => void) | undefined;
  private readonly scope:S;
  constructor(private readonly gateway: AgentQueueGateway<S,Q>, scope:S,
    private readonly requestId: () => string,
    private readonly captureNewIntent?: (scope: S) => ((requestId: string) => Promise<void>) | undefined) {this.scope=structuredClone(scope);}
  getSnapshot = (): AgentInputQueueState<Q> => this.state;
  /** Copies the complete reserved identity; a read never acknowledges it. */
  getPendingRequest = (): (S & AgentQueueCommand) | null => this.pending ? structuredClone(this.pending) : null;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  dispose(): void { this.live = false; this.readEpoch++; this.cancelBackoff?.(); this.acknowledgment = undefined; this.listeners.clear();
    this.deferredReload?.resolve();this.deferredReload=undefined;
    for(const resolve of this.runningDeferredReloads)resolve();this.runningDeferredReloads.clear(); }
  private publish(update: Partial<AgentInputQueueState<Q>>): void {
    if (!this.live) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
    if(this.live && !this.state.editing && this.deferredReload){
      const deferred=this.deferredReload;this.deferredReload=undefined;
      this.runningDeferredReloads.add(deferred.resolve);
      const finish=()=>{this.runningDeferredReloads.delete(deferred.resolve);deferred.resolve();};
      void this.performReload(true).then(finish,finish);
    }
  }
  private accept(queue: Q): Q {
    return this.state.queue && this.state.queue.revision > queue.revision ? this.state.queue : queue;
  }
  private matchesScope(queue:Q):boolean {
    return !(this.scope && typeof this.scope==="object" && "conversationId" in this.scope
      && typeof this.scope.conversationId==="string") || queue.conversationId===this.scope.conversationId;
  }
  async reload(): Promise<void> { return this.performReload(false); }
  private async performReload(preserveError:boolean): Promise<void> {
    if (!this.live) return;
    if(this.state.editing){
      if(!this.deferredReload){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});this.deferredReload={promise,resolve};}
      return this.deferredReload.promise;
    }
    const epoch = ++this.readEpoch;
    this.publish({ loading: true });
    try {
      const queue = await this.gateway.read(this.scope);
      if (!this.live) return;
      if(epoch !== this.readEpoch){if(this.state.editing)await this.performReload(preserveError);return;}
      if (!this.matchesScope(queue)) throw new Error("QUEUE_SCOPE_MISMATCH");
      const current = !this.state.queue || queue.revision >= this.state.queue.revision;
      this.publish({ queue: this.accept(queue), loading: false, ...(current ? {readSequence: ++this.readSequence} : {}), error: this.pending || preserveError ? this.state.error : null,
        ...(!this.pending && !preserveError ? {readFailure: null} : {}) });
    } catch (cause: unknown) {
      if(this.live && epoch!==this.readEpoch && this.state.editing){await this.performReload(preserveError);return;}
      if (epoch === this.readEpoch) this.publish({ loading: false, error: this.pending ? this.state.error : "读取队列失败，请重试。",
        ...(!this.pending ? {readFailure: {cause, scope: structuredClone(this.scope)}} : {}) });
    }
  }
  async edit(edit: AgentQueueEdit, acknowledgment?: () => void,
    beforeSend?: (request: S & AgentQueueCommand) => Promise<void>, expectedEpoch?: string,
    isAdmissionDisabled?: () => boolean): Promise<boolean> {
    if (!this.live || this.pending || this.state.editing || this.state.loading || !this.state.queue) return false;
    if (isAdmissionDisabled?.()) return false;
    // Decoder in the gateway copies this request before sending. Retain an owned
    // edit too, so a caller cannot change an ambiguous retry through its array.
    const owned = structuredClone(edit);
    try { this.prepareNewIntent = this.captureNewIntent?.(structuredClone(this.scope)); }
    catch { this.publish({error: "QUEUE_PERSISTENCE_FAILED：队列意图尚未可靠保存，未发送请求，请重试。"}); return false; }
    this.pending = { ...this.scope, requestId: this.requestId(), expectedRevision: this.state.queue.revision, edit: owned, ...(expectedEpoch !== undefined ? {expectedEpoch} : {}) };
    this.acknowledgment = acknowledgment;
    this.beforeSend = beforeSend; this.beforeSendReady = false;
    this.isAdmissionDisabled = isAdmissionDisabled; this.mayHaveDispatched = false;
    this.publish({pending: true});
    return this.sendPending();
  }
  /** Reserve an already durable command without sending or replacing a newer
   * operation. Across reopening, a later rejection cannot disprove its commit. */
  restorePending(request: S & AgentQueueCommand, acknowledgment?: () => void,
    beforeSend?: (request: S & AgentQueueCommand) => Promise<void>): boolean {
    if (!this.live || this.state.editing) return false;
    const scope = this.scope;
    if (!scope || typeof scope !== "object") return false;
    const keys = Object.keys(scope), owned = structuredClone(request);
    if (Object.keys(owned).some(key => !keys.includes(key) && !["requestId", "expectedRevision", "edit", "expectedEpoch"].includes(key))
      || keys.some(key => !Object.hasOwn(owned, key) || queueValueKey(owned[key as keyof typeof owned]) !== queueValueKey(scope[key as keyof S]))) return false;
    const restoring = this.pending === null;
    if (this.pending) {
      if (queueValueKey(this.pending) !== queueValueKey(owned)) return false;
      // Reattaching may add an acknowledgment observer, but never loses the
      // original version-owned callback or changes an already saved request.
      if (acknowledgment && acknowledgment !== this.acknowledgment) {
        const original = this.acknowledgment;
        this.acknowledgment = () => {original?.(); acknowledgment();};
      }
      if (beforeSend) {this.beforeSend = beforeSend; this.beforeSendReady = false;}
    } else {
      this.pending = owned; this.acknowledgment = acknowledgment; this.prepareNewIntent = undefined;
      this.beforeSend = beforeSend; this.beforeSendReady = false;
      this.isAdmissionDisabled = undefined; this.mayHaveDispatched = true;
    }
    this.publish({pending: true, uncertain: restoring || this.state.uncertain});
    return true;
  }
  async retry(): Promise<boolean> {
    if (!this.live || !this.pending || this.state.editing) return false;
    return this.sendPending();
  }
  private backoff(delayMs: number): Promise<void> {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); this.cancelBackoff = undefined; resolve(); };
      const timer = setTimeout(finish, delayMs);
      this.cancelBackoff = finish;
    });
  }
  private acknowledge(request: S & AgentQueueCommand, queue?: Q): boolean {
    if (!this.live || this.pending !== request) return false;
    this.pending = null;
    const acknowledge = this.acknowledgment;
    this.acknowledgment = undefined;
    this.beforeSend = undefined; this.beforeSendReady = false;
    this.prepareNewIntent = undefined;
    this.isAdmissionDisabled = undefined; this.mayHaveDispatched = false;
    // The original version-owned draft must be signed off before a detached
    // registry may collect this now-settled controller during publication.
    acknowledge?.();
    this.publish({ ...(queue ? {queue: this.accept(queue)} : {}), editing: false,
      retrying: false, uncertain: false, pending: false, error: null });
    return true;
  }
  private async inspectPending(request: S & AgentQueueCommand): Promise<boolean> {
    if (!this.gateway.inspectEdit) return false;
    const status = decodeAgentQueueEditStatusResponse(
      await this.gateway.inspectEdit(structuredClone(request)), request,
    );
    if (status.status.type !== "committed" || !this.acknowledge(request)) return false;
    // This historical Q proves only the original edit. Refresh current Q
    // separately; a failed read cannot undo the confirmed draft acknowledgment.
    await this.reload();
    return true;
  }
  private async sendPending(): Promise<boolean> {
    let request = this.pending;
    if (!request) return false;
    if (!this.mayHaveDispatched && this.isAdmissionDisabled?.()) return this.rejectAdmission(request);
    let ambiguous = this.state.uncertain;
    let rebasedAdd = false;
    let storageFailure: AgentQueueStorageFailure | undefined;
    ++this.readEpoch;
    this.publish({ loading: false, editing: true, retrying: false, error: null });
    if (this.prepareNewIntent) {
      try { await this.prepareNewIntent(request.requestId); }
      catch {
        this.publish({editing:false,retrying:false,error:"QUEUE_PERSISTENCE_FAILED：队列意图尚未可靠保存，未发送请求，请重试。"});
        return false;
      }
      if (!this.live || this.pending !== request) return false;
    }
    if (!this.beforeSendReady && this.beforeSend) {
      try {await this.beforeSend(structuredClone(request));}
      catch {
        this.publish({editing: false, retrying: false, error: "QUEUE_PERSISTENCE_FAILED：队列意图尚未可靠保存，未发送请求，请重试。"});
        return false;
      }
      if (!this.live || this.pending !== request) return false;
      this.beforeSendReady = true;
    }
    if (ambiguous) {
      try { if (await this.inspectPending(request)) return true; }
      catch (error) { storageFailure = decodeAgentQueueStorageFailure(error, request); }
      if (!this.live || this.pending !== request) return false;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const outgoing = structuredClone(request);
      if (!this.mayHaveDispatched && this.isAdmissionDisabled?.()) return this.rejectAdmission(request);
      try {
        this.mayHaveDispatched = true;
        const queue = await this.gateway.edit(outgoing);
        return this.acknowledge(request, queue);
      } catch (error) {
        if (!this.live) return false;
        storageFailure = decodeAgentQueueStorageFailure(error, request) ?? storageFailure;
        const code = error && typeof error === "object" && "code" in error ? error.code : "";
        // These native errors prove the edit did not commit. Storage, decoding and
        // transport errors do not prove absence of a durable receipt.
        // Authorization precedes receipt replay: a rejected retry cannot prove
        // that the earlier ambiguous attempt failed to commit.
        const definitive = ["invalid", "conflict", "busy", "paused", "capacity", "closed", "notFound"].includes(String(code));
        let rejectedRefresh:Q|undefined;
        // A fresh, definitely rejected append can race a completed handoff's
        // queue revision. Rebase only after a same-conversation read proves the
        // revision advanced and this input is still absent. An ambiguous write
        // must always retain the original request and must never be rebased.
        if(!ambiguous && !rebasedAdd && code==="conflict" && request.edit.type==="add" && !this.beforeSend
          && this.scope && typeof this.scope==="object" && "conversationId" in this.scope && typeof this.scope.conversationId==="string"){
          try {
            const inputId=request.edit.inputId;
            const queue=await this.gateway.read(this.scope);
            if(!this.live || this.pending!==request)return false;
            if(queue.conversationId===this.scope.conversationId)rejectedRefresh=queue;
            if(rejectedRefresh && Number.isSafeInteger(queue.revision)
              && queue.revision>request.expectedRevision && !queue.inputs.some(input=>input.inputId===inputId)){
              const newRequestId=this.requestId();
              if(newRequestId && newRequestId!==request.requestId){
                if (this.isAdmissionDisabled?.()) return this.rejectAdmission(request);
                if (this.prepareNewIntent) {
                  try { await this.prepareNewIntent(newRequestId); }
                  catch { this.publish({editing:false,retrying:false,error:"QUEUE_PERSISTENCE_FAILED：队列意图尚未可靠保存，未发送请求，请重试。"}); return false; }
                  if (!this.live || this.pending !== request) return false;
                }
                request={...request,requestId:newRequestId,expectedRevision:queue.revision};
                this.pending=request;rebasedAdd=true;this.mayHaveDispatched=false;
                this.publish({queue:this.accept(queue)});
                attempt--;continue;
              }
            }
          } catch {/* The original rejection remains authoritative; never guess a new revision. */}
        }
        if (ambiguous || !definitive) {
          try { if (await this.inspectPending(request)) return true; }
          catch (statusError) { storageFailure = decodeAgentQueueStorageFailure(statusError, request) ?? storageFailure; }
          if (!this.live || this.pending !== request) return false;
        }
        const rejected = !ambiguous && definitive;
        let rejectionMessage = "队列操作未应用，消息已保留。";
        if (rejected) {
          this.pending = null; this.acknowledgment = undefined; this.beforeSend = undefined; this.beforeSendReady = false;
          // Refresh authoritative state without replaying the rejected edit or
          // replacing the caller's version-owned draft.
          try {
            const queue = rejectedRefresh ?? await this.gateway.read(this.scope);
            if (!this.live) return false;
            if(!this.matchesScope(queue))throw new Error("QUEUE_SCOPE_MISMATCH");
            this.publish({ queue: this.accept(queue) });
          } catch { rejectionMessage = "队列操作未应用，暂时无法更新队列，消息已保留。"; }
        } else if (!definitive && attempt < 2) {
          // Native queue edits have durable receipts. Retry the exact identity,
          // revision and body; never infer acknowledgment from a queue read.
          ambiguous = true;
          this.publish({ uncertain: true, retrying: true });
          await this.backoff(attempt === 0 ? 300 : 900);
          if (!this.live) return false;
          continue;
        }
        if (!this.live) return false;
        this.publish({ editing: false, retrying: false, uncertain: !rejected, pending: !rejected, error: rejected
          ? rejectionMessage
          : `队列暂时无法同步，消息已保留。${storageFailure ? queueEditFailureMessage(storageFailure) : ""}` });
        return false;
      }
    }
    return false;
  }
  /** A warm command proved unissued by this owner has no receipt to sign off. */
  private rejectAdmission(request: S & AgentQueueCommand): false {
    this.pending = null; this.acknowledgment = undefined;
    this.beforeSend = undefined; this.beforeSendReady = false; this.prepareNewIntent = undefined;
    this.isAdmissionDisabled = undefined; this.mayHaveDispatched = false;
    this.publish({editing: false, retrying: false, pending: false, uncertain: false,
      error: `WRITING_RUNTIME_UNAVAILABLE：写作插件未就绪，队列操作未发送，原输入已保留。[requestId=${request.requestId}]`});
    return false;
  }
}
