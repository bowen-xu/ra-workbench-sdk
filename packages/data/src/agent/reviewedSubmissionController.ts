import type {AgentExecutionMode,AgentStartResponse,AgentTurnOutcome} from "@research-assistant/core/agent";
import type {AgentTurnGateway} from "./turn";

export interface SubmissionReviewAdapter<Request, Receipt> {
  readonly conversationId:string;
  decodeRequest(value:Request):Request;
  decodeReceipt(value:unknown):Receipt;
  receipt(request:Request):Receipt;
}
export interface ReviewedSubmissionGateway<Request, Receipt, Preview> {
  prepare(request:Request):Promise<Preview>;
  restore(receipt:Receipt):Promise<Preview>;
  start(preview:Preview,mode:AgentExecutionMode):Promise<AgentStartResponse>;
}
export interface ReviewedSubmissionSnapshot<Request, Receipt, Preview> {
  readonly phase: "idle" | "preparing" | "preview" | "starting" | "started" | "error";
  readonly request: Request | null;
  readonly recoveryReceipt: Receipt | null;
  readonly preview: Preview | null;
  readonly admission: AgentStartResponse | null;
  readonly error: "prepare" | "start" | "startRejected" | "stop" | null;
  /** Native error retained for the host's allowlisted diagnostic adapter. */
  readonly cause?: unknown;
  readonly outcome: AgentTurnOutcome | null;
  readonly stopPending: boolean;
  readonly stopRequested: boolean;
}
function initial<Request, Receipt, Preview>(): ReviewedSubmissionSnapshot<Request, Receipt, Preview> { return { phase:"idle",request:null,recoveryReceipt:null,preview:null,admission:null,error:null,cause:undefined,outcome:null,stopPending:false,stopRequested:false }; }

