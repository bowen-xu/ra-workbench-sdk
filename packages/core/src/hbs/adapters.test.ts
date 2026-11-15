import { expect, it } from "vitest";
import { createNoteDocumentAdapter, createStructuredDocumentAdapter, createTextDocumentAdapter } from "./adapters";
import { type NoteBlockV1, type NoteDocumentV1, noteBlockId, notePageId } from "../notes";
import { HbsSession } from "./session";
import { DocumentVersionConflict, type DocumentSnapshot } from "./document";
const calculate = (a: string, b: string) => {
  let start = 0; while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0; while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  return a === b ? [] : [{ fromA: start, toA: a.length - end, fromB: start, toB: b.length - end }];
};
const notes = createNoteDocumentAdapter(calculate);
const cell = (text: string) => ({ kind: "inline" as const, items: [{ type: "text" as const, text, styles: [] }] });
const block = (id: string, text: string): NoteBlockV1 => ({ id: noteBlockId(id), type: "paragraph", props: {}, children: [], content: cell(text) });
const document = (...blocks: NoteBlockV1[]): NoteDocumentV1 => ({ schemaVersion: 1, pageId: notePageId("page"), blocks });
const table = (rows: string[][]) => document({ ...block("table", ""), type: "table", content: { kind: "table", rows: rows.map(row => row.map(cell)) } });

