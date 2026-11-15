import { conflictingParagraphs, createDraft, finishPlan, finishSynchronization, paragraph, planSave, planSynchronization, stageSynchronization, acknowledgedDraft, planBaselineSynchronization, acknowledgedBaselineDraft,
  type ModelDraft, type ModelSnapshot, type ParagraphUpdate, type SavePlan, type SynchronizationPlan } from "./model";
import type { ConflictChoice } from "./merge";
import { HbsCommitError, type HbsClientPort, type HbsCommitReceipt } from "./ports";
import { applyParagraphUpdates, changedUpdates } from "./patch";
import type { HbsTextPolicy, TextDiff } from "./textDiff";
import { incomingEdits, incomingPartId, reconciledAncestor, type IncomingChoice, type IncomingEdit } from "./incoming";
import { mergeText, renderMerge } from "./merge";
import { planHistoryReplay, type HistoryCommit, type HistoryDirection } from "./historyReplay";
import { capturePreservation, restorePreservation, MemoryHbsPreservationStore, HbsCheckpointWriter, type HbsPreservationStore, type HbsPreservation } from "./preservation";

interface ReviewIntent { readonly source: ModelSnapshot; readonly content: string; readonly baseline: string; readonly history?: HistoryAction;readonly origin?:ModelDraft }
type Operation = { readonly kind: "save"; readonly plan: SavePlan }
  | { readonly kind: "sync"; readonly plan: SynchronizationPlan }
  | { readonly kind: "review"; readonly plan: SynchronizationPlan; readonly intent: ReviewIntent };
interface PendingWrite {
  readonly id: string; readonly kind: "save" | "review" | "resolution" | "history" | "baseline";
  readonly before: ModelSnapshot;
  readonly input:ModelDraft;
  readonly commitBase: ModelSnapshot;
  readonly updates: readonly ParagraphUpdate[];
  readonly reviewIntent?: ReviewIntent;
  readonly historyCommit?: HistoryCommit;
  readonly historyReplay?: HistoryReplay;
}
type HistoryFrame = Pick<SyncClientState, "observed" | "draft">;
interface HistoryAction {
  readonly before: HistoryFrame; after: HistoryFrame;
  readonly commits: HistoryCommit[]; cancelled: readonly ReviewIntent[]; readonly review: boolean;
}
interface HistoryReplay { readonly action: HistoryAction; readonly direction: HistoryDirection; readonly rejectedRequest?: string }
interface HistoryView extends HistoryReplay { readonly baseline: string; readonly displayBaseline: string }
export interface SyncClientState {
  readonly preserved: string | undefined;
  readonly preservationError: string | undefined;
  readonly observed: ModelSnapshot;
  readonly draft: ModelDraft | undefined;
  readonly operation: Operation | undefined;
  readonly choices: Readonly<Record<string, ConflictChoice>>;
  readonly pendingWrite: PendingWrite | undefined;
  readonly queuedReviews: readonly ReviewIntent[];
  readonly queuedSave: boolean;
  readonly message: string;
}

/** The client only receives server state through its port. Local review intents
 * retain their visible ancestor and compose sequentially after earlier receipts. */
export interface HbsClientOptions {
  readonly port: HbsClientPort; readonly documentId: string; readonly policy: HbsTextPolicy;
  readonly preservation?: HbsPreservationStore; readonly requestId: (sequence: number) => string;
}

