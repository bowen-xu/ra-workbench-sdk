import type { ManuscriptPath } from "./manuscriptPath";
import type { LiteratureDraft, LiteratureItem } from "@research-assistant/core/literature";

export interface ProjectBibliographyEntry {
  readonly id: string;
  readonly manuscriptId: string;
  readonly citationKey: string;
  readonly baseKey?: string;
  readonly originalKey: string;
  readonly originalBibtex: string;
  readonly bibtexEntry: string;
  readonly imported: LiteratureDraft;
  readonly current: LiteratureDraft;
  /** Existing stable relation, including when its optional provider is absent. */
  readonly libraryItemId?: string;
  readonly libraryItem: LiteratureItem | null;
  readonly paths: readonly string[];
}

export type CitationScope = "project" | "library";

export interface CitationCandidate {
  readonly literatureItemId: string;
  readonly title: string;
  readonly firstAuthor: string;
  readonly issuedYear?: number;
  readonly containerTitle: string;
  readonly importedKey: string;
  readonly citationKey?: string;
  readonly hasPdf: boolean;
  readonly hasEvidence: boolean;
  readonly warnings: readonly string[];
}

export interface CitationBinding {
  readonly manuscriptId: string;
  readonly literatureItemId: string;
  readonly citationKey: string;
  readonly bibtexEntry: string;
  readonly state: "active" | "missing_source";
  readonly pinnedAt: string;
  readonly updatedAt: string;
}

export interface BibliographyEntryInput {
  readonly literatureItemId: string;
  readonly requestedKey?: string;
  readonly bibtexEntry: string;
}

export interface BibliographyStatus {
  readonly relativePath: ManuscriptPath;
  readonly contentHash?: string;
  readonly generatedAt?: string;
  readonly status: "ready" | "conflict" | "write_error";
  readonly warnings: readonly string[];
}

export interface CitationUsage {
  readonly usedKeys: readonly string[];
  readonly unusedKeys: readonly string[];
  readonly missingKeys: readonly string[];
}

const CITE_COMMAND = /\\(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/gu;

export function inspectCitationUsage(
  texSources: readonly string[],
  bindings: readonly CitationBinding[],
  managedKeys: readonly string[] = [],
): CitationUsage {
  return inspectCitationKeys(texSources.flatMap(citationKeysInSource), bindings, managedKeys);
}

/** Source parsing is independent of the current bibliography projection. */
export function citationKeysInSource(source: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of source.replace(/(?<!\\)(?:\\\\)*%[^\n]*/gu, "").matchAll(CITE_COMMAND)) {
    for (const key of (match[1] ?? "").split(",")) {
      const normalized = key.trim();
      if (normalized.length > 0) keys.add(normalized);
    }
  }
  return [...keys];
}

export function inspectCitationKeys(keys: readonly string[], bindings: readonly CitationBinding[], managedKeys: readonly string[] = []): CitationUsage {
  const bound = new Set([...bindings.map(binding => binding.citationKey), ...managedKeys]);
  const used = new Set(keys.filter(key => key !== "*"));
  if (keys.includes("*")) for (const key of bound) used.add(key);
  return {
    usedKeys: [...used].filter((key) => bound.has(key)).sort(),
    unusedKeys: [...bound].filter((key) => !used.has(key)).sort(),
    missingKeys: [...used].filter((key) => !bound.has(key)).sort(),
  };
}
