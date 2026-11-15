import {NotesGatewayError} from "./errors";
import {invalidNotePosting,validatePostingValues} from "./catalogPostingValidation";

/** Derived-index format, independent of note identity, permissions and HBS versions. */
export const NOTE_SEARCH_GRAM_VERSION = "literal-codepoint-grams-v1";

/** Input is already Unicode-folded by the catalog's versioned normalization port.
 * Terms cannot cross ECMAScript whitespace, matching the existing query grammar.
 * Rolling code points avoid materializing an array of every body character. */
export function noteSearchGrams(normalizedText: string): ReadonlySet<string> {
  const grams = new Set<string>();
  let previous = "", beforePrevious = "";
  for (const character of normalizedText) {
    if (/\s/u.test(character)) { previous = ""; beforePrevious = ""; continue; }
    grams.add(character);
    if (previous) grams.add(previous + character);
    if (beforePrevious) grams.add(beforePrevious + previous + character);
    beforePrevious = previous; previous = character;
  }
  return grams;
}

/** Query-boundary validation/folding precedes this function. A long term uses
 * trigrams as candidate filters; the saved projection must verify the full term. */
export function noteSearchQueryGrams(normalizedTerm: string): readonly string[] {
  if (!normalizedTerm || /\s/u.test(normalizedTerm)) throw new NotesGatewayError("invalid_input", "note_catalog_search_invalid：搜索词为空或包含空白。");
  const characters = Array.from(normalizedTerm);
  if (characters.length < 3) return [normalizedTerm];
  const grams = new Set<string>();
  for (let index = 0; index + 2 < characters.length; index++) grams.add(characters.slice(index, index + 3).join(""));
  return [...grams];
}

/** Only affected posting keys are read/written. Reordering text with the same
 * membership still updates its saved verification text, but not the postings. */
export function noteSearchGramDelta(before: ReadonlySet<string>, after: ReadonlySet<string>): {
  readonly added: readonly string[]; readonly removed: readonly string[];
} {
  return {added: [...after].filter(gram => !before.has(gram)), removed: [...before].filter(gram => !after.has(gram))};
}

/** Component 2*n is body, 2*n+1 is metadata. Ordinals are private index keys,
 * not resource IDs. They allow terms in different fields to match the same note. */
export function noteSearchCandidateOrdinals(components: Uint32Array): Uint32Array {
  validatePostingValues(components, 2);
  const result = new Uint32Array(components.length);
  let count = 0, previous = 0;
  for (const component of components) {
    const ordinal = component >>> 1;
    if (ordinal !== previous) result[count++] = ordinal;
    previous = ordinal;
  }
  return result.subarray(0, count);
}

/** Inputs are sorted unique ordinal lists, already fetched by selected term keys.
 * This sorts only the bounded query plan, never all note headers or bodies. */
export function intersectNoteSearchCandidates(lists: readonly Uint32Array[]): Uint32Array {
  if (!lists.length) return new Uint32Array();
  for (const values of lists) validatePostingValues(values, 1);
  const ordered = [...lists].sort((left, right) => left.length - right.length);
  let result = ordered[0]!.slice();
  for (const next of ordered.slice(1)) {
    const common = new Uint32Array(Math.min(result.length, next.length));
    let left = 0, right = 0, count = 0;
    while (left < result.length && right < next.length) {
      if (result[left] === next[right]) { common[count++] = result[left++]!; right++; }
      else if (result[left]! < next[right]!) left++;
      else right++;
    }
    result = common.subarray(0, count);
    if (!count) break;
  }
  return result;
}

/** Idempotent single-component membership update without sorting or scanning
 * unrelated posting records. Returning the input means no store put is needed. */
export function updateNoteSearchPosting(values: Uint32Array, component: number, include: boolean): Uint32Array {
  if (!Number.isInteger(component) || component < 2 || component > 0xffff_ffff) invalidNotePosting();
  validatePostingValues(values, 2);
  let low = 0, high = values.length;
  while (low < high) { const middle = low + Math.floor((high - low) / 2); if (values[middle]! < component) low = middle + 1; else high = middle; }
  const present = values[low] === component;
  if (present === include) return values;
  const result = new Uint32Array(values.length + (include ? 1 : -1));
  result.set(values.subarray(0, low));
  if (include) { result[low] = component; result.set(values.subarray(low), low + 1); }
  else result.set(values.subarray(low + 1), low);
  return result;
}