export class HbsClient {
  private state: SyncClientState;
  private latestReceived: ModelSnapshot;
  private sequence = 0;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private activeHistory: HistoryAction | undefined;
  private readonly historyReplays: HistoryReplay[] = [];
  private historyView: HistoryView | undefined;
  private ownSave: ModelSnapshot | undefined;
  private disposed = false;
  private preservationBlocked = false;
  private readonly port: HbsClientPort;
  readonly documentId: string;
  private readonly diff: TextDiff;
  private readonly policy: HbsTextPolicy;
  private readonly preservation: HbsPreservationStore;
  private readonly writer: HbsCheckpointWriter;
  private readonly requestId: (sequence: number) => string;
  static async open(options: HbsClientOptions): Promise<HbsClient> {
    let recovery: HbsPreservation | undefined, error: unknown;
    try { recovery = await options.preservation?.load(); } catch (reason) { error = reason; }
    return new HbsClient(options, recovery, error);
  }
  private constructor(options: HbsClientOptions, recovery: HbsPreservation | undefined, recoveryError: unknown) {
    this.port = options.port; this.documentId = options.documentId; this.policy = options.policy; this.diff = options.policy.calculate;
    this.preservation = options.preservation ?? new MemoryHbsPreservationStore(); this.requestId = options.requestId;
    const port = this.port, documentId = this.documentId;
    this.latestReceived = port.initialSnapshot;
    this.state = { preserved: undefined, preservationError: undefined, observed: port.initialSnapshot, draft: undefined, operation: undefined, choices: {}, pendingWrite: undefined, queuedReviews: [], queuedSave: false,
      message: "初始快照已读取；保存与接受相互独立。" };
    this.writer = new HbsCheckpointWriter(this.preservation, (record, error) => {
      if (this.disposed) return;
      this.state = error ? { ...this.state, preservationError: this.preservationFailure(error) }
        : { ...this.state, preserved: record.content, preservationError: undefined };
      this.listeners.forEach(listener => listener());
    });
    this.unsubscribe = port.subscribeSnapshots(snapshot => this.receive(snapshot));
    try {
      if (recoveryError) throw recoveryError;
      if (recovery) {
        this.state = { ...this.state, observed: recovery.observed, draft: restorePreservation(recovery, documentId), preserved: recovery.content };
        this.receive(port.initialSnapshot, true, false);
        this.status(this.state.operation ? "已从 S′ 恢复编辑；与当前 S 的冲突已重新计算，仍需核对。" : "已从 S′ 恢复编辑和待审 Diff；恢复不代表 Keep。");
      } else this.checkpoint();
    } catch (reason) {
      this.preservationBlocked = true;
      this.state = { ...this.state, preservationError: this.preservationFailure(reason) };
    }
  }
  readonly preservationDurable = (): boolean => this.preservation.durable;
  readonly getSnapshot = (): SyncClientState => this.state;
  readonly history = {
    perform: (action: () => void, review?: { readonly value: string; readonly baseline: string }) => this.performHistory(action, review),
    restoreEdit: (value: string, changes: readonly { readonly before: string; readonly after: string }[]) => {
      let baseline = this.baseline;
      for (const change of changes) baseline = renderMerge(mergeText(change.before, change.after, baseline, this.diff), "candidate", baseline, "local").saved;
      this.edit(value, baseline);
      this.checkpoint();
    },
  };
  private frame(): HistoryFrame { const { observed, draft } = this.state; return { observed, draft }; }
  private frameValue(frame: HistoryFrame): string { return frame.draft?.value ?? paragraph(frame.observed.saved, this.documentId).text; }
  private frameBaseline(frame: HistoryFrame): string { return frame.draft?.editedBaseline ?? paragraph(frame.observed.baseline, this.documentId).text; }
  private performHistory(run: () => void, review?: { readonly value: string; readonly baseline: string }) {
    const before = this.frame(), operation = this.state.operation, pending = this.state.pendingWrite, queue = this.state.queuedReviews;
    const action: HistoryAction = { before, after: before, commits: [], cancelled: [], review: review !== undefined };
    this.activeHistory = action;
    try {
      run();
      // Discard changes H immediately, so its real text inverse belongs to this
      // history unit. Keep leaves B′ pending until the write is acknowledged.
      if (review && review.value !== this.content && (pending !== this.state.pendingWrite || queue !== this.state.queuedReviews)) this.edit(review.value, this.baseline);
    } finally { this.activeHistory = undefined; }
    const visible = this.frame();
    action.after = review ? { ...visible, draft: { ...(visible.draft ?? createDraft(visible.observed, this.documentId, review.value)),
      value: review.value, editedBaseline: review.baseline } } : visible;
    if (before.draft === visible.draft && operation === this.state.operation && pending === this.state.pendingWrite && queue === this.state.queuedReviews) return undefined;
    this.checkpoint();
    const point = (direction: HistoryDirection, frame: HistoryFrame) => ({ value: this.frameValue(frame), baseline: this.frameBaseline(frame),
      restore: (value: string) => this.restoreHistory(action, direction, value) });
    return { before: point("before", before), after: point("after", visible) };
  }
  private restoreHistory(action: HistoryAction, direction: HistoryDirection, value: string): void {
    try {
      const target = action[direction], source = action[direction === "before" ? "after" : "before"];
      const parts = mergeText(this.frameBaseline(source), this.frameBaseline(target), this.baseline, this.diff);
      const desired = renderMerge(parts, "candidate", this.frameBaseline(target), "local").saved;
      if (direction === "before") {
        action.cancelled = this.state.queuedReviews.filter(intent => intent.history === action);
        this.update({ queuedReviews: this.state.queuedReviews.filter(intent => intent.history !== action) });
      } else if (action.cancelled.length) {
        this.update({ queuedReviews: [...this.state.queuedReviews, ...action.cancelled] }); action.cancelled = [];
      }
      const displayBaseline = direction === "after" && action.review ? this.baseline : desired;
      this.historyView = { action, direction, baseline: desired, displayBaseline };
      this.installHistoryFrame(target, value, displayBaseline, !action.commits.length);
      this.historyReplays.push({ action, direction });
      this.status(`${direction === "before" ? "撤销" : "重做"}冲突／审阅操作；已发消息保持不变，通过新的补偿写入核对。`);
      this.drainReviews();
    } catch (reason) { this.error(reason); }
  }
  private installHistoryFrame(frame: HistoryFrame, value: string, baseline: string, useOwnSave = false): void {
    const input = frame.draft ?? createDraft(frame.observed, this.documentId, value);
    const ancestor = useOwnSave && this.ownSave && this.ownSave.version >= frame.observed.version
      ? paragraph(this.ownSave.saved, this.documentId).text : input.base;
    const draft: ModelDraft = { ...input, base: ancestor, value, editedBaseline: baseline,
      baseline: paragraph(this.latestReceived.baseline, this.documentId).text, kind: value === baseline ? "body" : "candidate" };
    const plan = planSynchronization(this.latestReceived, this.latestReceived, this.documentId, draft, this.policy);
    if (conflictingParagraphs(plan.review).length) this.update({ observed: this.latestReceived, draft, operation: { kind: "sync", plan }, choices: {} });
    else this.update({ ...finishSynchronization(plan, this.latestReceived), operation: undefined, choices: {} });
  }
  private drainHistory(): boolean {
    const replay = this.historyReplays.shift();
    if (!replay) return false;
    try {
      const plan = planHistoryReplay(replay.action.commits, replay.direction, this.latestReceived, this.documentId, this.policy);
      if ("conflict" in plan) {
        this.historyView = undefined;
        this.update({ operation: { kind: "sync", plan: plan.conflict }, choices: {} });
        this.status(`MODEL_HISTORY_CONFLICT：撤销／重做与 v${this.latestReceived.version} 的新写入冲突，当前输入已保留，请核对 incoming。${replay.rejectedRequest ? ` 请求 ${replay.rejectedRequest} 返回 MODEL_VERSION_CONFLICT。` : ""}`);
      } else if (changedUpdates(this.latestReceived, [plan.update]).length) {
        this.queue(plan.update.saved, plan.update.baseline, "history", undefined, replay);
      } else { this.finishHistoryView(); this.drainReviews(); }
    } catch (reason) { this.historyReplays.unshift(replay); this.error(reason); }
    return true;
  }
  private finishHistoryView(): void {
    const view = this.historyView;
    if (!view) return;
    const done = !this.historyReplays.length && !this.state.pendingWrite && !this.state.queuedReviews.some(intent => intent.history === view.action);
    const baseline = renderMerge(mergeText(view.displayBaseline, done ? view.baseline : view.displayBaseline, this.baseline, this.diff), "candidate", this.baseline, "local").saved;
    this.installHistoryFrame(view.action[view.direction], this.content, baseline, !view.action.commits.length);
    if (done) this.historyView = undefined;
  }
  readonly getIncoming = (): readonly IncomingEdit[] => {
    const operation = this.state.operation;
    if (!operation) return [];
    const plan = operation.kind === "save" ? operation.plan : operation.plan.review;
    return incomingEdits(plan, this.content, this.baseline,
      operation.kind === "review" ? "remote" : "local", this.policy);
  };
  /** Take/Both stage a candidate locally. Keep/Undo additionally record a
   * normal review intent; all authority writes remain version checked. */
  readonly resolveIncoming = (choice: IncomingChoice): void => {
    const operation = this.state.operation;
    if (!operation) { this.status("冲突已更新，请对当前候选重新操作。"); return; }
    try {
      const selected = new Set(choice.ids);
      const plan = operation.kind === "save"
        ? planSynchronization(this.state.observed, this.latestReceived, this.documentId, this.state.draft, this.policy)
        : operation.plan;
      const item = plan.review.paragraphs[0]!;
      const currentSide = operation.kind === "review" ? "remote" : "local";
      const input = this.state.draft ?? createDraft(this.state.observed, this.documentId, this.content);
      const next: ModelDraft = { ...input, kind: "candidate", value: choice.value,
        base: reconciledAncestor(item.id, item.parts, selected, currentSide === "local" ? "remote" : "local"),
        baseline: reconciledAncestor(`${item.id}:baseline`, plan.baselineParts, selected),
        editedBaseline: choice.action === "incoming" ? plan.baselineParts.map(part =>
          selected.has(incomingPartId(`${item.id}:baseline`, part)) ? part.remote : part.source === "remote" ? part.remote : part.local).join("") : this.baseline,
      };
      const remaining = planSynchronization(this.state.observed, this.latestReceived, this.documentId, next, this.policy);
      const queuedReviews = operation.kind === "review" ? this.state.queuedReviews.filter(intent => intent !== operation.intent) : this.state.queuedReviews;
      if (conflictingParagraphs(remaining.review).length) {
        this.update({ draft: next, operation: { kind: "sync", plan: remaining }, choices: {}, queuedReviews });
      } else {
        const result = finishSynchronization(remaining, this.latestReceived);
        this.update({ observed: result.observed, draft: result.draft, operation: undefined, choices: {}, queuedReviews });
      }
      this.status(`${choice.action === "incoming" ? "Take" : choice.action === "both" ? "Both" : choice.action}：已核对所选冲突；绿色候选仍可编辑。`);
      if (choice.action === "keep" || choice.action === "undo") this.review(choice.value, choice.baseline);
      else this.drainReviews();
    } catch (reason) { this.error(reason); }
  };
  readonly syncLatest = async (): Promise<void> => {
    try {
      const snapshot = await this.port.syncLatest(this.latestReceived.version);
      if (snapshot) this.receive(snapshot); else this.trySynchronizeBaseline();
    } catch (reason) { this.error(reason); }
  };
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose(): void { this.disposed = true; this.unsubscribe(); this.listeners.clear(); }
  private update(value: Partial<SyncClientState>, preserve = true): void {
    const changed = "draft" in value || "observed" in value;
    this.state = { ...this.state, ...value };
    if (preserve && changed) this.preserve();
    this.listeners.forEach(listener => listener());
  }
  private preservationFailure(reason: unknown): string {
    const cause = reason instanceof Error ? reason.cause : undefined;
    const storageCause = cause instanceof Error && ["QuotaExceededError", "SecurityError"].includes(cause.name) ? `（${cause.name}）` : "";
    return `MODEL_PRESERVATION_FAILED：S′ 未保全（文档 ${this.documentId}）；${reason instanceof Error ? reason.message : String(reason)}${storageCause}`;
  }
  private preserve(): void | Promise<void> {
    if (this.disposed || this.preservationBlocked) return;
    try { return this.writer.write(capturePreservation(this.state.observed, this.state.draft, this.documentId, this.diff)); }
    catch (reason) { this.state = { ...this.state, preservationError: this.preservationFailure(reason) }; }
  }
  private checkpoint(): void | Promise<void> { const pending = this.preserve(); this.listeners.forEach(listener => listener()); return pending; }
  private get content(): string { return this.state.draft?.value ?? paragraph(this.state.observed.saved, this.documentId).text; }
  private get baseline(): string { return this.state.draft?.editedBaseline ?? paragraph(this.state.observed.baseline, this.documentId).text; }
  /** A temporary comparison context, not an invented backend revision. */
  private viewSnapshot(): ModelSnapshot {
    return { version: this.state.observed.version,
      saved: this.state.observed.saved.map(item => item.id === this.documentId ? { ...item, text: this.content } : item),
      baseline: this.state.observed.baseline.map(item => item.id === this.documentId ? { ...item, text: this.baseline } : item) };
  }
  readonly edit = (value: string, editedBaseline: string): void => {
    if (value === this.content && editedBaseline === this.baseline) return;
    const next = { ...(this.state.draft ?? createDraft(this.state.observed, this.documentId, value)), value, editedBaseline };
    this.update({ draft: value === paragraph(this.state.observed.saved, this.documentId).text && editedBaseline === paragraph(this.state.observed.baseline, this.documentId).text && next.base===(next.syncBase??next.base) ? undefined : next }, false);
    if (this.state.operation) {
      const previous = this.state.operation;
      this.update({ operation: previous.kind === "review" ? { ...previous, plan: this.reviewPlan(previous.intent) }
        : { kind: "sync", plan: planSynchronization(this.state.observed, this.latestReceived, this.documentId, this.state.draft, this.policy) }, choices: {} });
    }
    this.status("本地编辑已保留，尚未确认写入；旧冲突选择已重新核对。");
  };
  readonly choose = (id: string, choice: ConflictChoice): void => { this.update({ choices: { ...this.state.choices, [id]: choice } }); this.status("已记录冲突选择 " + choice + "；不改变已发送请求。"); };
  private status(message: string): void { this.update({ message }); this.port.recordAction?.(message); }
  private error(reason: unknown): void {
    const message = reason instanceof Error ? reason.message : String(reason);
    this.status(/^MODEL_[A-Z0-9_]+[:：]/u.test(message) ? message : `MODEL_OPERATION_FAILED：${message}`);
  }
  private receive(snapshot: ModelSnapshot, reconcileKnownVersion = false, alignBaseline = true): void {
    if (this.disposed) return;
    if (snapshot.version < this.latestReceived.version || snapshot.version === this.latestReceived.version && !reconcileKnownVersion) { this.port.recordAction?.("忽略旧更新 v" + snapshot.version); return; }
    this.latestReceived = snapshot;
    if (this.historyView && (this.state.pendingWrite || this.historyReplays.length)) {
      this.status("历史操作等待回执；已保留当前输入并记录最新 S，补偿写入继续核对版本。"); return;
    }
    if (this.state.pendingWrite?.kind === "resolution" || this.state.pendingWrite?.kind === "baseline") return;
    if (this.state.pendingWrite && this.state.draft?.editedBaseline !== undefined && this.state.draft.editedBaseline !== this.state.draft.baseline) {
      this.status("普通输入等待前序保存回执；已记录最新 S，之后先同步 B/B′ 再协调。"); return;
    }
    try {
      // A queued review conflict must first incorporate the real server update;
      // its original intent remains queued and is recomposed afterwards.
      if (this.state.operation?.kind === "review") this.update({ operation: undefined, choices: {} });
      if (alignBaseline && this.trySynchronizeBaseline()) return;
      const plan = planSynchronization(this.state.observed, snapshot, this.documentId, this.state.draft, this.policy);
      if (conflictingParagraphs(plan.review).length) {
        this.installConflictingSynchronization(plan);
        this.status("MODEL_VERSION_CHANGED：相容更新已显示；冲突处保留输入和 incoming，旧选择未写入。");
      } else {
        const result = finishSynchronization(plan, snapshot);
        const dirty=result.draft&&(result.draft.value!==paragraph(snapshot.saved,this.documentId).text||result.draft.editedBaseline!==paragraph(snapshot.baseline,this.documentId).text);
        this.update({ observed: result.observed, draft: result.draft, operation: undefined, choices: {}, message: dirty
          ? "已收到 S 更新，本地输入仍未保存。" : "已收到 S 更新，剩余候选等待 Keep。" });
        this.drainReviews();
      }
    } catch (reason) { this.error(reason); }
  }
  private trySynchronizeBaseline(): boolean {
    if (this.state.pendingWrite || this.historyView || this.historyReplays.length) return false;
    const update = planBaselineSynchronization(this.latestReceived, this.documentId, this.state.draft, this.diff);
    if (!update) return false;
    this.checkpoint();
    this.update({ operation: undefined, choices: {} });
    this.queue(update.saved, update.baseline, "baseline");
    this.status("先同步普通输入的 B′ 差量；等待版本校验与回执，再按原规则协调 S/B/H。");
    return true;
  }
  private installConflictingSynchronization(plan: SynchronizationPlan): void {
    const staged = stageSynchronization(plan);
    const remaining = planSynchronization(staged.observed, staged.observed, this.documentId, staged.draft, this.policy);
    this.update({ ...staged, operation: { kind: "sync", plan: remaining }, choices: {} });
  }
  readonly save = (): void => {
    this.port.recordAction?.("点击保存 H");
    // Preservation is independent of CAS, unresolved conflicts and in-flight
    // requests. A failed checkpoint never masquerades as durable success.
    const content = this.content, baseline = this.baseline;
    const preserving = this.checkpoint();
    if (preserving) { void preserving.then(() => {
      if (this.disposed) return;
      if (this.content !== content || this.baseline !== baseline) this.save(); else this.saveNow();
    }); return; }
    this.saveNow();
  };
  private saveNow(): void {
    if (this.state.pendingWrite) { this.update({ queuedSave: true }); this.status("后续保存已排队；前序回执到达后提交最新本地输入。"); return; }
    if ((this.state.operation || this.latestReceived.version > this.state.observed.version) && this.trySynchronizeBaseline()) { this.update({ queuedSave: true }); return; }
    if (this.historyReplays.length) { this.drainReviews(); return; }
    if (this.state.operation) { this.confirm(); return; }
    this.update({ queuedSave: false });
    if (this.state.queuedReviews.length) { this.drainReviews(); return; }
    if (!this.state.draft) { this.status("保存未写入：没有未保存内容。"); return; }
    try {
      const plan = planSave(this.state.observed, [this.state.draft], this.diff);
      if (conflictingParagraphs(plan).length) this.update({ operation: { kind: "save", plan }, choices: {}, message: "保存存在冲突，请在原位核对。" });
      else this.submit(plan, "save");
    } catch (reason) { this.error(reason); }
  }
  readonly review = (content: string, baseline: string): void => {
    this.checkpoint();
    const action = content === this.content && baseline !== this.baseline ? "Keep" : content !== this.content && baseline === this.baseline ? "Undo" : "审阅";
    this.port.recordAction?.("点击 " + action + "，记录所见版本 v" + this.state.observed.version);
    const intent: ReviewIntent = { source: this.viewSnapshot(), content, baseline,origin:this.state.draft??createDraft(this.state.observed,this.documentId,this.content), ...(this.activeHistory ? { history: this.activeHistory } : {}) };
    const same = (other: ReviewIntent | undefined) => other && other.content === content && other.baseline === baseline &&
      paragraph(other.source.saved, this.documentId).text === this.content && paragraph(other.source.baseline, this.documentId).text === this.baseline;
    if (!same(this.state.pendingWrite?.reviewIntent) && !this.state.queuedReviews.some(same)) {
      this.update({ queuedReviews: [...this.state.queuedReviews, intent], message: "审阅决定已保留，将在前序回执之后按顺序提交。" });
      this.port.recordAction?.("审阅决定已排队；当前队列 " + this.state.queuedReviews.length + " 项。");
    }
    this.drainReviews();
  };
  private reviewPlan(intent: ReviewIntent): SynchronizationPlan {
    return planSynchronization(intent.source, this.viewSnapshot(), this.documentId,
      { ...createDraft(intent.source, this.documentId, intent.content), editedBaseline: intent.baseline }, this.policy);
  }
  private drainReviews(): void {
    if (this.state.pendingWrite) return;
    if (this.drainHistory()) return;
    if (this.state.operation) return;
    const intent = this.state.queuedReviews[0];
    if (!intent) { if (this.state.queuedSave) this.save(); return; }
    try {
      const plan = this.reviewPlan(intent);
      if (conflictingParagraphs(plan.review).length) {
        this.update({ operation: { kind: "review", plan, intent }, choices: {}, message: "排队审阅与后续输入不兼容；双方已保留，请原位核对。" });
      } else this.sendReview(plan, intent, "review");
    } catch (reason) { this.error(reason); }
  }
  private sendReview(plan: SynchronizationPlan, intent: ReviewIntent, kind: "review" | "resolution"): void {
    const result = finishSynchronization(plan, plan.snapshot, this.state.choices);
    const content = result.draft?.value ?? paragraph(result.observed.saved, this.documentId).text;
    const baseline = result.draft?.editedBaseline ?? paragraph(result.observed.baseline, this.documentId).text;
    this.update({ queuedReviews: this.state.queuedReviews.slice(1) });
    this.queue(content, baseline, kind, intent);
  }
  readonly confirm = (): void => {
    const operation = this.state.operation;
    if (!operation) { this.status("确认未执行：当前没有待处理冲突。"); return; }
    if (this.state.pendingWrite) { this.status("确认已记录但未发送：前序回执未知，原请求内容不变。"); return; }
    try {
      if (operation.kind === "review") {
        this.sendReview(operation.plan, operation.intent, "resolution");
      } else if (operation.kind === "sync") {
        const result = finishSynchronization(operation.plan, this.latestReceived, this.state.choices);
        if (result.draft) this.submit(planSave(this.latestReceived, [result.draft], this.diff), "resolution");
        else {
          this.update({ observed: result.observed, draft: undefined, operation: undefined, choices: {}, message: "已采用收到的版本。" });
          this.drainReviews();
        }
      } else this.submit(operation.plan, "resolution");
    } catch (reason) { this.error(reason); }
  };
  private submit(plan: SavePlan, kind: PendingWrite["kind"]): void {
    const update = finishPlan(plan, this.state.choices)[0];
    if (update) this.queue(update.saved, update.baseline, kind);
  }
  private queue(content: string, baseline: string, kind: PendingWrite["kind"], reviewIntent?: ReviewIntent, historyReplay?: HistoryReplay): void {
    if (this.disposed) return;
    const commitBase = kind === "resolution" || kind === "history" || kind === "baseline" ? this.latestReceived : this.state.observed;
    const updates = changedUpdates(commitBase, [{ id: this.documentId, saved: content, baseline }]);
    if (!updates.length) {
      this.update({ operation: undefined, choices: {}, draft: this.state.draft?.base!==(this.state.draft?.syncBase??this.state.draft?.base)?this.state.draft:undefined });
      this.status("提交未写入：S、B 均没有需要发送的改动。"); this.drainReviews(); return;
    }
    const id = this.requestId(++this.sequence);
    const history = reviewIntent?.history ?? this.activeHistory;
    const historyCommit: HistoryCommit | undefined = history && kind !== "history" && kind !== "baseline" ? { before: commitBase,
      after: applyParagraphUpdates(commitBase, updates, commitBase.version + 1), applied: false } : undefined;
    if (historyCommit) history!.commits.push(historyCommit);
    const pending: PendingWrite = { id, kind, before: this.viewSnapshot(),input:this.state.draft??createDraft(this.state.observed,this.documentId,this.content), commitBase, updates, ...(reviewIntent ? { reviewIntent } : {}),
      ...(historyCommit ? { historyCommit } : {}), ...(historyReplay ? { historyReplay } : {}) };
    this.update({ pendingWrite: pending, message: `请求 ${this.sequence} 等待回执；可继续编辑或排队审阅。` });
    const send = () => {
      if (this.disposed) return;
      try {
        void this.port.commit({ id, expectedVersion: commitBase.version, base: commitBase, updates })
          .then(receipt => this.acknowledge(pending, receipt)).catch(reason => this.reject(pending, reason));
      } catch (reason) { this.reject(pending, reason); }
    };
    // Keep/Undo and history compensation also write S. Async stores get the
    // same checkpoint-before-submit ordering as an explicit save.
    const preserving = this.checkpoint();
    if (preserving) void preserving.then(send); else send();
  }
  private acknowledge(pending: PendingWrite, receipt: HbsCommitReceipt): void {
    if (this.disposed || this.state.pendingWrite?.id !== pending.id) return;
    if (receipt.requestId !== pending.id) throw new Error("MODEL_PROTOCOL_ERROR：回执身份与请求不一致。");
    // Use the immutable transmitted request, never later input in H, to
    // reconstruct the state confirmed by an ACK without document payload.
    const snapshot = applyParagraphUpdates(pending.commitBase, pending.updates, receipt.version);
    const newest = this.latestReceived.version > snapshot.version ? this.latestReceived : snapshot;
    this.latestReceived = newest;
    if (pending.historyCommit) { pending.historyCommit.applied = true; pending.historyCommit.after = snapshot; }
    if (pending.kind === "save") this.ownSave = snapshot;
    if (pending.kind === "baseline") {
      try {
        const draft = acknowledgedBaselineDraft(pending.input, this.state.draft, pending.commitBase, snapshot, this.content, this.baseline, this.diff);
        this.update({ pendingWrite: undefined, draft }, false);
        this.receive(newest, true);
        if (!this.state.pendingWrite && !this.state.operation) this.drainReviews();
      } catch (reason) { this.update({ pendingWrite: undefined }); this.error(reason); }
      return;
    }
    if (pending.historyReplay || this.historyView) {
      this.update({ observed: newest, pendingWrite: undefined });
      try {
        this.finishHistoryView();
        this.status(this.state.operation ? "撤销／重做的写入已确认，恢复的冲突可继续核对。" : "撤销／重做的写入已确认，内容与审阅状态已重新协调。");
        this.drainReviews();
      } catch (reason) { this.error(reason); }
      return;
    }
    try {
      const input = acknowledgedDraft(pending.input,this.state.draft,pending.before,pending.commitBase,snapshot,this.content,this.baseline,pending.reviewIntent,this.diff);
      if (newest.version > snapshot.version) {
        this.update({ pendingWrite: undefined, draft: input }, false);
        if (this.trySynchronizeBaseline()) return;
      }
      const plan = planSynchronization(pending.before, newest, this.documentId, input, this.policy);
      if (conflictingParagraphs(plan.review).length) {
        this.update({ pendingWrite: undefined }); this.installConflictingSynchronization(plan);
        this.status("写入已确认，相容更新已显示；后续输入的冲突请核对。");
      }
      else {
        const result = finishSynchronization(plan, newest);
        const dirty=result.draft&&(result.draft.value!==paragraph(newest.saved,this.documentId).text||result.draft.editedBaseline!==paragraph(newest.baseline,this.documentId).text);
        const hasCandidates = newest.saved.some(item => item.text !== paragraph(newest.baseline, item.id).text);
        this.update({ observed: result.observed, draft: result.draft, pendingWrite: undefined, operation: undefined, choices: {},
          message: dirty ? "回执已到达；发送之后的新输入仍未保存。" : hasCandidates ? "回执已到达；剩余候选仍待审。" : "回执已到达；S、B、H 已同步。" });
        this.drainReviews();
      }
    } catch (reason) { this.update({ pendingWrite: undefined }); this.error(reason); }
  }
  private reject(pending: PendingWrite, reason: unknown): void {
    if (this.disposed || this.state.pendingWrite?.id !== pending.id) return;
    this.update({ pendingWrite: undefined,
      queuedReviews: pending.reviewIntent ? [pending.reviewIntent, ...this.state.queuedReviews] : this.state.queuedReviews });
    if (pending.historyReplay) this.historyReplays.unshift({ ...pending.historyReplay, rejectedRequest: pending.id });
    if (reason instanceof HbsCommitError && reason.message.startsWith("MODEL_VERSION_CONFLICT")) {
      const snapshot = reason.snapshot.version >= this.latestReceived.version ? reason.snapshot : this.latestReceived;
      if (pending.historyReplay) { this.latestReceived = snapshot; this.drainReviews(); }
      else { this.receive(snapshot, true); if (pending.kind !== "baseline" && !this.state.operation) this.save(); }
    } else this.error(new Error(`${reason instanceof Error ? reason.message : String(reason)}（请求 ${pending.id}）`, { cause: reason }));
  }
}
