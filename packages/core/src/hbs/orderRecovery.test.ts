import { expect, it } from "vitest";
import { createNoteDocumentAdapter, createStructuredDocumentAdapter } from "./adapters";
import { HbsSession } from "./session";
import type { DocumentCheckpoint, DocumentSnapshot } from "./document";
import { noteBlockId, notePageId, type NoteDocumentV1 } from "../notes";

const adapter = createNoteDocumentAdapter((a, b) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }]);
const document = (order: readonly string[], text = "1"): NoteDocumentV1 => ({
  schemaVersion: 1, pageId: notePageId("order-recovery"), blocks: order.map(id => ({
    id: noteBlockId(id), type: "paragraph", props: {}, children: [],
    content: { kind: "inline", items: text === "" && id === "input" ? [] : [{ type: "text", text: id === "input" ? text : id, styles: [] }] },
  })),
});
const old = document(["title", "formula", "tail", "input"]);
const saved = document(["title", "formula", "input", "tail"]);
const edited = document(["title", "formula", "input", "tail"], "");
const nested = (parents: readonly string[], children: readonly string[]): NoteDocumentV1 => {
  const value = document(parents);
  return { ...value, blocks: value.blocks.map(block => block.id === "title"
    ? { ...block, children: document(children).blocks } : block) };
};

it("coordinates independent parent and child keyed permutations in either direction", () => {
  const base = nested(["title", "input"], ["c1", "c2", "c3"]);
  const local = nested(["title", "input"], ["c3", "c1", "c2"]);
  const incoming = nested(["input", "title"], ["c1", "c2", "c3"]);
  const expected = nested(["input", "title"], ["c3", "c1", "c2"]);
  for (const [left, right] of [[local, incoming], [incoming, local]] as const) {
    const merged = adapter.merge(base, left, right);
    expect(merged.conflicts).toEqual([]);
    expect(merged.value).toEqual(expected);
  }
});

it("does not let a nested permutation compete with an identical parent permutation", () => {
  const base = nested(["title", "input"], ["c1", "c2", "c3"]);
  const local = nested(["input", "title"], ["c3", "c1", "c2"]);
  const incoming = nested(["input", "title"], ["c1", "c2", "c3"]);
  for (const [left, right] of [[local, incoming], [incoming, local]] as const) {
    const merged = adapter.merge(base, left, right);
    expect(merged.conflicts).toEqual([]);
    expect(merged.value).toEqual(local);
  }
});

it("retains a real nested member conflict independently of compatible parent permutations", () => {
  const base = nested(["title", "input"], ["c1", "c2", "c3"]);
  const moved = nested(["input", "title"], ["c1", "c2", "c3"]);
  const editChild = (text: string): NoteDocumentV1 => ({ ...moved, blocks: moved.blocks.map(block => ({ ...block,
    children: block.children.map(child => child.id === "c1"
      ? { ...child, content: { kind: "inline", items: [{ type: "text", text, styles: [] }] } } : child) })) });
  const merged = adapter.merge(base, editChild("mine"), editChild("theirs"));
  expect(merged.conflicts).toHaveLength(1);
  expect(merged.conflicts[0]?.path).toEqual(["blocks", { key: "id", value: "title" }, "children",
    { key: "id", value: "c1" }, "content", "items", 0, "text"]);
});

it("does not exchange deleting an ancestor with reordering its surviving children", () => {
  const base = nested(["title", "input"], ["c1", "c2", "c3"]);
  const deleted = document(["input"]);
  const reordered = nested(["title", "input"], ["c3", "c1", "c2"]);
  for (const [left, right] of [[deleted, reordered], [reordered, deleted]] as const) {
    const merged = adapter.merge(base, left, right);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.path).toEqual(["blocks", { key: "id", value: "title" }]);
    expect(merged.value).toEqual(left);
  }
});

