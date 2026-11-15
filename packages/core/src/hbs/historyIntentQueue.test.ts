import { describe, expect, it } from "vitest";
import { createNoteDocumentAdapter, createStructuredDocumentAdapter, createTextDocumentAdapter } from "./adapters";
import { DocumentVersionConflict, type DocumentCheckpoint, type DocumentCommit, type DocumentSnapshot, type HbsDocumentAdapter } from "./document";
import { HbsSession } from "./session";
import { noteBlockId, notePageId, type NoteDocumentV1 } from "../notes";

const calculate = (before: string, after: string) => before === after ? [] : [
  { fromA: 0, toA: before.length, fromB: 0, toB: after.length },
];
const settle = async () => { for (let index = 0; index < 120; index++) await Promise.resolve(); };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function historyQueueContracts<D>(name: string, adapter: HbsDocumentAdapter<D>, document: (text: string) => D) {
  describe(name, () => {
    async function fixture() {
      let authority: DocumentSnapshot<D> = { version: 0, saved: document("80"), baseline: document("80") };
      let checkpoint: DocumentCheckpoint<D> | undefined, held = false, loseReceipt = false;
      const requests: DocumentCommit<D>[] = [], releases: (() => void)[] = [];
      const receipts = new Map<string, DocumentSnapshot<D>>();
      const session = await HbsSession.open({ adapter, requestId: sequence => `queue-${sequence}`,
        preservation: { load: () => checkpoint, save: value => { checkpoint = value; } },
        port: { read: async () => authority, commit: async request => {
          requests.push(request);
          const previous = receipts.get(request.id); if (previous) return previous;
          if (held) await new Promise<void>(resolve => releases.push(resolve));
          if (request.expectedVersion !== authority.version) throw new DocumentVersionConflict(authority, request.id);
          authority = { version: authority.version + 1, saved: request.saved, baseline: request.baseline };
          receipts.set(request.id, authority);
          if (loseReceipt) { loseReceipt = false; throw new Error("lost receipt"); }
          return authority;
        } } });
      return { session, requests, get authority() { return authority; },
        external: async (text: string) => { authority = { ...authority, version: authority.version + 1, saved: document(text) }; await session.syncLatest(); await settle(); },
        replace: (saved: D, baseline: D, notify = true) => {
          authority = { version: authority.version + 1, saved, baseline }; if (notify) session.receive(authority);
        },
        loseReceipt: () => { loseReceipt = true; },
        hold: () => { held = true; }, release: async () => { held = false; releases.splice(0).forEach(resolve => resolve()); await settle(); } };
    }

    it("replaces unsent opposite replays of one command and finishes an explicit conflict Undo", async () => {
      const f = await fixture(); await f.external("90");
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      await f.external("95"); f.session.edit(document("91")); await f.external("96");
      expect(f.session.getSnapshot().conflicts).toHaveLength(1);
      f.session.restore(keep, "before"); f.session.restore(keep, "after"); f.session.restore(keep, "before");
      expect(f.session.getSnapshot().queued + Number(f.session.getSnapshot().pending)).toBe(1);
      await settle();
      const old = f.session.getSnapshot().baselineProjection;
      f.session.resolve(f.session.getSnapshot().conflicts[0]!.id, "undo"); await settle(); await f.session.save();
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      expect(f.session.getSnapshot().queued).toBe(0);
      expect(f.session.getSnapshot().pending).toBe(false);
      expect(f.session.getSnapshot().content).toEqual(old);
      expect(f.authority.saved).toEqual(old); expect(f.authority.baseline).toEqual(old);
      f.session.dispose();
    });

    it("keeps an admitted request immutable and sends only the final opposite target after its receipt", async () => {
      const f = await fixture(); await f.external("90"); f.hold();
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      const sent = clone(f.requests[0]);
      f.session.restore(keep, "before"); f.session.restore(keep, "after"); f.session.restore(keep, "before");
      expect(f.requests).toHaveLength(1); expect(f.requests[0]).toEqual(sent);
      await f.release();
      expect(f.requests).toHaveLength(2);
      expect(f.authority.saved).toEqual(document("90")); expect(f.authority.baseline).toEqual(document("80"));
      expect(f.session.getSnapshot().queued).toBe(0); expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      f.session.restore(keep, "after"); await settle();
      expect(f.authority.baseline).toEqual(document("90"));
      f.session.dispose();
    });

    it.each([1, 2, 3, 4, 5])("converges to the last native direction across %s held reversals", async count => {
      const f = await fixture(); await f.external("90");
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      f.hold(); f.session.restore(keep, "before"); await settle();
      const admitted = clone(f.requests.at(-1));
      for (let index = 1; index < count; index++) f.session.restore(keep, index % 2 ? "after" : "before");
      expect(f.requests.at(-1)).toEqual(admitted);
      expect(f.session.getSnapshot().queued).toBe(0);
      await f.release();
      expect(f.authority.saved).toEqual(document("90"));
      expect(f.authority.baseline).toEqual(document(count % 2 ? "80" : "90"));
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      expect(f.session.getSnapshot().queued).toBe(0); expect(f.session.getSnapshot().pending).toBe(false);
      f.session.dispose();
    });

    it("checks an unknown original request by the same identity before compensating the final target", async () => {
      const f = await fixture(); await f.external("90"); f.loseReceipt();
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      const admitted = clone(f.requests[0]);
      expect(f.session.getSnapshot().message).toContain("MODEL_RESULT_UNKNOWN");
      f.session.restore(keep, "before"); f.session.restore(keep, "after"); f.session.restore(keep, "before");
      await f.session.save(); await settle();
      expect(f.requests[1]).toEqual(admitted);
      expect(f.authority.baseline).toEqual(document("80")); expect(f.authority.saved).toEqual(document("90"));
      expect(f.session.getSnapshot().queued).toBe(0); expect(f.session.getSnapshot().pending).toBe(false);
      f.session.dispose();
    });

    it("records a no-write replay as applied so its later Redo still commits the opposite delta", async () => {
      const f = await fixture(); await f.external("90");
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      f.replace(document("90"), document("80")); await settle();
      const before = f.requests.length;
      f.session.restore(keep, "before"); await settle(); expect(f.requests).toHaveLength(before);
      f.session.restore(keep, "after"); await settle();
      expect(f.requests).toHaveLength(before + 1); expect(f.authority.baseline).toEqual(document("90"));
      expect(f.session.getSnapshot().queued).toBe(0); f.session.dispose();
    });

    it("rebases a refused compensation without rewinding a newer authoritative candidate", async () => {
      const f = await fixture(); await f.external("90");
      const keep = f.session.perform(() => f.session.resolve(f.session.getSnapshot().changes[0]!.id, "keep")); await settle();
      f.replace(document("96"), document("90"), false);
      f.session.restore(keep, "before"); await settle();
      expect(f.authority.saved).toEqual(document("96")); expect(f.authority.baseline).toEqual(document("80"));
      expect(f.session.getSnapshot().content).toEqual(document("96")); expect(f.session.getSnapshot().changes).toHaveLength(1);
      expect(f.session.getSnapshot().queued).toBe(0); expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      f.session.dispose();
    });

    it("does not reinstall a superseded replay origin when a history receipt arrives after an explicit Undo", async () => {
      const f = await fixture(); await f.external("85"); f.session.edit(document("91")); await f.external("90");
      const rejected = f.session.perform(() => f.session.resolve(f.session.getSnapshot().conflicts[0]!.id, "undo")); await settle();
      expect(f.authority.saved).toEqual(document("80"));
      f.hold(); f.session.restore(rejected, "before"); await settle();
      const sent = clone(f.requests.at(-1));
      expect(f.session.getSnapshot().pending).toBe(true);
      const selected = f.session.getSnapshot().conflicts[0] ?? f.session.getSnapshot().changes[0]!;
      f.session.perform(() => f.session.resolve(selected.id, "undo"));
      expect(f.requests.at(-1)).toEqual(sent);
      await f.release();
      expect(f.authority.saved).toEqual(document("80")); expect(f.authority.baseline).toEqual(document("80"));
      expect(f.session.getSnapshot().content).toEqual(document("80"));
      expect(f.session.getSnapshot().conflicts).toHaveLength(0); expect(f.session.getSnapshot().queued).toBe(0);
      expect(f.session.getSnapshot().pending).toBe(false); f.session.dispose();
    });

    it("reviews a real authority candidate before an older queued proposal without accepting either implicitly", async () => {
      const f = await fixture(); await f.external("85"); f.session.edit(document("91"));
      f.hold(); void f.session.save(); await settle();
      f.session.perform(() => f.session.review(document("80"), document("80")));
      f.session.edit(document("92"), document("80")); await f.release();
      expect(f.session.getSnapshot().conflicts[0]?.origin).toBe("review");
      await f.external("95");
      const incoming = f.session.getSnapshot().conflicts[0]!;
      expect(incoming.origin).not.toBe("review");
      f.session.resolve(incoming.id, "incoming");
      expect(f.session.getSnapshot().content).toEqual(document("95"));
      const queued = f.session.getSnapshot().conflicts[0]!;
      expect(queued.origin).toBe("review"); expect(queued.incoming).toBe("80");
      expect(f.authority.saved).toEqual(document("95")); expect(f.authority.baseline).toEqual(document("80"));
      f.session.resolve(queued.id, "incoming"); await f.session.save(); await settle();
      expect(f.authority.saved).toEqual(document("80")); expect(f.authority.baseline).toEqual(document("80"));
      expect(f.session.getSnapshot().conflicts).toHaveLength(0); expect(f.session.getSnapshot().queued).toBe(0);
      f.session.dispose();
    });
  });
}

historyQueueContracts("text review command queue", createTextDocumentAdapter(calculate), text => text);
historyQueueContracts("note review command queue", createNoteDocumentAdapter(calculate), (text): NoteDocumentV1 => ({
  schemaVersion: 1, pageId: notePageId("history-queue"), blocks: [{
    id: noteBlockId("score"), type: "paragraph", props: {}, children: [],
    content: { kind: "inline", items: [{ type: "text", text, styles: [] }] },
  }],
}));
historyQueueContracts("structured review command queue", createStructuredDocumentAdapter(calculate), text => ({ fields: [{ id: "score", value: text }] }));
