import type { ProjectBibliographyEntry } from "./citationBinding";
import { createStableCitationKey, isValidCitationKey } from "./citationKey";
import { scanLatexEnvironments } from "./latexEnvironments";

export interface CitationKeyAssignment {
  readonly referenceId: string;
  readonly baseKey: string;
  readonly from: string;
  readonly to: string;
}
export interface CitationKeyRange { readonly from: number; readonly to: number; readonly key: string }

/** The source text keeps ordinary BibTeX keys. IDs only identify their owners. */
export function citationKeyRanges(source: string): readonly CitationKeyRange[] {
  const excluded = scanLatexEnvironments(source).excluded;
  const masked = source.split("");
  for (const range of excluded) for (let i = range.from; i < range.to; i++) masked[i] = " ";
  const text = masked.join("");
  const result: CitationKeyRange[] = [];
  const command = /(?<!\\)\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?\s*(?:\[[^\]]*\]\s*)*\{/gu;
  for (const match of text.matchAll(command)) {
    let offset = match.index + match[0].length;
    while (offset < text.length) {
      offset += /^\s*/u.exec(text.slice(offset))?.[0].length ?? 0;
      const key = /^[^\s,{}\\]+/u.exec(text.slice(offset))?.[0];
      if (!key) break;
      result.push({from: offset, to: offset + key.length, key});
      offset += key.length;
      offset += /^\s*/u.exec(text.slice(offset))?.[0].length ?? 0;
      if (text[offset] !== ",") break;
      offset++;
    }
  }
  return result;
}

export function rewriteCitationKeys(source: string, mapping: ReadonlyMap<string, string>): string {
  let result = source;
  for (const range of [...citationKeyRanges(source)].reverse()) {
    const key = mapping.get(range.key);
    if (key !== undefined) result = result.slice(0, range.from) + key + result.slice(range.to);
  }
  return result;
}

/** Spreadsheet-style suffixes: a ... z, aa ... az, ba ... */
export function citationSuffix(index: number): string {
  let suffix = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) suffix = String.fromCharCode(97 + (value - 1) % 26) + suffix;
  return suffix;
}

export function planCitationKeys(entries: readonly ProjectBibliographyEntry[], activeIds: ReadonlySet<string>): readonly CitationKeyAssignment[] {
  if (new Set(entries.map(entry => entry.citationKey)).size !== entries.length) {
    throw new Error("发现重复引用键，无法确定旧引用归属，请核对参考文献。");
  }
  const groups = new Map<string, ProjectBibliographyEntry[]>();
  const base = (entry: ProjectBibliographyEntry): string => {
    if (entry.baseKey) return entry.baseKey.toLowerCase();
    if (!entry.id.startsWith("binding:")) {
      const original = (isValidCitationKey(entry.originalKey) ? entry.originalKey : entry.citationKey).toLowerCase();
      const suffix = original.match(/^(.+):[a-z]+$/u);
      // An imported :a/:b family is evidence of managed disambiguation. A lone
      // arbitrary colon key remains literal; do not guess its namespace.
      if (suffix && entries.some(other => other.id !== entry.id && (other.baseKey?.toLowerCase() === suffix[1]
        || other.originalKey.toLowerCase() === suffix[1] || other.originalKey.toLowerCase().match(/^(.+):[a-z]+$/u)?.[1] === suffix[1]))) return suffix[1]!;
      return original;
    }
    const item = entry.libraryItem ?? entry.current;
    return createStableCitationKey({importedKey: item.bibtexKey,
      firstAuthor: item.creators.find(person => person.role === "author")?.familyName ?? "",
      title: item.title, ...(item.issuedYear === undefined ? {} : {issuedYear: item.issuedYear})}, new Set());
  };
  for (const entry of entries) {
    const key = base(entry);
    groups.set(key, [...groups.get(key) ?? [], entry]);
  }
  const keys = new Map<string, string>();
  // Reserve literal bases, including names which themselves end in ':a'.
  const occupied = new Set(groups.keys());
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const active = group.filter(entry => activeIds.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id));
    let index = 0;
    for (const entry of active) {
      let next = key;
      if (active.length > 1) do {const suffix = `:${citationSuffix(index++)}`; next = key.slice(0, 128 - suffix.length) + suffix;} while (occupied.has(next));
      keys.set(entry.id, next); occupied.add(next);
    }
  }
  // Unused automatic records remain recovery identities, never take a live name.
  occupied.clear();
  for (const key of keys.values()) occupied.add(key);
  for (const entry of entries.filter(entry => !keys.has(entry.id)).sort((a, b) => a.id.localeCompare(b.id))) {
    let next = entry.citationKey.toLowerCase(), index = 0;
    while (occupied.has(next)) {const suffix = `:${citationSuffix(index++)}`; next = base(entry).slice(0, 128 - suffix.length) + suffix;}
    keys.set(entry.id, next); occupied.add(next);
  }
  return entries.map(entry => ({referenceId: entry.id, baseKey: base(entry), from: entry.citationKey, to: keys.get(entry.id)!}));
}
