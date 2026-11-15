import { expect, it } from "vitest";
import { createNoteDocumentAdapter, createTextDocumentAdapter } from "./adapters";
import { consumeIntentRanges, intentConflicts, planIntent, type Intent } from "./sessionIntent";
import { noteBlockId, notePageId, type NoteBlockV1, type NoteDocumentV1 } from "../notes";

const calculate = (before: string, after: string) => {
  const a = before.split("\n"), b = after.split("\n");
  if (a.length !== b.length) return before === after ? [] : [{ fromA: 0, toA: before.length, fromB: 0, toB: after.length }];
  let fromA = 0, fromB = 0;
  return a.flatMap((line, index) => {
    const next = b[index]!, result = line === next ? [] : [{ fromA, toA: fromA + line.length, fromB, toB: fromB + next.length }];
    fromA += line.length + 1; fromB += next.length + 1; return result;
  });
};
const text = createTextDocumentAdapter(calculate);
const point = (content: string) => ({ content, baseline: content, ancestor: content, reviewAncestor: content, baselineAncestor: content });

it("consumes one text range while dispatching a clean independent delta in the same string", () => {
  const source = "score=90\nnext=new", target = "score=80\nnext=old", choice = "score=92\nnext=new";
  const intent: Intent<string> = { kind: "history", source, content: target, sourceBaseline: source, baseline: target,
    origin: source, targetOrigin: target, replay: point(source) };
  const [score] = text.diff(source, choice);
  const next = consumeIntentRanges(text, intent, { selected: [score!], point: point(choice) });
  const state = { content: choice, baselineProjection: choice, observed: { version: 5, saved: choice, baseline: choice } };
  const plan = planIntent(text, next, state);
  expect(plan.content.value).toBe("score=92\nnext=old"); expect(plan.baseline.value).toBe("score=92\nnext=old");
  expect(plan.content.conflicts).toHaveLength(0); expect(plan.baseline.conflicts).toHaveLength(0);
  expect(next.replay?.reviewAncestor).toBe(choice); expect(next.origin).toBe(choice);
  expect(next.targetOrigin).toBe("score=92\nnext=old");
});

it("shows a history content conflict against the real S branch, mapped to the human H", () => {
  const intent: Intent<string> = { kind: "history", source: "90", content: "80", sourceBaseline: "80", baseline: "80" };
  const state = { content: "91", baselineProjection: "80", observed: { version: 5, saved: "96", baseline: "80" } };
  const [conflict] = intentConflicts(text, intent, state);
  expect(conflict?.after).toBe("91"); expect(conflict?.incoming).toBe("96");
  expect(planIntent(text, intent, state).content.conflicts).toHaveLength(1);
});

it("retains the accepted-baseline source of a history baseline conflict", () => {
  const intent: Intent<string> = { kind: "history", source: "90", content: "90", sourceBaseline: "90", baseline: "80" };
  const state = { content: "91", baselineProjection: "80", observed: { version: 5, saved: "90", baseline: "95" } };
  const [conflict] = intentConflicts(text, intent, state);
  expect(conflict?.origin).toBe("baseline"); expect(conflict?.incoming).toBe("95");
});

const note = createNoteDocumentAdapter(calculate);
const block = (id: string, value: string, children: NoteBlockV1[] = []): NoteBlockV1 => ({
  id: noteBlockId(id), type: "paragraph", props: {}, children,
  content: { kind: "inline", items: [{ type: "text", text: value, styles: [] }] },
});
const document = (...blocks: NoteBlockV1[]): NoteDocumentV1 => ({ schemaVersion: 1, pageId: notePageId("range-consumption"), blocks });
it("leaves an independent old move intact when a later identity is absent from its atomic snapshots", () => {
  const source = document(block("parent", "parent", [block("a", "a")]), block("b", "b"));
  const target = document(block("parent", "parent"), block("b", "b", [block("a", "a")]));
  const before = document(...source.blocks, block("later", "85")), choice = document(...source.blocks, block("later", "90"));
  const intent: Intent<NoteDocumentV1> = { kind: "review", source, content: target, sourceBaseline: source, baseline: target };
  expect(note.diff(source, target)[0]?.path).toEqual([]);
  const current = { content: choice, baseline: before, ancestor: before, baselineAncestor: before };
  const result = consumeIntentRanges(note, intent, { selected: note.diff(before, choice), point: current });
  expect(result).toBe(intent);
});
