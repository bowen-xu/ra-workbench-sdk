import { equalValue } from "./value";

export interface Alignment { readonly pairs: readonly { readonly before?: number; readonly after?: number }[]; readonly ambiguous: boolean }
/** Bounded sequence alignment. Equal-cost alternatives are not arbitrarily
 * assigned identities. Callers lift ambiguity to a complete parent unit. */
export function align(before: readonly unknown[], after: readonly unknown[], compatible: (a: unknown, b: unknown) => boolean = () => true): Alignment {
  if (before.length * after.length > 40_000) return { pairs: [], ambiguous: true };
  const width = after.length + 1, size = (before.length + 1) * width;
  const costs = new Float64Array(size), ways = new Uint8Array(size);
  const substitution = (a: unknown, b: unknown) => equalValue(a,b) ? 0 : compatible(a,b) ? 1.5 : Infinity;
  ways[0] = 1;
  for (let i = 0; i <= before.length; i++) for (let j = 0; j <= after.length; j++) {
    if (!i && !j) continue;
    const options = [i ? costs[(i - 1) * width + j]! + 1 : Infinity,
      j ? costs[i * width + j - 1]! + 1 : Infinity,
      i && j ? costs[(i - 1) * width + j - 1]! + substitution(before[i-1],after[j-1]) : Infinity];
    const best = Math.min(...options); costs[i * width + j] = best;
    ways[i * width + j] = Math.min(2, options.reduce((count, cost, index) => cost === best
      ? count + ways[index === 0 ? (i - 1) * width + j : index === 1 ? i * width + j - 1 : (i - 1) * width + j - 1]! : count, 0));
  }
  const pairs: { before?: number; after?: number }[] = []; let i = before.length, j = after.length;
  while (i || j) {
    const best = costs[i * width + j]!;
    if (i && j && costs[(i - 1) * width + j - 1]! + substitution(before[i-1],after[j-1]) === best) pairs.push({ before: --i, after: --j });
    else if (i && costs[(i - 1) * width + j]! + 1 === best) pairs.push({ before: --i });
    else pairs.push({ after: --j });
  }
  return { pairs: pairs.reverse(), ambiguous: ways[size - 1] === 2 };
}
