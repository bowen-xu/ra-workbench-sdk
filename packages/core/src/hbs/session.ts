import { type DocumentChange, type DocumentCheckpoint, type DocumentConflict, type DocumentPort, type DocumentPreservation,
  type DocumentSnapshot, type HbsDocumentAdapter, DocumentVersionConflict } from "./document";
import { changeAt, containsPath, equalValue, valueAt } from "./structure/value";
import { coordinateDocument, reviewOrigin } from "./reconciliation";
import { consumeIntentRanges, intentConflicts, planIntent, projectIntentRanges, type HbsHistoryEntry, type HbsHistoryPoint, type Intent, type ReviewedRanges } from "./sessionIntent";
export type { HbsHistoryEntry, HbsHistoryPoint } from "./sessionIntent";

export interface HbsSessionState<D> {
  readonly observed: DocumentSnapshot<D>; readonly content: D; readonly baselineProjection: D;
  readonly ancestor: D; readonly reviewAncestor: D; readonly baselineAncestor: D;
  readonly conflicts: readonly DocumentConflict[]; readonly changes: readonly DocumentChange[];
  readonly preserved: D | undefined; readonly preservationError: string | undefined;
  readonly pending: boolean; readonly queued: number; readonly message: string; readonly events: readonly string[];
}
interface Pending<D> { readonly request: { readonly id: string; readonly expectedVersion: number; readonly saved: D; readonly baseline: D }; readonly before: DocumentSnapshot<D>; readonly reviewAncestor:D; readonly displayedBaseline: D; readonly intent?: Intent<D>; readonly baselineOnly?: boolean; unknown: boolean; superseded?: ReviewedRanges<D>[] }

/** Public options keep their types when private constructor details are erased
 * from a compiled package's declarations. This does not create a new owner. */
export interface HbsSessionOptions<D> {
  readonly adapter: HbsDocumentAdapter<D>;
  readonly port: DocumentPort<D>;
  readonly preservation: DocumentPreservation<D>;
  readonly requestId: (sequence: number) => string;
}

/** One resource session, regardless of document representation. Adapters own
 * structure; ports own persistence. No timers, UI framework or storage globals. */