/** Hosts supply typed disclosure adapters; one coordinator owns review and recovery semantics. */
export class ReviewedSubmissionController<Request, Receipt extends {conversationId:string}, Preview extends {turnId:string}> {
  private state = initial<Request, Receipt, Preview>();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private disposed = false;
  private ambiguousStart = false;
  private acknowledgment: (() => void) | undefined;
  private readonly conversationId:string;
  constructor(private readonly adapter: SubmissionReviewAdapter<Request, Receipt>,
    private readonly gateway: ReviewedSubmissionGateway<Request, Receipt, Preview>, private readonly turns: AgentTurnGateway,
    private readonly options: { readonly isStartRejected?: (error: unknown) => boolean } = {}) {
    this.conversationId=adapter.conversationId;
  }
  getSnapshot = (): ReviewedSubmissionSnapshot<Request, Receipt, Preview> => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }
  protected update(patch: Partial<ReviewedSubmissionSnapshot<Request, Receipt, Preview>>): void {
    this.state = {...this.state,...patch}; for (const listener of this.listeners) listener();
  }
  async prepare(value: Request, acknowledgment?: () => void): Promise<void> {
    if (this.disposed || this.state.phase !== "idle") return;
    const request = this.adapter.decodeRequest(value);
    this.acknowledgment = acknowledgment;
    this.update({...initial<Request, Receipt, Preview>(),phase:"preparing",request});
    await this.load(++this.epoch, false);
  }
  private async load(epoch: number, restore: boolean): Promise<void> {
    const request = this.state.request;
    const receipt = this.state.recoveryReceipt ?? (request ? this.adapter.receipt(request) : null);
    if (!receipt) return;
    try {
      const preview = restore || !request
        ? await this.gateway.restore({...receipt})
        : await this.gateway.prepare(structuredClone(request));
      if (this.current(epoch)) this.update({phase:"preview",preview,error:null,cause:undefined});
    } catch (cause: unknown) { if (this.current(epoch)) this.update({phase:"error",error:"prepare",cause}); }
  }
  async recover(value: Receipt): Promise<void> {
    if (this.disposed || this.state.phase !== "idle") return;
    const receipt=this.adapter.decodeReceipt(value);
    this.acknowledgment=undefined;
    this.update({...initial<Request, Receipt, Preview>(),phase:"preparing",recoveryReceipt:receipt});
    await this.load(++this.epoch,true);
  }
  async retryPrepare(restore = false): Promise<void> {
    if (this.disposed || this.state.phase !== "error" || this.state.error !== "prepare") return;
    this.update({phase:"preparing",error:null,cause:undefined}); await this.load(++this.epoch, restore);
  }
  async confirm(mode: AgentExecutionMode): Promise<void> {
    const preview = this.state.preview;
    if (this.disposed || !preview || !(this.state.phase === "preview" || (this.state.phase === "error" && this.state.error === "start"))) return;
    const epoch = ++this.epoch;
    this.update({phase:"starting",error:null,cause:undefined});
    try {
      const admission = await this.gateway.start(structuredClone(preview), mode);
      if (this.current(epoch)) {
        const acknowledge = this.acknowledgment;
        this.acknowledgment = undefined;
        acknowledge?.();
        this.update({phase:"started",admission,outcome:this.state.outcome ?? admission.outcome});
      }
    } catch (error: unknown) {
      if (!this.current(epoch)) return;
      const reason=error&&typeof error==="object"&&"reason" in error?error.reason:null;
      const queueCode=reason&&typeof reason==="object"&&"code" in reason?reason.code:null;
      const rejected = this.options.isStartRejected?.(error) ?? (typeof error === "object" && error !== null && "code" in error
        && (["unsupportedModel","confirmationMismatch","preparation","modelUnavailable"].includes(String(error.code))
          || (error.code==="queue" && ["invalid","conflict","busy","paused","capacity","closed"].includes(String(queueCode)))));
      // A later rejection cannot prove an earlier unacknowledged attempt never started.
      this.ambiguousStart ||= !rejected;
      this.update({phase:"error",error:this.ambiguousStart ? "start" : "startRejected",cause:error});
    }
  }
  /** A trusted history observer found this exact preview's admitted turn.
   * Keep admission null: history is evidence, not a fabricated start reply. */
  observeStarted(turnId: string): void {
    if (this.disposed || this.state.phase !== "preview" || this.state.preview?.turnId !== turnId) return;
    const acknowledge = this.acknowledgment;
    this.acknowledgment = undefined;
    acknowledge?.();
    this.update({phase:"started"});
  }
  observeOutcome(turnId: string, outcome: AgentTurnOutcome): void {
    if (this.disposed || this.state.preview?.turnId !== turnId || !["starting","started","error"].includes(this.state.phase)) return;
    const acknowledge = this.acknowledgment;
    this.acknowledgment = undefined;
    acknowledge?.();
    this.update({outcome,stopPending:false,stopRequested:false});
  }
  async stop(): Promise<void> {
    const state = this.state;
    if (this.disposed || !state.preview || !["starting","started","error"].includes(state.phase)
      || state.outcome || state.stopPending || state.stopRequested) return;
    const epoch = this.epoch;
    this.update({stopPending:true});
    try {
      const result = await this.turns.interrupt({conversationId:this.conversationId,turnId:state.preview.turnId});
      if (this.current(epoch)) this.update({stopPending:false,stopRequested:!this.state.outcome && result.cancellationRequested});
    } catch (cause: unknown) { if (this.current(epoch)) this.update({stopPending:false,error:state.error ?? "stop",cause:state.cause ?? cause}); }
  }
  dismiss(): boolean {
    if (this.disposed || this.state.phase === "preparing" || (this.state.phase === "starting" && !this.state.outcome)
      || (!this.state.outcome && (this.state.phase === "started" || this.state.error === "start"))) return false;
    ++this.epoch; this.ambiguousStart = false; this.acknowledgment=undefined; this.update(initial<Request, Receipt, Preview>()); return true;
  }
  /** A domain adapter has authoritative proof that this exact preview was
   * retired without starting. Clear it without fabricating an execution outcome. */
  protected retireUnstartedPreview(preview: Preview): boolean {
    if (this.disposed || this.state.preview !== preview || this.state.admission || this.state.outcome
      || ["preparing", "starting", "started"].includes(this.state.phase)) return false;
    ++this.epoch; this.ambiguousStart = false; this.acknowledgment = undefined;
    this.update(initial<Request, Receipt, Preview>()); return true;
  }
  dispose(): void { this.disposed = true; ++this.epoch; this.acknowledgment = undefined; this.listeners.clear(); }
}
