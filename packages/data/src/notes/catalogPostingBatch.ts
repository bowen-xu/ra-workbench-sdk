import {invalidNotePosting,validatePostingValues} from "./catalogPostingValidation";

/** Apply one transaction's final component decisions in a single merge. Only
 * the changed components are sorted; the persisted posting is validated once
 * and never mutated. A net no-op retains its identity so callers skip a put. */
export function updateNoteSearchPostingBatch(values: Uint32Array, updates: Iterable<readonly [number,boolean]>): Uint32Array {
  validatePostingValues(values,2);
  const pending = new Map<number,boolean>();
  for (const [component,include] of updates) {
    if (!Number.isInteger(component) || component < 2 || component > 0xffff_ffff || typeof include !== "boolean") invalidNotePosting();
    pending.set(component,include);
  }
  const edits: {component: number;include: boolean;present: boolean}[] = [];
  let length = values.length;
  for (const [component,include] of pending) {
    let low = 0, high = values.length;
    while (low < high) {const middle = low + Math.floor((high - low) / 2);if (values[middle]! < component) low = middle + 1;else high = middle;}
    const present = values[low] === component;
    if (present === include) continue;
    edits.push({component,include,present});
    length += include ? 1 : -1;
  }
  if (!edits.length) return values;
  edits.sort((left,right) => left.component - right.component);
  const result = new Uint32Array(length);
  let source = 0, destination = 0;
  for (const {component,include,present} of edits) {
    while (source < values.length && values[source]! < component) result[destination++] = values[source++]!;
    if (include) result[destination++] = component;
    if (present) source++;
  }
  result.set(values.subarray(source),destination);
  return result;
}