export class HbsSession<D> {
  private state: HbsSessionState<D>;
  private readonly listeners = new Set<() => void>();
  private readonly queue: Intent<D>[] = [];
  private readonly committedDirections = new WeakMap<HbsHistoryEntry<D>, "before" | "after">();
  private pending: Pending<D> | undefined;
  private wantsSave = false;
  private disposed = false;
  private sequence = 0;
  private writes: Promise<void> = Promise.resolve();
  private preservationBlocked = false;
  private historyOwner: HbsHistoryEntry<D> | undefined;
  private blockedReview: Intent<D> | undefined;
  private ownSave:DocumentSnapshot<D>|undefined;
  private latestReceived: DocumentSnapshot<D>;
  readonly adapter: HbsDocumentAdapter<D>;
  private constructor(private readonly options: HbsSessionOptions<D>, snapshot: DocumentSnapshot<D>) {
    this.adapter = options.adapter;
    this.latestReceived = snapshot;
    this.state = { observed: snapshot, content: snapshot.saved, baselineProjection: snapshot.baseline, ancestor: snapshot.saved,reviewAncestor:snapshot.saved,
      baselineAncestor: snapshot.baseline, conflicts: [], changes: this.adapter.diff(snapshot.baseline, snapshot.saved),
      preserved: undefined, preservationError: undefined, pending: false, queued: 0, message: "已读取权威文档；保存不代表 Keep。", events: [] };
  }
  static async open<D>(options: HbsSessionOptions<D>): Promise<HbsSession<D>> {
    const snapshot = await options.port.read();
    options.adapter.decode(snapshot.saved); options.adapter.decode(snapshot.baseline);
    const session = new HbsSession(options, snapshot);
    try {
      const stored = await options.preservation.load();
      if (stored) {
        if (stored.format !== 1 || stored.kind !== options.adapter.kind) throw new Error("MODEL_RECOVERY_INVALID：恢复格式或类型不匹配。");
        let baseline = options.adapter.decode(stored.baselineAncestor);
        for (const change of stored.ordinary) baseline = options.adapter.apply(baseline, change, "after");
        session.state = { ...session.state, observed: stored.observed, content: options.adapter.decode(stored.content),
          baselineProjection: baseline, ancestor: options.adapter.decode(stored.ancestor),reviewAncestor:options.adapter.decode(stored.reviewAncestor===undefined?stored.ancestor:stored.reviewAncestor), baselineAncestor: options.adapter.decode(stored.baselineAncestor), preserved: stored.content };
        session.receive(snapshot, true, false); session.status("已从 S′ 恢复；待审和冲突重新计算，未自动接受。");
      } else await session.checkpoint();
    } catch (reason) { session.preservationBlocked = true; session.update({ preservationError: session.failure("MODEL_PRESERVATION_FAILED", reason) }); }
    return session;
  }
  readonly getSnapshot = (): HbsSessionState<D> => this.state;
  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose(): void { this.disposed = true; this.listeners.clear(); }
  /** Wait only for already requested preservation; does not save new input. */
  async flushPreservation(): Promise<void> { await this.writes; }
  /** Durably preserve current H without committing S/B or accepting review. */
  async preserve(): Promise<void> { await this.checkpoint(); }
  record(message: string): void { this.status(message); }
  private update(value: Partial<HbsSessionState<D>>): void {
    if (this.disposed) return;
    const next = { ...this.state, ...value };
    this.state = { ...next, changes: this.adapter.diff(next.baselineProjection, next.content), pending: !!this.pending, queued: this.queue.length + Number(this.wantsSave) };
    this.listeners.forEach(listener => listener());
  }
  private status(message: string): void { this.update({ message, events: [...this.state.events, message] }); }
  private failure(code: string, reason: unknown): string { return `${code}：${reason instanceof Error ? reason.message : String(reason)}`; }
  private point(): HbsHistoryPoint<D> {
    const { content, baselineProjection, ancestor, reviewAncestor,baselineAncestor } = this.state;
    return { content, baseline: baselineProjection, ancestor,reviewAncestor, baselineAncestor };
  }
  /** The editor stores this entry in its own history, including baseline-only
   * actions. This method does not introduce another undo stack. */
  perform(action: () => void): HbsHistoryEntry<D> {
    const entry: HbsHistoryEntry<D> = { before: this.point(), after: this.point(), committedBefore: this.state.observed };
    this.historyOwner = entry;
    try { action(); } finally { this.historyOwner = undefined; entry.after = entry.reviewTarget ?? this.point(); }
    return entry;
  }
  restore(entry: HbsHistoryEntry<D>, direction: "before" | "after", editedContent?: D): void {
    entry.replay = direction;
    if (this.pending?.intent?.owner === entry) delete this.pending.superseded;
    const target = entry[direction], source = entry[direction === "before" ? "after" : "before"];
    const baseline = this.adapter.merge(source.baseline, target.baseline, this.state.baselineProjection).value;
    const compensating = !!entry.committedAfter || this.pending?.intent?.owner === entry;
    // A normal save is not a history step. Its acknowledged S/B is the
    // comparison point for later Undo/Redo, not another writer's branch.
    const ownSave = this.ownSave && this.ownSave.version > entry.committedBefore.version ? this.ownSave : undefined;
    const targetOrigin = target.reviewAncestor === undefined ? target.ancestor : target.reviewAncestor;
    // Advance only acknowledged ordinary input. Saved candidate edits must
    // retain their review origin, while a later external S still conflicts.
    const reviewAncestor = !compensating && ownSave
      ? this.adapter.merge(entry.committedBefore.baseline, ownSave.baseline, targetOrigin).value : targetOrigin;
    this.update({ content: editedContent ?? this.adapter.merge(source.content,target.content,this.state.content).value,
      baselineProjection: direction === "after" && entry.reviewTarget ? this.state.baselineProjection : baseline,
      ancestor: compensating ? this.state.observed.saved : ownSave?.saved ?? target.ancestor,
      reviewAncestor,
      baselineAncestor: compensating ? this.state.observed.baseline : ownSave?.baseline ?? target.baselineAncestor });
    if (!compensating) this.receive(this.state.observed, true, false);
    else this.reconcileConflicts(false);
    if (entry.committedAfter) {
      this.queueHistory(entry, direction);
      this.reconcileConflicts(false);
      void this.drain();
    } else if (direction === "before") {
      entry.cancelled = this.queue.filter(intent => intent.owner === entry);
      for (let index = this.queue.length-1; index>=0; index--) if (this.queue[index]?.owner===entry) this.queue.splice(index,1);
      if(this.blockedReview?.owner===entry){this.blockedReview=undefined;this.reconcileConflicts(false);}
    } else if (entry.cancelled?.length) {
      this.queue.push(...entry.cancelled); entry.cancelled = []; void this.drain();
    }
    void this.checkpoint(); this.status(`${direction === "before" ? "撤销" : "重做"}：已按最新版本协调，修订号不会回退。`);
  }
  /** A native command owns one desired direction. An admitted request is
   * immutable; its receipt schedules at most the latest required opposite. */
  private queueHistory(entry: HbsHistoryEntry<D>, direction: "before" | "after", superseded: readonly ReviewedRanges<D>[] = []): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const intent = this.queue[index]!;
      if (intent.kind === "history" && intent.owner === entry) {
        this.queue.splice(index, 1); if (this.blockedReview === intent) this.blockedReview = undefined;
      }
    }
    if (!entry.committedAfter || this.pending?.intent?.owner === entry
      || (this.committedDirections.get(entry) ?? "after") === direction) return;
    const start = direction === "before" ? entry.committedAfter : entry.committedBefore;
    const end = direction === "before" ? entry.committedBefore : entry.committedAfter;
    const replay = entry[direction], origin = this.state.reviewAncestor;
    const scopes = [...this.adapter.diff(start.saved, end.saved), ...this.adapter.diff(start.baseline, end.baseline)];
    let intent: Intent<D> = { kind: "history", owner: entry, direction, source: start.saved, sourceBaseline: start.baseline,
      content: end.saved, baseline: end.baseline, replay, origin,
      targetOrigin: projectIntentRanges(this.adapter, origin, replay.reviewAncestor === undefined ? replay.ancestor : replay.reviewAncestor, scopes) };
    for (const range of superseded) intent = consumeIntentRanges(this.adapter, intent, range);
    if (this.hasIntentDelta(intent)) this.queue.push(intent);
  }
  edit(content: D, baseline?: D): void {
    try {
      const decoded = this.adapter.decode(content);
      const projection = baseline ?? this.adapter.projectManual(this.state.baselineProjection, this.state.content, decoded);
      // Input is already the user's chosen branch. Recalculate incoming without
      // replacing an undo result with clean remote text from an older ancestor.
      this.update({ content: decoded, baselineProjection: projection });
      this.reconcileConflicts(false); this.status("当前输入未保存；候选仍需 Keep。");
    } catch (reason) { this.status(this.failure("MODEL_EDIT_FAILED", reason)); }
  }
  /** Editors may provide a narrower native selection than a structural leaf.
   * The planned projections still pass through the same queue and authority. */
  review(content: D, baseline: D): void {
    const source = this.state.content, sourceBaseline = this.state.baselineProjection;
    content = this.adapter.decode(content); baseline = this.adapter.decode(baseline);
    const origin=this.state.reviewAncestor,targetOrigin=reviewOrigin(this.adapter,origin,source,content,sourceBaseline,baseline);
    this.queue.push({ kind: "review", source, sourceBaseline, content, baseline,
      origin,targetOrigin,
      ...(this.historyOwner ? { owner: this.historyOwner } : {}) });
    if (this.historyOwner) this.historyOwner.reviewTarget = { ...this.point(), content, baseline,reviewAncestor:targetOrigin };
    const keep = this.adapter.equal(content, source) && !this.adapter.equal(baseline, sourceBaseline);
    this.update({ content, ...(!keep ? { baselineProjection: baseline } : {}) });
    this.reconcileConflicts(false);
    void this.checkpoint(); void this.drain();
  }
  private reconcileConflicts(install = true): void {
    const merged = coordinateDocument(this.adapter,this.state.ancestor,this.state.reviewAncestor,this.state.content,this.state.observed);
    const baseline = this.adapter.merge(this.state.baselineAncestor, this.state.baselineProjection, this.state.observed.baseline);
    const baselineConflicts=baseline.conflicts.filter(change=>{
      const current=valueAt(merged.value,change.path),saved=valueAt(this.state.observed.saved,change.path),confirmed=valueAt(baseline.value,change.path);
      // Identical ordinary input and authoritative content need no extra
      // baseline decision merely because another reviewer advanced old B.
      return !(equalValue(current,saved) && equalValue(current,confirmed));
    });
    this.update({ ...(install ? { content: merged.value, baselineProjection: baseline.value,
      ancestor: merged.ancestor,reviewAncestor:merged.reviewAncestor, baselineAncestor: baseline.ancestor ?? this.state.baselineAncestor } : {}),
      conflicts: [...merged.conflicts, ...baselineConflicts.filter(change => !merged.conflicts.some(item =>
        containsPath(item.path, change.path) && (!item.text || !change.text || item.text.fromB <= change.text.fromB && item.text.toB >= change.text.toB))).map(change=>({...change,origin:"baseline" as const}))] });
    if(this.blockedReview){
      const intent=this.blockedReview;
      const proposed=intentConflicts(this.adapter,intent,this.state).filter(change=>!this.state.conflicts.some(authority=>{
        if(!containsPath(authority.path,change.path)&&!containsPath(change.path,authority.path))return false;
        if(!authority.text||!change.text||!this.adapter.textIncoming)return true;
        const a=this.adapter.textIncoming(authority,this.state.content,this.state.observed.baseline,this.state.observed.saved);
        const b=this.adapter.textIncoming(change,this.state.content,this.state.observed.baseline,this.state.observed.saved);
        return a.from<=b.to&&b.from<=a.to;
      }));
      // A newer authority update is reviewed first. Two incoming proposals
      // cannot occupy the same editable range; the old intent stays queued.
      this.update({conflicts:[...this.state.conflicts,...proposed.map(change=>({...change,origin:change.origin ?? "review" as const}))]});
    }
  }
  receive(snapshot: DocumentSnapshot<D>, force = false, alignBaseline = true): void {
    if (this.disposed || snapshot.version < this.latestReceived.version || snapshot.version === this.latestReceived.version && !force) return;
    this.adapter.decode(snapshot.saved); this.adapter.decode(snapshot.baseline);
    this.latestReceived = snapshot;
    if (this.pending && (this.pending.baselineOnly || this.pending.intent || !this.adapter.equal(this.state.baselineAncestor,this.state.baselineProjection))) {
      this.status("已记录最新 S；等待前序回执，再同步普通 B/B′ 差量并按原规则协调。"); return;
    }
    if (alignBaseline && this.synchronizeBaseline()) return;
    this.update({ observed: snapshot }); this.reconcileConflicts();
    if (!this.state.conflicts.length) this.update({ baselineAncestor: snapshot.baseline });
    void this.checkpoint(); this.status(this.state.conflicts.length ? "收到更新：保留 current 与 incoming，请原位核对。" : "收到更新：已保留本地输入，未自动接受候选。");
  }
  async syncLatest(): Promise<void> {
    try { const snapshot = await this.options.port.read();
      if (snapshot.version > this.latestReceived.version) this.receive(snapshot); else this.synchronizeBaseline(); }
    catch (reason) { this.status(this.failure("MODEL_SYNC_FAILED", reason)); }
  }
  /** B′ is the ordinary projection of B. Commit only that delta, preserving
   * overlapping S and all human candidate edits, before normal reconciliation. */
  private synchronizeBaseline(): boolean {
    if (this.pending || this.blockedReview?.kind === "history" || this.queue.some(intent => intent.kind === "history")) return false;
    const { baselineAncestor, baselineProjection } = this.state, latest = this.latestReceived;
    if (this.adapter.equal(baselineAncestor,baselineProjection)) return false;
    const confirmed = this.adapter.merge(baselineAncestor,baselineProjection,latest.baseline);
    if (confirmed.conflicts.length || this.adapter.equal(confirmed.value,latest.baseline)) return false;
    // Local wins only on this transport merge: the local side is actual S,
    // not H. Disjoint ordinary changes reach S without replacing new S.
    const saved = this.adapter.merge(baselineAncestor,latest.saved,baselineProjection).value;
    const pending: Pending<D> = { request: { id: this.options.requestId(++this.sequence), expectedVersion: latest.version, saved, baseline: confirmed.value },
      before: latest, reviewAncestor: this.state.reviewAncestor, displayedBaseline: baselineProjection, baselineOnly: true, unknown: false };
    this.pending = pending;
    this.status("先同步普通 B′ 差量；等待真实回执，再按原有 S/B/H 规则协调。");
    void this.checkpoint().then(async () => {
      if (this.disposed || this.pending !== pending) return;
      if (this.state.preservationError) { this.pending = undefined; this.status(this.state.preservationError); return; }
      await this.send(pending);
    });
    return true;
  }
  resolve(id: string, action: "incoming" | "both" | "keep" | "undo"): void {
    this.resolveMany([id], action);
  }
  resolveMany(ids: readonly string[], action: "incoming" | "both" | "keep" | "undo", selection?: { readonly content: D; readonly baseline: D }): void {
    try {
      const selected = ids.map(id => {
        const item = this.state.conflicts.find(item=>item.id===id) ?? this.state.changes.find(item=>item.id===id);
        if(!item) throw new Error("MODEL_RANGE_CHANGED：变更已更新，请重新选择。"); return item;
      });
      const conflicts = selected.filter((item): item is DocumentConflict => "incoming" in item);
      for (const conflict of conflicts) {
        if(this.adapter.resolveConflict){
          // A structural ordinary edit can conflict simultaneously in S and B.
          // The S conflict masks the same B conflict in the UI; resolving it
          // must advance that B ancestor too, without accepting candidate edits.
          const baselineConflicts=this.adapter.merge(this.state.baselineAncestor,this.state.baselineProjection,this.state.observed.baseline).conflicts;
          const sameOrdinaryConflict=!conflict.text && conflict.origin!=="review" && baselineConflicts.some(item=>
            !item.text && item.path.length===conflict.path.length && containsPath(item.path,conflict.path))
            && equalValue(valueAt(this.state.content,conflict.path),valueAt(this.state.baselineProjection,conflict.path))
            && equalValue(valueAt(this.state.observed.saved,conflict.path),valueAt(this.state.observed.baseline,conflict.path));
          const context={content:this.state.content,baseline:this.state.baselineProjection,ancestor:this.state.reviewAncestor,
            baselineAncestor:this.state.baselineAncestor,confirmed:this.state.observed.baseline,saved:this.state.observed.saved};
          const result=this.adapter.resolveConflict(context,conflict,action);
          const physical=this.adapter.resolveConflict({...context,ancestor:this.state.ancestor},conflict,action);
          const confirmed=valueAt(this.state.observed.baseline,conflict.path);
          const advance=(value:D)=>this.adapter.apply(value,changeAt(conflict.path,valueAt(value,conflict.path),confirmed,conflict.kind),"after");
          this.update({content:result.content,baselineProjection:sameOrdinaryConflict && action==="incoming" ? advance(result.baseline) : result.baseline,
            ancestor:physical.ancestor,reviewAncestor:result.ancestor,baselineAncestor:sameOrdinaryConflict ? advance(result.baselineAncestor) : result.baselineAncestor});
          continue;
        }
        const chosen = action === "incoming" ? conflict.incoming : action === "both" ? this.adapter.combine(conflict) : action === "undo"
          ? valueAt(this.state.baselineProjection, conflict.path) : valueAt(this.state.content, conflict.path);
        const current = valueAt(this.state.content, conflict.path);
        const replacement = changeAt(conflict.path, current, chosen, conflict.kind);
        const ancestor = this.adapter.apply(this.state.ancestor, changeAt(conflict.path, valueAt(this.state.ancestor, conflict.path), conflict.incoming, conflict.kind), "after");
        const baselineProjection = action === "incoming" && conflict.origin === "baseline" ? this.adapter.apply(this.state.baselineProjection,
          changeAt(conflict.path, valueAt(this.state.baselineProjection, conflict.path), valueAt(this.state.observed.baseline, conflict.path), conflict.kind), "after") : this.state.baselineProjection;
        const reviewAncestor=this.adapter.apply(this.state.reviewAncestor,changeAt(conflict.path,valueAt(this.state.reviewAncestor,conflict.path),conflict.incoming,conflict.kind),"after");
        this.update({ content: this.adapter.apply(this.state.content, replacement, "after"), ancestor,reviewAncestor, baselineProjection });
      }
      if (selection && conflicts.length) this.update({content:this.adapter.decode(selection.content)});
      this.reconcileConflicts(false);
      if (action === "incoming" || action === "both") {
        if(!conflicts.length) throw new Error("MODEL_NO_INCOMING：当前单元没有 incoming。");
        // Selecting the real S/B branch does not dismiss an older queued
        // proposal hidden beneath it. Only its own proposal ranges are spent.
        this.consumeRanges(conflicts.filter(conflict => conflict.origin === "review"), this.state.content, this.state.baselineProjection);
        this.reconcileConflicts(false);
        void this.checkpoint(); void this.drain(); this.status("已选择候选；保存不推进 B，仍需 Keep。"); return;
      }
      const changes = conflicts.length ? this.adapter.diff(this.state.baselineProjection, this.state.content).filter(change =>
        selected.some(item => {
          if(!containsPath(item.path,change.path) && !containsPath(change.path,item.path))return false;
          if("incoming" in item && item.text && change.text && this.adapter.textIncoming){
            const range=this.adapter.textIncoming(item as DocumentConflict,this.state.content,this.state.observed.baseline,this.state.observed.saved);
            return change.text.fromB===change.text.toB ? range.from<=change.text.fromB && change.text.fromB<=range.to
              : change.text.fromB<range.to && range.from<change.text.toB;
          }
          return true;
        })) : selected;
      let content = this.state.content, baseline = this.state.baselineProjection;
      for (const change of selection ? [] : changes) {
        if (action === "keep") baseline = this.adapter.apply(baseline, change, "after");
        else content = this.adapter.apply(content, change, "before");
      }
      if(selection){content=this.adapter.decode(selection.content);baseline=this.adapter.decode(selection.baseline);}
      this.consumeRanges(selected, content, baseline);
      this.review(content, baseline);
    } catch (reason) { this.status(this.failure("MODEL_REVIEW_FAILED", reason)); }
  }
  private consumeRanges(selected: readonly DocumentChange[], content: D, baseline: D): void {
    const range = { selected, point: { ...this.point(), content, baseline } };
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const old = this.queue[index]!, next = consumeIntentRanges(this.adapter, old, range), remaining = this.hasIntentDelta(next);
      if (remaining) this.queue[index] = next; else this.queue.splice(index, 1);
      if (this.blockedReview === old) this.blockedReview = remaining ? next : undefined;
    }
    if (this.pending?.intent?.owner) (this.pending.superseded ??= []).push(range);
  }
  private hasIntentDelta(intent: Intent<D>): boolean {
    return !this.adapter.equal(intent.source, intent.content) || !this.adapter.equal(intent.sourceBaseline, intent.baseline);
  }
  async save(): Promise<void> {
    await this.checkpoint();
    if (this.state.preservationError) { this.status(this.state.preservationError); return; }
    this.wantsSave = true;
    if (this.pending?.unknown) { await this.send(this.pending); return; }
    await this.drain();
  }
  private async drain(): Promise<void> {
    if (this.disposed || this.pending) { this.update({}); return; }
    if(!this.queue.length&&!this.wantsSave)return;
    if ((this.latestReceived.version > this.state.observed.version || this.state.conflicts.length) && this.synchronizeBaseline()) return;
    if (this.state.conflicts.length) { this.status("MODEL_UNRESOLVED：输入已保全；尚有冲突，提交意图保留。 "); return; }
    const intent = this.queue.shift();
    if (!intent && !this.wantsSave) return;
    let content = this.state.content, baseline = this.state.baselineProjection;
    if (intent) {
      // A history compensation restores an S/B delta while H may deliberately
      // restore a different, still-conflicted human branch. As in the reference
      // planHistoryReplay, rebase the write against current authority, not H.
      const { content: left, baseline: right } = planIntent(this.adapter, intent, this.state);
      if (left.conflicts.length || right.conflicts.length) { this.queue.unshift(intent); this.blockedReview=intent; this.reconcileConflicts(false); this.status("MODEL_REVIEW_CONFLICT：排队决定与后续输入冲突，输入已保留。"); return; }
      this.blockedReview=undefined;
      content = left.value; baseline = right.value;
    } else this.wantsSave = false;
    const { observed } = this.state;
    if (this.adapter.equal(observed.saved, content) && this.adapter.equal(observed.baseline, baseline)) {
      if (intent?.owner && intent.direction) this.committedDirections.set(intent.owner, intent.direction);
      this.status("没有需要写入的变化。"); await this.drain(); return;
    }
    const pending: Pending<D> = { request: { id: this.options.requestId(++this.sequence), expectedVersion: observed.version, saved: content, baseline }, before: observed,reviewAncestor:this.state.reviewAncestor, displayedBaseline: this.state.baselineProjection, ...(intent ? { intent } : {}), unknown: false };
    this.pending = pending; this.update({});
    await this.checkpoint();
    if (this.state.preservationError) {
      this.pending = undefined;
      if (intent) this.queue.unshift(intent); else this.wantsSave = true;
      this.status(this.state.preservationError); return;
    }
    if (!this.disposed) await this.send(pending);
  }
  private async send(pending: Pending<D>): Promise<void> {
    try {
      const receipt = await this.options.port.commit(pending.request);
      if (this.disposed || this.pending !== pending) return;
      if (receipt.version !== pending.request.expectedVersion + 1) throw new Error("MODEL_PROTOCOL_ERROR：回执修订号不匹配。");
      this.pending = undefined;
      const newest=receipt.version>=this.latestReceived.version?receipt:this.latestReceived;
      this.latestReceived = newest;
      if (pending.baselineOnly) {
        // Rebase only the immutable acknowledged ordinary delta, never later
        // input or candidate H, into the existing comparison contexts.
        const align = (value: D) => this.adapter.merge(pending.before.baseline,receipt.baseline,value).value;
        this.update({ ancestor: align(this.state.ancestor), reviewAncestor: align(this.state.reviewAncestor), baselineAncestor: align(this.state.baselineAncestor) });
        this.ownSave = receipt;
        this.receive(newest,true);
        if (!this.pending) { await this.checkpoint(); await this.drain(); }
        return;
      }
      if (pending.intent?.owner && pending.intent.kind === "review") {
        if(!pending.intent.owner.committedAfter) pending.intent.owner.committedBefore = pending.before;
        pending.intent.owner.committedAfter = receipt;
        this.committedDirections.set(pending.intent.owner, "after");
      }
      if (pending.intent?.owner && pending.intent.direction) this.committedDirections.set(pending.intent.owner, pending.intent.direction);
      const content = this.adapter.merge(pending.request.saved, this.state.content, receipt.saved);
      const baseline = this.adapter.merge(pending.displayedBaseline, this.state.baselineProjection, receipt.baseline);
      // A later explicit range decision cannot rewrite this request, but it
      // consumes its obsolete display/provenance projection at the ACK.
      const projectionIntent = pending.intent && (pending.superseded ?? []).reduce(
        (intent, ranges) => consumeIntentRanges(this.adapter, intent, ranges), pending.intent);
      const proposedOrigin=projectionIntent?.targetOrigin===undefined?reviewOrigin(this.adapter,pending.reviewAncestor,pending.before.saved,pending.before.saved,pending.before.baseline,receipt.baseline):projectionIntent.targetOrigin;
      const targetOrigin=this.adapter.retainReviewOrigin?this.adapter.retainReviewOrigin(proposedOrigin,receipt.saved,receipt.baseline):proposedOrigin;
      const reviewAncestor=this.adapter.merge(projectionIntent?.origin===undefined?pending.reviewAncestor:projectionIntent.origin,this.state.reviewAncestor,targetOrigin).value;
      this.update({ observed:receipt, content:content.value, baselineProjection:baseline.value,
        ancestor:receipt.saved,reviewAncestor,baselineAncestor:baseline.ancestor??receipt.baseline,conflicts:[] });
      if(!pending.intent)this.ownSave=receipt;
      if (projectionIntent?.replay) {
        const intent = projectionIntent, replay = intent.replay!;
        const scopes = [...this.adapter.diff(intent.source, intent.content), ...this.adapter.diff(intent.sourceBaseline, intent.baseline)];
        const project = (current: D, target: D) => projectIntentRanges(this.adapter, current, target, scopes);
        this.update({ ancestor: project(this.state.ancestor, replay.ancestor),
          reviewAncestor: project(this.state.reviewAncestor, replay.reviewAncestor === undefined ? replay.ancestor : replay.reviewAncestor),
          baselineAncestor: project(this.state.baselineAncestor, replay.baselineAncestor) });
      }
      if (newest.version > receipt.version) this.receive(newest,true); else this.reconcileConflicts();
      const owner = pending.intent?.owner;
      if (owner?.replay) this.queueHistory(owner, owner.replay, pending.superseded);
      await this.checkpoint(); this.status(`请求 ${pending.request.id} 已确认 v${receipt.version}；后续输入继续保留。`); await this.drain();
    } catch (reason) {
      if (this.disposed || this.pending !== pending) return;
      if (reason instanceof DocumentVersionConflict) {
        if(pending.intent)this.queue.unshift(pending.intent);
        this.pending = undefined; this.receive(reason.snapshot,true); if (!pending.baselineOnly) this.wantsSave = true;
        this.status(reason.message); if (!this.state.conflicts.length) await this.drain();
      } else { pending.unknown = true; this.status(`${this.failure("MODEL_RESULT_UNKNOWN", reason)}（请求 ${pending.request.id}）；保存可核对同一请求。`); }
    }
  }
  private checkpoint(): Promise<void> {
    if (this.disposed || this.preservationBlocked) return Promise.resolve();
    const value: DocumentCheckpoint<D> = { format: 1, kind: this.adapter.kind, observed: this.state.observed,
      ancestor: this.state.ancestor,reviewAncestor:this.state.reviewAncestor, baselineAncestor: this.state.baselineAncestor, content: this.state.content,
      ordinary: this.adapter.diff(this.state.baselineAncestor, this.state.baselineProjection) };
    this.writes = this.writes.then(async () => {
      if (this.disposed) return;
      try { await this.options.preservation.save(value); this.update({ preserved: value.content, preservationError: undefined }); }
      catch (reason) { this.update({ preservationError: this.failure("MODEL_PRESERVATION_FAILED", reason) }); }
    }); return this.writes;
  }
}