it("uses independent keyed order axes for structured fields and nested statements", () => {
  const structured = createStructuredDocumentAdapter((a, b) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }]);
  const value = (fields: readonly string[], statements: readonly string[], text = "old") => ({
    fields: fields.map(field => ({ field, statements: statements.map(id => ({ id, text: id === "s1" ? text : id })) })),
  });
  const base = value(["a", "b"], ["s1", "s2"]);
  const local = value(["a", "b"], ["s2", "s1"], "mine");
  const incoming = value(["b", "a"], ["s1", "s2"]);
  const expected = value(["b", "a"], ["s2", "s1"], "mine");
  for (const [left, right] of [[local, incoming], [incoming, local]] as const) {
    const merged = structured.merge(base, left, right);
    expect(merged.conflicts).toEqual([]);
    expect(merged.value).toEqual(expected);
  }
});

it("keeps replacing a structured ancestor incompatible with its nested permutation", () => {
  const structured = createStructuredDocumentAdapter((a, b) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }]);
  const base = { field: { statements: [{ id: "a" }, { id: "b" }] } };
  const replacement = { field: null };
  const reordered = { field: { statements: [{ id: "b" }, { id: "a" }] } };
  for (const [left, right] of [[replacement, reordered], [reordered, replacement]] as const) {
    const merged = structured.merge(base, left, right);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts[0]?.path).toEqual(["field"]);
    expect(merged.value).toEqual(left);
  }
});

it("round trips a member edit and stable-ID move without reviving the old member body", () => {
  let result = old;
  const changes = adapter.diff(old, edited);
  expect(changes.map(change => change.kind)).toContain("order");
  for (const change of changes) result = adapter.apply(result, change, "after");
  expect(result).toEqual(edited);
  for (const change of [...changes].reverse()) result = adapter.apply(result, change, "before");
  expect(result).toEqual(old);
});

it("merges equal stable-ID permutations independently from a member body edit", () => {
  const merged = adapter.merge(old, edited, saved);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value).toEqual(edited);
  const reverse = adapter.merge(old, saved, edited);
  expect(reverse.conflicts).toEqual([]);
  expect(reverse.value).toEqual(edited);
});

it("keeps genuinely competing permutations as conflicts", () => {
  const other = document(["input", "title", "formula", "tail"]);
  expect(adapter.merge(old, edited, other).conflicts).toHaveLength(1);
});

it("does not hide member conflicts when both branches choose the same order", () => {
  const left = document(["title", "formula", "input", "tail"], "mine");
  const right = document(["title", "formula", "input", "tail"], "theirs");
  const merged = adapter.merge(old, left, right);
  expect(merged.conflicts.length).toBeGreaterThan(0);
  expect(merged.conflicts.every(change => change.kind !== "order")).toBe(true);
});

it("combines compatible member edits without treating their shared permutation as another edit", () => {
  const right: NoteDocumentV1 = { ...saved, blocks: saved.blocks.map(block => block.id === "tail"
    ? { ...block, props: { textAlignment: "center" } } : block) };
  const expected: NoteDocumentV1 = { ...edited, blocks: edited.blocks.map(block => block.id === "tail"
    ? { ...block, props: { textAlignment: "center" } } : block) };
  const merged = adapter.merge(old, edited, right);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value).toEqual(expected);
});

it("does not equate permutations that also have different surviving identities", () => {
  const withoutTail = document(["title", "input", "formula"]);
  expect(adapter.merge(old, edited, withoutTail).conflicts.length).toBeGreaterThan(0);
});

it("recovers an ordinary member edit against the same acknowledged permutation without a false conflict or write", async () => {
  const snapshot: DocumentSnapshot<NoteDocumentV1> = { version: 4, saved, baseline: saved };
  const checkpoint: DocumentCheckpoint<NoteDocumentV1> = {
    format: 1, kind: "note", observed: snapshot, ancestor: saved,
    baselineAncestor: old, content: edited, ordinary: adapter.diff(old, edited),
  };
  let commits = 0;
  const session = await HbsSession.open({
    adapter, requestId: n => `recovery-${n}`,
    preservation: { load: () => checkpoint, save: () => {} },
    port: { read: async () => snapshot, commit: async () => { commits++; throw new Error("unexpected write during open"); } },
  });
  expect(session.getSnapshot().preservationError).toBeUndefined();
  expect(session.getSnapshot().content).toEqual(edited);
  expect(session.getSnapshot().baselineProjection).toEqual(edited);
  expect(session.getSnapshot().conflicts).toEqual([]);
  expect(session.getSnapshot().changes).toEqual([]);
  expect(commits).toBe(0);
  session.dispose();
});
