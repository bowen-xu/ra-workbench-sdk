import { decodeNoteDocument, type NoteDocumentV1 } from "../notes/document";
import type { HbsDocumentAdapter } from "./document";
import { createStructuralAdapter } from "./structure/adapter";
import { isObject } from "./structure/value";
import type { TextDiff } from "./textDiff";

export function createTextDocumentAdapter(calculate: TextDiff): HbsDocumentAdapter<string> {
  const adapter = createStructuralAdapter("text", value => {
    if (typeof value !== "string") throw new Error("MODEL_INVALID_DOCUMENT：正文必须是文本。"); return value;
  }, calculate, { atom: () => false, matrix: () => false });
  return { ...adapter, projectManual: (baseline, previous, next) => adapter.merge(previous,baseline,next).value };
}
export function createNoteDocumentAdapter(calculate: TextDiff): HbsDocumentAdapter<NoteDocumentV1> {
  return createStructuralAdapter("note", decodeNoteDocument, calculate, {
    atom: value => isObject(value) && (["formula", "asset", "reference", "unsupported"].includes(String(value.kind)) ||
      ["inlineFormula", "mention"].includes(String(value.type))),
    matrix: (path, value) => path.at(-1) === "rows" && Array.isArray(value),
    compatibleSequenceItems: (before, after) => isObject(before) && isObject(after)
      ? before.type === after.type && before.kind === after.kind : typeof before === typeof after,
    atomicPair: (before, after) => {
      if (!isObject(before) || !isObject(after) || !Array.isArray(before.blocks) || !Array.isArray(after.blocks)) return;
      const parents = (blocks: unknown[], parent = "", result = new Map<string,string>()): Map<string,string> => {
        for (const block of blocks) if (isObject(block) && typeof block.id === "string") {
          result.set(block.id,parent); if (Array.isArray(block.children)) parents(block.children,block.id,result);
        }
        return result;
      };
      const a = parents(before.blocks), b = parents(after.blocks);
      if ([...a].some(([id,parent]) => b.has(id) && b.get(id) !== parent)) return "跨父级移动按完整文档原子核对，防止部分应用产生重复块身份";
      return undefined;
    },
  });
}
/** Keep the resource's actual JSON. This boundary does not invent a card DTO or
 * discard metadata, statements, sources, inactive fields or template details. */
export function createStructuredDocumentAdapter(calculate: TextDiff): HbsDocumentAdapter<unknown> {
  return createStructuralAdapter("structured", value => {
    if (value !== null && !isObject(value)) throw new Error("MODEL_INVALID_DOCUMENT：结构化资源必须是对象或空值。");
    return value;
  }, calculate, { atom: () => false, matrix: () => false });
}
