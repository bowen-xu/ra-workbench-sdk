/** ECDICT's strip-word key; used for suggestions, never to silently replace a query. */
export function stripDictionaryWord(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

/** Banded optimal-string-alignment distance, including adjacent transposition. */
export function dictionaryEditDistance(left: string, right: string, limit: number): number {
  if (!left || !right) return Math.min(Math.max(left.length, right.length), limit + 1);
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  const width = right.length + 1;
  let earlier = new Uint16Array(width).fill(limit + 1);
  let previous = Uint16Array.from({ length: width }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = new Uint16Array(width).fill(limit + 1); current[0] = i;
    let best = limit + 1;
    for (let j = Math.max(1, i - limit); j <= Math.min(right.length, i + limit); j++) {
      let distance = Math.min((previous[j] ?? limit + 1) + 1, (current[j - 1] ?? limit + 1) + 1,
        (previous[j - 1] ?? limit + 1) + (left[i - 1] === right[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        distance = Math.min(distance, (earlier[j - 2] ?? limit + 1) + 1);
      }
      current[j] = distance; best = Math.min(best, distance);
    }
    if (best > limit) return limit + 1;
    earlier = previous; previous = current;
  }
  return Math.min(previous[right.length] ?? limit + 1, limit + 1);
}
