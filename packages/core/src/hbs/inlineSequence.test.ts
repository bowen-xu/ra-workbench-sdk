import { expect, it } from "vitest";
import { createNoteDocumentAdapter } from "./adapters";
import { noteBlockId, notePageId, type NoteDocumentV1, type NoteInlineContentV1 } from "../notes";

const calculate = (a: string, b: string) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }];
const adapter = createNoteDocumentAdapter(calculate);
const text = (value: string) => ({ type: "text" as const, text: value, styles: [] });
const formula = (source: string) => ({ type: "inlineFormula" as const, source });
const document = (items: readonly NoteInlineContentV1[]): NoteDocumentV1 => ({ schemaVersion: 1, pageId: notePageId("inline"),
  blocks: [{ id: noteBlockId("p"), type: "paragraph", props: {}, children: [], content: { kind: "inline", items } }] });
const base = document([text("行内公式："), formula("x^2")]);

it.each([false, true])("merges appended ordinary lines with an independent formula change in either direction: %s", reverse => {
  const local = document([text("行内公式："), formula("x^2"), text("\n3123\n123213")]);
  const incoming = document([text("行内公式："), formula("x^{106}")]);
  const result = adapter.merge(base, reverse ? incoming : local, reverse ? local : incoming);
  expect(result.conflicts).toHaveLength(0);
  expect(result.value).toEqual(document([text("行内公式："), formula("x^{106}"), text("\n3123\n123213")]));
});
it("maps an unchanged atom across an inserted inline unit without pairing by index", () => {
  const local = document([text("行内公式："), text("before"), formula("x^2")]);
  const incoming = document([text("行内公式："), formula("x^3")]);
  expect(adapter.merge(base, local, incoming)).toMatchObject({ conflicts: [], value: document([text("行内公式："), text("before"), formula("x^3")]) });
});
it("retains ordinary text projection when the existing new is an atomic formula", () => {
  const previous = document([text("行内公式："), formula("x^3")]);
  const next = document([text("行内公式："), formula("x^3"), text("\nordinary")]);
  const projection = adapter.projectManual(base, previous, next);
  expect(projection).toEqual(document([text("行内公式："), formula("x^2"), text("\nordinary")]));
  const changes = adapter.diff(projection, next);
  expect(changes).toHaveLength(1);
  expect(changes[0]!.before).toEqual(formula("x^2"));
  expect(changes[0]!.after).toEqual(formula("x^3"));
});
it("keeps incompatible edits to the same formula atomic instead of merging its source characters", () => {
  const local = document([text("行内公式："), formula("x^3")]);
  const incoming = document([text("行内公式："), formula("y^2")]);
  const result = adapter.merge(base, local, incoming);
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0]!.before).toEqual(formula("x^2"));
  expect(result.value).toEqual(local);
});
it("retains the complete branch for ambiguous repeated inline nodes and deletion versus editing", () => {
  const repeated = document([formula("x"), formula("x")]);
  const inserted = document([formula("x"), formula("x"), formula("x")]);
  const edited = document([formula("y"), formula("x")]);
  expect(adapter.merge(repeated, inserted, edited).conflicts.length).toBeGreaterThan(0);
  const result = adapter.merge(base, document([text("行内公式：")]), document([text("行内公式："), formula("x^3")]));
  expect(result.conflicts.length).toBeGreaterThan(0);
});
