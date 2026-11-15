import { applyParagraphUpdates, applyTextPatch, changedUpdates, createTextPatch, HbsCommitError, paragraph,
  type HbsClientPort, type HbsCommitRequest, type HbsCommitReceipt, type HbsRepository, type HbsSnapshot, type HbsUnitUpdate, type TextDiff } from "@research-assistant/core/hbs";
import { decodeClientMessage, decodeServerMessage, type ServerMessage } from "./codec";

export type HbsWireEncoding = { readonly type: "snapshot" } | { readonly type: "patch"; readonly calculate: TextDiff };
export interface HbsWireChannel {
  request(wire: string): Promise<string>;
  subscribe?(listener: (wire: string) => void): () => void;
}
async function exchange(channel: HbsWireChannel, wire: string, requestId: string): Promise<ServerMessage> {
  try {
    const message = decodeServerMessage(await channel.request(wire));
    if (message.requestId !== requestId) throw new Error("MODEL_PROTOCOL_ERROR：回执身份与请求不一致。");
    return message;
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`${/^MODEL_[A-Z0-9_]+[:：]/u.test(message) ? "" : "MODEL_TRANSPORT_FAILED："}${message}（request ${requestId}）`, { cause: reason });
  }
}
export function encodeHbsCommit(request: HbsCommitRequest, encoding: HbsWireEncoding): string {
  if (request.expectedVersion !== request.base.version) throw new Error("MODEL_PATCH_BASE_MISMATCH：传输缺少匹配的起点。");
  if (encoding.type === "snapshot") return JSON.stringify({ type: "commit", id: request.id, expectedVersion: request.expectedVersion,
    encoding: "snapshot", snapshot: applyParagraphUpdates(request.base, request.updates, request.expectedVersion + 1) });
  const patches = request.updates.flatMap(update => {
    const saved = createTextPatch(paragraph(request.base.saved, update.id).text, update.saved, encoding.calculate);
    const baseline = createTextPatch(paragraph(request.base.baseline, update.id).text, update.baseline, encoding.calculate);
    return saved.length || baseline.length ? [{ id: update.id, ...(saved.length ? { saved } : {}), ...(baseline.length ? { baseline } : {}) }] : [];
  });
  return JSON.stringify({ type: "commit", id: request.id, expectedVersion: request.expectedVersion, encoding: "patch", patches });
}

/** Same authority contract for both encodings. Deduplication is session-local;
 * a production durable request journal belongs to the repository transaction. */
export class HbsWireAuthority {
  private readonly receipts = new Map<string, { readonly wire: string; readonly reply: string }>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly repository: HbsRepository) {}
  handle(wire: string): Promise<string> {
    const request = decodeClientMessage(wire);
    const execute = async () => {
      const previous = this.receipts.get(request.id);
      if (previous?.wire === wire) return previous.reply;
      let response: ServerMessage;
      try {
        if (previous) throw new Error("MODEL_REQUEST_ID_REUSED：同一请求身份不能改变内容。");
        const current = await this.repository.read();
        if (request.type === "commit") {
          if (current.version !== request.expectedVersion) throw new Error("MODEL_VERSION_CONFLICT：S 已更新，原选择没有写入。");
          let updates: readonly HbsUnitUpdate[];
          if (request.encoding === "patch") updates = request.patches.map(patch => ({ id: patch.id,
            saved: applyTextPatch(paragraph(current.saved, patch.id).text, patch.saved ?? []),
            baseline: applyTextPatch(paragraph(current.baseline, patch.id).text, patch.baseline ?? []) }));
          else {
            if (request.snapshot.version !== current.version + 1 || request.snapshot.saved.length !== current.saved.length ||
              current.saved.some(item => !request.snapshot.saved.some(next => next.id === item.id))) throw new Error("MODEL_PROTOCOL_ERROR：快照目标或修订号无效。");
            updates = changedUpdates(current, request.snapshot.saved.map(item => ({ id: item.id, saved: item.text, baseline: paragraph(request.snapshot.baseline, item.id).text })));
          }
          const committed = await this.repository.commit(request.expectedVersion, updates);
          response = { type: "receipt", requestId: request.id, version: committed.version };
        } else if (request.type === "sync" && request.knownVersion === current.version) response = { type: "unchanged", requestId: request.id, version: current.version };
        else response = { type: "snapshot", requestId: request.id, snapshot: current };
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        response = { type: "rejection", requestId: request.id, snapshot: await this.repository.read(),
          error: `${/^MODEL_[A-Z0-9_]+[:：]/u.test(message) ? "" : "MODEL_COMMIT_FAILED："}${message}（request ${request.id}）` };
      }
      const reply = JSON.stringify(response);
      if (!previous && request.type === "commit") this.receipts.set(request.id, { wire, reply });
      return reply;
    };
    const operation = this.tail.then(execute); this.tail = operation.catch(() => undefined); return operation;
  }
}

