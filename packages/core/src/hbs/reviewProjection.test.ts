import { expect, it } from "vitest";
import type { DocumentChange, DocumentPath } from "./document";
import { projectDocumentReview } from "./reviewProjection";
import { createNoteDocumentAdapter } from "./adapters";
import { type NoteBlockV1, type NoteDocumentV1, noteBlockId, notePageId } from "../notes";

const unit = (id: string, text = id) => ({ id, text });
const change = (before: unknown, after: unknown, kind: DocumentChange["kind"] = "node", path: DocumentPath = ["blocks"]): DocumentChange => ({
  id: "original-decision", beforePath: path, path, kind, before, after,
});

it("projects the preview's last-block move without marking shifted members as changed", () => {
  const before = ["title", "score", "method", "table", "formula", "inline", "card", "next"].map(id => unit(id));
  const after = [before[0], before[7], ...before.slice(1, 7)];
  const result = projectDocumentReview(change(before, after, "order"));
  expect(result.decisionId).toBe("original-decision");
  expect(result.fragments).toHaveLength(1);
  expect(result.fragments[0]).toMatchObject({
    beforePath: ["blocks", { key: "id", value: "next" }], path: ["blocks", { key: "id", value: "next" }],
    before: unit("next"), after: unit("next"), positionChanged: true, contentChanged: false,
  });
  expect(result.fragments[0]?.placement).toEqual({ before: before.map(item => item.id), after: after.map(item => item!.id) });
});

it("preserves nested collection paths rather than substituting the parent block", () => {
  const path = ["blocks", { key: "id", value: "parent" }, "children"] as const;
  const result = projectDocumentReview(change([unit("a"), unit("b"), unit("c")], [unit("c"), unit("a"), unit("b")], "order", path));
  expect(result.fragments.map(fragment => fragment.path)).toEqual([[...path, { key: "id", value: "c" }]]);
  expect(result.fragments[0]?.beforePath).toEqual([...path, { key: "id", value: "c" }]);
});

it("uses the same correspondence for additions, deletions and field content changes", () => {
  const a = { field: "a", text: "old" }, b = { field: "b", text: "retained" }, removed = { field: "removed", text: "gone" };
  const added = { field: "added", text: "new" }, edited = { ...a, text: "edited" };
  const result = projectDocumentReview(change([a, removed, b], [added, edited, b], "node", ["fields"]));
  expect(result.fragments).toHaveLength(3);
  const editedFragment = result.fragments.find(fragment => (fragment.after as { field?: string } | undefined)?.field === "a");
  expect(editedFragment).toMatchObject({ before: a, after: edited, positionChanged: false, contentChanged: true });
  const removedFragment = result.fragments.find(fragment => fragment.after === undefined);
  expect(removedFragment?.beforePath).toEqual(["fields", { key: "field", value: "removed" }]);
  expect(removedFragment).not.toHaveProperty("path");
  const addedFragment = result.fragments.find(fragment => fragment.before === undefined);
  expect(addedFragment?.path).toEqual(["fields", { key: "field", value: "added" }]);
  expect(addedFragment).not.toHaveProperty("beforePath");
});

it("keeps text and membership out of an order decision's location-only view", () => {
  const before = [unit("a", "old"), unit("b"), unit("removed")];
  const after = [unit("b", "edited"), unit("a", "edited too"), unit("added")];
  const result = projectDocumentReview(change(before, after, "order"));
  expect(result.fragments).toHaveLength(1);
  expect(result.fragments[0]).toMatchObject({ before: unit("b", "edited"), after: unit("b", "edited"), contentChanged: false, positionChanged: true });
});

it("chooses a deterministic minimum display for equal-length stable subsequences", () => {
  const decision = change([unit("a"), unit("b")], [unit("b"), unit("a")], "order");
  expect(projectDocumentReview(decision)).toEqual(projectDocumentReview(decision));
  expect(projectDocumentReview(decision).fragments).toHaveLength(1);
  expect(projectDocumentReview(decision).fragments[0]?.path).toEqual(["blocks", { key: "id", value: "b" }]);
});

it.each([
  [["same", "same"], ["same"]],
  [[{ id: "a" }, { id: "a" }], [{ id: "a" }]],
  [[{ id: "a" }, {}], [{ id: "a" }]],
])("retains the original authorized range when identities cannot be unique", (before, after) => {
  const decision = change(before, after);
  const result = projectDocumentReview(decision);
  expect(result.fragments).toHaveLength(1);
  expect(result.fragments[0]).toMatchObject({ beforePath: decision.beforePath, path: decision.path, before, after });
  expect(result.fallbackReason).toContain("唯一稳定身份");
});

it("leaves scalar and atomic changes at their original real path", () => {
  const decision = change("x^2", "x^3", "text", ["formula", "source"]);
  expect(projectDocumentReview(decision)).toEqual({ decisionId: decision.id,
    fragments: [{ beforePath: decision.beforePath, path: decision.path, before: "x^2", after: "x^3", positionChanged: false, contentChanged: true }] });
});

it("supports another domain identity and equality without changing original decisions", () => {
  const before = [{ key: "one", text: "retained", metadata: 1 }, { key: "two", text: "retained", metadata: 1 }];
  const after = [{ ...before[1]!, metadata: 2 }, before[0]!];
  const decision = change(before, after);
  const copy = JSON.stringify(decision);
  const result = projectDocumentReview(decision, {
    identity: value => value && typeof value === "object" && "key" in value && typeof value.key === "string" ? { key: "key", value: value.key } : undefined,
    equal: (a, b) => (a as { text?: string } | undefined)?.text === (b as { text?: string } | undefined)?.text,
  });
  expect(result.fragments).toHaveLength(1); expect(result.fragments[0]?.contentChanged).toBe(false);
  expect(result.fragments[0]?.path).toEqual(["blocks", { key: "key", value: "two" }]);
  expect(JSON.stringify(decision)).toBe(copy);
});

it("preserves membership changes even when an injected content comparator considers all values equal", () => {
  const result = projectDocumentReview(change([unit("old")], [unit("new")]), { equal: () => true });
  expect(result.fragments).toHaveLength(2);
  expect(result.fragments.every(fragment => fragment.contentChanged)).toBe(true);
});

it("keeps the original order operation independent of member content and review application", () => {
  const block = (id: string, text: string): NoteBlockV1 => ({ id: noteBlockId(id), type: "paragraph", props: {}, children: [],
    content: { kind: "inline", items: [{ type: "text", text, styles: [] }] } });
  const base: NoteDocumentV1 = { schemaVersion: 1, pageId: notePageId("page"), blocks: [block("a", "A"), block("b", "B")] };
  const next: NoteDocumentV1 = { ...base, blocks: [block("b", "B edited"), block("a", "A")] };
  const adapter = createNoteDocumentAdapter((a, b) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }]);
  const changes = adapter.diff(base, next), order = changes.find(item => item.kind === "order");
  expect(order).toBeDefined();
  if (!order) throw new Error("missing order");
  const projection = projectDocumentReview(order);
  expect(projection.decisionId).toBe(order.id);
  expect(projection.fragments.every(fragment => !fragment.contentChanged)).toBe(true);
  const undone = adapter.apply(next, order, "before");
  expect(undone.blocks.map(item => item.id)).toEqual(["a", "b"]);
  expect(undone.blocks[1]?.content).toEqual(next.blocks[0]?.content);
  const accepted = adapter.apply(base, order, "after");
  expect(accepted.blocks.map(item => item.id)).toEqual(["b", "a"]);
  expect(accepted.blocks[0]?.content).toEqual(base.blocks[1]?.content);
});
