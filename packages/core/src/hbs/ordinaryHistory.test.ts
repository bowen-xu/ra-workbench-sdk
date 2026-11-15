import { describe, expect, it } from "vitest";
import { createNoteDocumentAdapter, createTextDocumentAdapter } from "./adapters";
import { DocumentVersionConflict, type DocumentCheckpoint, type DocumentCommit, type DocumentSnapshot, type HbsDocumentAdapter } from "./document";
import { HbsSession } from "./session";
import { noteBlockId, notePageId, type NoteDocumentV1 } from "../notes";

const calculate = (before: string, after: string) => before === after ? [] : [
  { fromA: 0, toA: before.length, fromB: 0, toB: after.length },
];

function ordinaryHistoryContracts<D>(name: string, adapter: HbsDocumentAdapter<D>, document: (text: string) => D): void {
  describe(name, () => {
    async function fixture() {
      let authority: DocumentSnapshot<D> = { version: 213, saved: document(""), baseline: document("") };
      let preserved: DocumentCheckpoint<D> | undefined;
      const requests: DocumentCommit<D>[] = [];
      const session = await HbsSession.open({
        adapter, requestId: sequence => `ordinary-${sequence}`,
        preservation: { load: () => preserved, save: checkpoint => { preserved = checkpoint; } },
        port: {
          read: async () => authority,
          commit: async request => {
            requests.push(request);
            if (request.expectedVersion !== authority.version) throw new DocumentVersionConflict(authority, request.id);
            authority = { version: authority.version + 1, saved: request.saved, baseline: request.baseline };
            return authority;
          },
        },
      });
      return { session, requests, get authority() { return authority; },
        external: (saved: D) => { authority = { ...authority, version: authority.version + 1, saved }; session.receive(authority); } };
    }

    it.each([false, true])("undoes an acknowledged ordinary edit without inventing incoming (native content: %s)", async nativeContent => {
      const f = await fixture();
      const entry = f.session.perform(() => f.session.edit(document("1")));
      expect(f.session.getSnapshot().changes).toHaveLength(0);
      await f.session.save();
      expect(f.authority).toEqual({ version: 214, saved: document("1"), baseline: document("1") });

      f.session.restore(entry, "before", nativeContent ? document("") : undefined);
      expect(f.session.getSnapshot().content).toEqual(document(""));
      expect(f.session.getSnapshot().baselineProjection).toEqual(document(""));
      expect(f.session.getSnapshot().changes).toHaveLength(0);
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      // The backend revision advances through a new checked save. History does
      // not roll it back and its old ACK is not an external editing branch.
      await f.session.save();
      expect(f.authority).toEqual({ version: 215, saved: document(""), baseline: document("") });

      f.session.restore(entry, "after", nativeContent ? document("1") : undefined);
      expect(f.session.getSnapshot().content).toEqual(document("1"));
      expect(f.session.getSnapshot().baselineProjection).toEqual(document("1"));
      expect(f.session.getSnapshot().changes).toHaveLength(0);
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      await f.session.save();
      expect(f.authority).toEqual({ version: 216, saved: document("1"), baseline: document("1") });
      expect(f.requests.map(request => request.expectedVersion)).toEqual([213, 214, 215]);
      f.session.dispose();
    });

    it("retains a real overlapping authority update when undoing its own acknowledged input", async () => {
      const f = await fixture();
      const entry = f.session.perform(() => f.session.edit(document("1")));
      await f.session.save();
      f.external(document("2"));
      f.session.restore(entry, "before", document(""));
      expect(f.session.getSnapshot().content).toEqual(document(""));
      expect(f.session.getSnapshot().baselineProjection).toEqual(document(""));
      expect(f.session.getSnapshot().conflicts).toHaveLength(1);
      await f.session.save();
      expect(f.requests).toHaveLength(1);
      expect(f.authority.saved).toEqual(document("2"));
      f.session.dispose();
    });

    it("replays every ordinary baseline delta in a grouped native undo", async () => {
      const f = await fixture();
      const entries = ["1", "12", "123"].map(text => f.session.perform(() => f.session.edit(document(text))));
      await f.session.save();
      for (const entry of [...entries].reverse()) f.session.restore(entry, "before");
      expect(f.session.getSnapshot().content).toEqual(document(""));
      expect(f.session.getSnapshot().baselineProjection).toEqual(document(""));
      expect(f.session.getSnapshot().changes).toHaveLength(0);
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      await f.session.save();
      expect(f.authority).toEqual({ version: 215, saved: document(""), baseline: document("") });
      for (const entry of entries) f.session.restore(entry, "after");
      expect(f.session.getSnapshot().content).toEqual(document("123"));
      expect(f.session.getSnapshot().baselineProjection).toEqual(document("123"));
      expect(f.session.getSnapshot().changes).toHaveLength(0);
      expect(f.session.getSnapshot().conflicts).toHaveLength(0);
      f.session.dispose();
    });
  });
}

ordinaryHistoryContracts("text ordinary native history", createTextDocumentAdapter(calculate), text => text);
ordinaryHistoryContracts("NoteDocument ordinary native history", createNoteDocumentAdapter(calculate), (text): NoteDocumentV1 => ({
  schemaVersion: 1, pageId: notePageId("ordinary-history"), blocks: [{
    id: noteBlockId("paragraph"), type: "paragraph", props: {}, children: [],
    content: { kind: "inline", items: [{ type: "text", text, styles: [] }] },
  }],
}));