it("keeps complete block identities and applies a nested decision without accepting its sibling", () => {
  const a = document({ ...block("parent", "parent"), children: [block("a", "old"), block("b", "old")] });
  const b = document({ ...block("parent", "parent"), children: [block("a", "new"), block("b", "new")] });
  const changes = notes.diff(a, b); expect(changes).toHaveLength(2);
  const partial = notes.apply(a, changes[0]!, "after"); expect(notes.diff(partial, b)).toHaveLength(1);
  expect(notes.apply(b, changes[0]!, "before").blocks[0]!.children[1]).toEqual(b.blocks[0]!.children[1]);
});
it("keeps a formula whole and preserves its containing text", () => {
  const a = document({ ...block("p", ""), content: { kind: "inline", items: [{ type: "text", text: "prefix", styles: [] }, { type: "inlineFormula", source: "x^2" }] } });
  const b = document({ ...a.blocks[0]!, content: { kind: "inline", items: [{ type: "text", text: "prefix", styles: [] }, { type: "inlineFormula", source: "y^2" }] } });
  const changes = notes.diff(a, b); expect(changes).toHaveLength(1); expect(changes[0]!.before).toEqual({ type: "inlineFormula", source: "x^2" });
  expect(notes.apply(b, changes[0]!, "before")).toEqual(a);
});
it("compares cells independently and applies row and column changes through complete grid units", () => {
  const a = table([["name", "value"], ["A", "1"], ["B", "2"]]);
  const b = table([["name", "value"], ["A", "3"], ["B", "4"]]);
  const changed = notes.diff(a, b); expect(changed.map(change => change.kind)).toEqual(["cell", "cell"]);
  expect(notes.diff(notes.apply(a, changed[0]!, "after"), b)).toHaveLength(1);
  const row = table([["name", "value"], ["A", "1"], ["C", "5"], ["B", "2"]]);
  const inserted = notes.diff(a, row); expect(inserted).toHaveLength(1); expect(inserted[0]!.kind).toBe("row");
  expect(notes.apply(a, inserted[0]!, "after")).toEqual(row); expect(notes.apply(row, inserted[0]!, "before")).toEqual(a);
  const col = table([["name", "unit", "value"], ["A", "kg", "1"], ["B", "m", "2"]]);
  const added = notes.diff(a, col); expect(added).toHaveLength(1); expect(added[0]!.kind).toBe("column");
  expect(notes.apply(a, added[0]!, "after")).toEqual(col); expect(notes.apply(col, added[0]!, "before")).toEqual(a);
});
it("lifts ambiguous repeated rows instead of assigning them invented identities", () => {
  const a = table([["repeat"], ["repeat"]]), b = table([["repeat"], ["repeat"], ["repeat"]]);
  const changes = notes.diff(a, b); expect(changes).toHaveLength(1); expect(changes[0]!.reason).toContain("不能唯一");
  expect(notes.apply(a, changes[0]!, "after")).toEqual(b);
});
it("keeps add/delete placement and keyed reorders valid without index identity", () => {
  const a=document(block("a","A"),block("b","B")), inserted=document(block("a","A"),block("c","C"),block("b","B"));
  const addition=notes.diff(a,inserted);expect(addition).toHaveLength(1);
  expect(notes.apply(a,addition[0]!,"after")).toEqual(inserted);
  expect(notes.apply(inserted,addition[0]!,"before")).toEqual(a);
  const removed=notes.diff(inserted,a);expect(notes.apply(a,removed[0]!,"before")).toEqual(inserted);
  const moved=document(a.blocks[1]!,a.blocks[0]!);const move=notes.diff(a,moved);
  expect(move).toHaveLength(1);expect(move[0]!.kind).toBe("order");expect(notes.apply(a,move[0]!,"after")).toEqual(moved);
  const edited=document({...a.blocks[0]!,content:cell("A edited")},a.blocks[1]!);
  expect(notes.merge(a,edited,moved).value.blocks.map(block=>block.id)).toEqual(["b","a"]);
});
it("promotes reparenting and parent deletion/child editing to complete legal units",()=>{
  const a=document({...block("p","P"),children:[block("c","C")]},block("q","Q"));
  const b=document(block("p","P"),{...block("q","Q"),children:[block("c","C")]});
  const changes=notes.diff(a,b);expect(changes).toHaveLength(1);expect(changes[0]!.reason).toContain("跨父级");expect(notes.apply(a,changes[0]!,"after")).toEqual(b);
  const edited=document({...a.blocks[0]!,children:[block("c","edited")]},a.blocks[1]!);
  const result=notes.merge(a,edited,document(a.blocks[1]!));expect(result.conflicts).toHaveLength(1);expect(result.value).toEqual(edited);
});
it.each(["moved", "other"])("retains the accepted atomic document while lifting a child with pending %s text", pending => {
  const a = document({...block("toggle", "Title"), type: "toggleListItem", children: [block("left", "Left"), block("right", "Right")]}, block("other", "Other"));
  const previous = document({...a.blocks[0]!, children: [block("left", "Left"), block("right", pending === "moved" ? "Incoming" : "Right")]},
    block("other", pending === "other" ? "Incoming other" : "Other"));
  const next = document({...previous.blocks[0]!, children: [previous.blocks[0]!.children[0]!]}, previous.blocks[0]!.children[1]!, previous.blocks[1]!);
  expect(notes.projectManual(a, previous, next)).toEqual(a);
  expect(notes.diff(a, next)).toHaveLength(1);
  expect(notes.projectManual(previous, previous, next)).toEqual(next);
});
it("uses sequence correspondence for row deletion/moves and conservatively lifts compound geometry",()=>{
  const a=table([["A","1"],["B","2"],["C","3"]]), deleted=table([["A","1"],["C","3"]]);
  const deletion=notes.diff(a,deleted);expect(deletion).toHaveLength(1);expect(deletion[0]!.kind).toBe("row");expect(notes.apply(a,deletion[0]!,"after")).toEqual(deleted);
  const moved=table([["B","2"],["A","1"],["C","3"]]);
  const move=notes.diff(a,moved);expect(move).toHaveLength(1);expect(notes.apply(a,move[0]!,"after")).toEqual(moved);
  const geometry=table([["A","unit","1"],["B","unit","2"],["C","unit","3"],["D","unit","4"]]);
  expect(notes.diff(a,geometry)[0]!.reason).toContain("行列同时");
});
it("maps an independent cell edit across an inserted row or column",()=>{
  const a=table([["A","1"],["B","2"]]), edited=table([["A","1"],["B","edited"]]);
  const row=table([["A","1"],["C","3"],["B","2"]]);
  const result=notes.merge(a,edited,row);expect(result.conflicts).toHaveLength(0);expect(result.value).toEqual(table([["A","1"],["C","3"],["B","edited"]]));
  const column=table([["A","kg","1"],["B","m","2"]]);
  const other=notes.merge(a,column,edited);expect(other.conflicts).toHaveLength(0);expect(other.value).toEqual(table([["A","kg","1"],["B","m","edited"]]));
});
it("preserves source/attachment/style values and refuses invalid Both without dropping input",()=>{
  const base=document({...block("a","text"),props:{custom:"retained"},content:{kind:"asset",assetId:"a".repeat(64),displayName:"asset",mimeType:"image/png",caption:"old"}});
  const local=document({...base.blocks[0]!,content:{...base.blocks[0]!.content,caption:"local"} as typeof base.blocks[0]["content"]});
  const incoming=document({...base.blocks[0]!,content:{...base.blocks[0]!.content,caption:"incoming"} as typeof base.blocks[0]["content"]});
  const result=notes.merge(base,local,incoming);expect(result.conflicts).toHaveLength(1);expect(result.value).toEqual(local);
  expect(()=>notes.combine(result.conflicts[0]!)).toThrow("MODEL_BOTH_UNSUPPORTED");
  expect(notes.apply(base,notes.diff(base,local)[0]!,"after").blocks[0]!.props).toEqual({custom:"retained"});
});
it("merges independent real fields and cell edits, preserving metadata", () => {
  const a = table([["A", "1"], ["B", "2"]]), b = table([["A", "3"], ["B", "2"]]), c = table([["A", "1"], ["B", "4"]]);
  const result = notes.merge(a, b, c); expect(result.conflicts).toHaveLength(0); expect(result.value).toEqual(table([["A", "3"], ["B", "4"]]));
  const cards = createStructuredDocumentAdapter(calculate), base = { kind: "actual", fields: [{ field: "a", text: "old" }, { field: "b", text: "old" }], metadata: { source: "retain" } };
  const next = { ...base, fields: [{ field: "a", text: "new" }, { field: "b", text: "old" }] };
  expect(cards.apply(base, cards.diff(base, next)[0]!, "after")).toEqual(next);
});
it("keeps typed input and review pending through a version rejection and recovery", async () => {
  const adapter = createTextDocumentAdapter(calculate);
  let server: DocumentSnapshot<string> = { version: 1, saved: "score 80%\nlast", baseline: "score 80%\nlast" };
  let preserved: import("./document").DocumentCheckpoint<string> | undefined;
  const options = { adapter, preservation: { load: () => preserved, save: (value: NonNullable<typeof preserved>) => { preserved = value; } }, requestId: (n: number) => `request-${n}`,
    port: { read: async () => server, commit: async (request: import("./document").DocumentCommit<string>) => {
      if (request.expectedVersion !== server.version) throw new DocumentVersionConflict(server, request.id);
      server = { version: server.version + 1, saved: request.saved, baseline: request.baseline }; return server;
    } } };
  const session = await HbsSession.open(options);
  server = { ...server, version: 2, saved: "score 85%\nlast" }; await session.syncLatest();
  session.edit("score 91%\nlast"); server = { ...server, version: 3, saved: "score 90%\nlast" }; await session.save();
  expect(session.getSnapshot().content).toContain("91%"); expect(session.getSnapshot().conflicts).toHaveLength(1);
  expect(preserved?.content).toContain("91%");
  session.dispose(); const reopened = await HbsSession.open(options); expect(reopened.getSnapshot().content).toContain("91%"); expect(reopened.getSnapshot().conflicts).toHaveLength(1);
});
