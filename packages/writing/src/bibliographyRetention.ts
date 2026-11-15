import { inspectCitationUsage, type CitationBinding } from "./citationBinding";

/** Imported records are roots; automatic bindings are recoverable identities,
 * not a reason to keep an unused entry in the current bibliography projection. */
export function retainedBibliographyKeys(
  sources: readonly string[], bindings: readonly CitationBinding[],
  imported: readonly {readonly citationKey: string; readonly bibtexEntry: string}[],
  preserveImported = true,
): ReadonlySet<string> {
  const known = [...imported, ...bindings];
  const retained = new Set([...(preserveImported ? imported.map(row => row.citationKey) : []),
    ...inspectCitationUsage(sources, bindings, imported.map(row => row.citationKey)).usedKeys]);
  const knownKeys = new Set(known.map(row => row.citationKey));
  // Multi-cite commands and user macros can have further key arguments beyond
  // the standard citation scanner. Ambiguous occurrences must prevent deletion.
  for (const source of sources) {
    const text = source.replace(/(?<!\\)(?:\\\\)*%[^\n]*/gu, "");
    for (const argument of text.matchAll(/\{([^{}]*)\}/gu)) {
      for (const key of (argument[1] ?? "").split(",").map(value => value.trim())) if (knownKeys.has(key)) retained.add(key);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of known) {
      if (!retained.has(row.citationKey)) continue;
      // Generated library entries contain no string macros. For imported custom
      // relations we cannot resolve, retain all cached entries conservatively.
      const relations = [...row.bibtexEntry.matchAll(/\b(?:crossref|xref|xdata|entryset|related)\s*=\s*(\{[^{}]*\}|"[^"]*"|[^,\r\n}]+)/giu)];
      for (const relation of relations) {
        const literal = /^(?:\{([^{}]*)\}|"([^"]*)")\s*$/u.exec(relation[1] ?? "");
        if (!literal) return new Set(known.map(entry => entry.citationKey));
        for (const key of (literal[1] ?? literal[2] ?? "").split(",").map(key => key.trim()).filter(Boolean)) {
          if (!retained.has(key)) {retained.add(key); changed = true;}
        }
      }
    }
  }
  return retained;
}
