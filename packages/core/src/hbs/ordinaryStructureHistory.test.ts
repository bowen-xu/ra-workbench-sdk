import { expect, it } from "vitest";
import { type NoteDocumentV1, noteBlockId, notePageId, type NoteBlockV1 } from "../notes";
import { createNoteDocumentAdapter } from "./adapters";
import type { DocumentCheckpoint, DocumentCommit, DocumentSnapshot } from "./document";
import { HbsSession, type HbsHistoryEntry } from "./session";

const calculate = (a: string, b: string) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }];
const adapter = createNoteDocumentAdapter(calculate);
const block = (id: string, text = id): NoteBlockV1 => ({
  id: noteBlockId(id), type: "paragraph", props: {}, children: [],
  content: { kind: "inline", items: text ? [{ type: "text", text, styles: [] }] : [] },
});
const document = (...blocks: NoteBlockV1[]): NoteDocumentV1 => ({ schemaVersion: 1, pageId: notePageId("ordinary-structure"), blocks });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const ids = (value: NoteDocumentV1) => value.blocks.map(item => item.id);
function assertOrdinary(session: HbsSession<NoteDocumentV1>, trace: readonly string[] = []): void {
  const state = session.getSnapshot();
  const context = `${trace.join("\n")}\n${JSON.stringify({ content: ids(state.content), baseline: ids(state.baselineProjection) })}`;
  expect(state.conflicts, context).toHaveLength(0);
  expect(state.changes, context).toHaveLength(0);
}
async function fixture(initial: NoteDocumentV1) {
  let saved: DocumentSnapshot<NoteDocumentV1> = { version: 1, saved: initial, baseline: initial };
  let checkpoint: DocumentCheckpoint<NoteDocumentV1> | undefined;
  const options = {
    adapter, requestId: (sequence: number) => `ordinary-structure-${sequence}`,
    preservation: { load: () => checkpoint, save: (value: DocumentCheckpoint<NoteDocumentV1>) => { checkpoint = clone(value); } },
    port: { read: async () => saved, commit: async (request: DocumentCommit<NoteDocumentV1>) => {
      expect(request.expectedVersion).toBe(saved.version);
      saved = { version: saved.version + 1, saved: request.saved, baseline: request.baseline }; return saved;
    } },
  };
  return { session: await HbsSession.open(options), options };
}

it.each([0, 1, 2, 3])("keeps ordinary insertion at position %s ordinary through save, Undo, Redo and recovery", async index => {
  const initial = document(block("a"), block("b"), block("c")), f = await fixture(initial);
  const inserted = { ...initial, blocks: [...initial.blocks] }; inserted.blocks.splice(index, 0, block("new", ""));
  const insertion = f.session.perform(() => f.session.edit(inserted));
  const typed = { ...inserted, blocks: [...inserted.blocks] }; typed.blocks[index] = block("new", "1");
  const typing = f.session.perform(() => f.session.edit(typed));
  await f.session.save();
  f.session.restore(typing, "before", inserted); assertOrdinary(f.session);
  await f.session.save();
  f.session.restore(insertion, "before", initial); assertOrdinary(f.session);
  f.session.restore(insertion, "after", inserted);
  f.session.restore(typing, "after", typed);
  await f.session.save(); assertOrdinary(f.session);
  f.session.dispose();
  const reopened = await HbsSession.open(f.options);
  assertOrdinary(reopened); reopened.dispose();
});

it("preserves the ordinary-input invariant across deterministic sequences without an external writer", async () => {
  let seed = 45324;
  const random = (max: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % max; };
  // Seed and trace are fixed so a failure supplies an exactly replayable order.
  for (let trial = 0; trial < 150; trial++) {
    const f = await fixture(document(block("a"), block("b"), block("c")));
    const history: HbsHistoryEntry<NoteDocumentV1>[] = [], redo: typeof history = [], trace: string[] = [];
    for (let step = 0; step < 35; step++) {
      const action = random(6), value = f.session.getSnapshot().content;
      const current = { ...value, blocks: [...value.blocks] };
      if (action < 3) {
        if (action === 0) {
          const at = random(current.blocks.length + 1), id = `new-${trial}-${step}`;
          trace.push(`insert ${id} at ${at}`); current.blocks.splice(at, 0, block(id, ""));
        } else if (action === 1) {
          const index = random(current.blocks.length), id = current.blocks[index]!.id;
          trace.push(`edit ${id}`); current.blocks[index] = block(id, `text-${step}`);
        } else {
          const from = random(current.blocks.length), to = random(current.blocks.length);
          trace.push(`move ${from}->${to}`); current.blocks.splice(to, 0, current.blocks.splice(from, 1)[0]!);
        }
        history.push(f.session.perform(() => f.session.edit(current))); redo.length = 0;
      } else if (action === 3 && history.length) {
        const entry = history.pop()!; trace.push("undo"); f.session.restore(entry, "before"); redo.push(entry);
      } else if (action === 4 && redo.length) {
        const entry = redo.pop()!; trace.push("redo"); f.session.restore(entry, "after"); history.push(entry);
      } else { trace.push("save"); await f.session.save(); }
      assertOrdinary(f.session, trace);
    }
    await f.session.preserve(); f.session.dispose();
    const reopened = await HbsSession.open(f.options);
    assertOrdinary(reopened, trace); reopened.dispose();
  }
});