export class HbsWireClient implements HbsClientPort {
  private readonly listeners = new Set<(snapshot: HbsSnapshot) => void>();
  private readonly requests = new Map<string, string>();
  private sequence = 0;
  private disposed = false;
  get initialSnapshot(): HbsSnapshot { return this.snapshot; }
  private constructor(private readonly channel: HbsWireChannel, private snapshot: HbsSnapshot, private readonly encoding: HbsWireEncoding,
    private readonly unsubscribe: (() => void) | undefined) {}
  private receive(wire: string): void {
    const message = decodeServerMessage(wire);
    if (!this.disposed && message.type === "snapshot" && message.snapshot.version > this.snapshot.version) {
      this.snapshot = message.snapshot;
      this.listeners.forEach(listener => listener(message.snapshot));
    }
  }
  static async connect(channel: HbsWireChannel, encoding: HbsWireEncoding): Promise<HbsWireClient> {
    // Subscribe before the read so writes during the handshake cannot fall
    // between the initial snapshot and the live stream.
    const buffered: string[] = []; let forward: ((wire: string) => void) | undefined;
    const unsubscribe = channel.subscribe?.(wire => { if (forward) forward(wire); else buffered.push(wire); });
    try {
      const message = await exchange(channel, JSON.stringify({ type: "read", id: "connect" }), "connect");
      if (message.type !== "snapshot") throw new Error("MODEL_PROTOCOL_ERROR：初始连接没有快照。");
      const client = new HbsWireClient(channel, message.snapshot, encoding, unsubscribe);
      forward = wire => client.receive(wire); buffered.forEach(forward); return client;
    } catch (reason) { unsubscribe?.(); throw reason; }
  }
  subscribeSnapshots(listener: (snapshot: HbsSnapshot) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async syncLatest(knownVersion: number): Promise<HbsSnapshot | undefined> {
    const requestId = `sync-${++this.sequence}`;
    const message = await exchange(this.channel, JSON.stringify({ type: "sync", id: requestId, knownVersion }), requestId);
    if (message.type === "rejection") throw new HbsCommitError(message.error, message.snapshot);
    if (message.type === "snapshot") { if (message.snapshot.version > this.snapshot.version) this.snapshot = message.snapshot; return message.snapshot; }
    if (message.type !== "unchanged") throw new Error("MODEL_PROTOCOL_ERROR：同步响应无效。");
  }
  async commit(request: HbsCommitRequest): Promise<HbsCommitReceipt> {
    const wire = encodeHbsCommit(request, this.encoding), previous = this.requests.get(request.id);
    if (previous && previous !== wire) throw new Error("MODEL_REQUEST_ID_REUSED：请求不能改写。");
    this.requests.set(request.id, wire);
    const message = await exchange(this.channel, previous ?? wire, request.id);
    if (message.type === "rejection") throw new HbsCommitError(message.error, message.snapshot);
    if (message.type !== "receipt") throw new Error("MODEL_PROTOCOL_ERROR：保存没有返回回执。");
    const committed = applyParagraphUpdates(request.base, request.updates, message.version);
    if (committed.version > this.snapshot.version) this.snapshot = committed;
    return message;
  }
  dispose(): void { this.disposed = true; this.unsubscribe?.(); this.listeners.clear(); }
}
