/// <reference path="./citation-js.d.ts" />

import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import "@citation-js/plugin-ris";

import type {
  LiteratureCreator,
  LiteratureDraft,
  LiteratureItem,
  LiteratureType,
} from "./literature";
import { IEEE_CSL, NATURE_CSL } from "./cslStyles";

export type CitationStyle = "apa" | "nature" | "ieee";
export type StructuredExportFormat = "bibtex" | "ris" | "csl-json";

type CslName = {
  readonly family?: string;
  readonly given?: string;
  readonly literal?: string;
};

type CslRecord = Record<string, unknown> & {
  readonly id?: string;
  readonly type?: string;
  readonly title?: string;
  readonly abstract?: string;
  readonly author?: readonly CslName[];
  readonly editor?: readonly CslName[];
  readonly translator?: readonly CslName[];
  readonly contributor?: readonly CslName[];
  readonly producer?: readonly CslName[];
  readonly "container-author"?: readonly CslName[];
  readonly "collection-editor"?: readonly CslName[];
  readonly issued?: { readonly "date-parts"?: readonly (readonly number[])[] };
  readonly "container-title"?: string;
  readonly "event-title"?: string;
  readonly "event-place"?: string;
  readonly "publisher-place"?: string;
  readonly volume?: string;
  readonly issue?: string;
  readonly page?: string;
  readonly DOI?: string;
  readonly URL?: string;
  readonly language?: string;
};

const CSL_TO_DOMAIN: Readonly<Record<string, LiteratureType>> = {
  article: "journalArticle",
  "article-journal": "journalArticle",
  "article-magazine": "magazineArticle",
  "article-newspaper": "newspaperArticle",
  "paper-conference": "conferencePaper",
  book: "book",
  collection: "book",
  chapter: "bookSection",
  manuscript: "manuscript",
  thesis: "thesis",
  report: "report",
  dataset: "dataset",
  software: "computerProgram",
  webpage: "webpage",
  "post-weblog": "webpage",
  standard: "standard",
  patent: "patent",
  document: "document",
};

const DOMAIN_TO_CSL: Readonly<Record<LiteratureType, string>> = {
  journalArticle: "article-journal",
  magazineArticle: "article-magazine",
  newspaperArticle: "article-newspaper",
  conferencePaper: "paper-conference",
  book: "book",
  bookSection: "chapter",
  preprint: "manuscript",
  manuscript: "manuscript",
  thesis: "thesis",
  report: "report",
  dataset: "dataset",
  computerProgram: "software",
  webpage: "webpage",
  standard: "standard",
  patent: "patent",
  document: "document",
};

const cslConfig = plugins.config.get("@csl");
if (!cslConfig.styles.has("nature")) {
  cslConfig.styles.add("nature", NATURE_CSL);
}
if (!cslConfig.styles.has("ieee")) {
  cslConfig.styles.add("ieee", IEEE_CSL);
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function yearFrom(record: CslRecord): number | undefined {
  const year = record.issued?.["date-parts"]?.[0]?.[0];
  return typeof year === "number" ? year : undefined;
}

function creatorsFrom(record: CslRecord): readonly LiteratureCreator[] {
  return ([
    ["author", "author"],
    ["editor", "editor"],
    ["translator", "translator"],
    ["contributor", "contributor"],
    ["producer", "producer"],
    ["container-author", "bookAuthor"],
    ["collection-editor", "seriesEditor"],
  ] as const).flatMap(([field, role]) => (record[field] ?? []).map((name) => ({
    familyName: optionalString(name.family),
    givenName: optionalString(name.given),
    literalName: optionalString(name.literal),
    role,
  })));
}

function cslNames(item: LiteratureDraft, role: string): readonly CslName[] {
  return item.creators.filter((creator) => creator.role === role).map((creator) =>
    creator.literalName.length > 0
      ? { literal: creator.literalName }
      : { family: creator.familyName, given: creator.givenName });
}

export function parseBibtex(input: string): readonly LiteratureDraft[] {
  if (input.trim().length === 0) {
    return [];
  }

  const cite = new Cite(input);
  return cite.data.map((rawRecord) => {
    const record = rawRecord as CslRecord;
    const issuedYear = yearFrom(record);
    return {
      itemType: CSL_TO_DOMAIN[record.type ?? ""] ?? "document",
      title: optionalString(record.title) || "Untitled BibTeX item",
      abstractText: optionalString(record.abstract),
      ...(issuedYear === undefined ? {} : { issuedYear }),
      containerTitle: record.type === "paper-conference"
        ? ""
        : optionalString(record["container-title"]),
      ...(record.type === "paper-conference"
        ? {
            conferenceName: optionalString(record["event-title"]),
            proceedingsTitle: optionalString(record["container-title"]),
            place: optionalString(record["event-place"] || record["publisher-place"]),
          }
        : {}),
      volume: optionalString(record.volume),
      issue: optionalString(record.issue),
      pages: optionalString(record.page),
      doi: optionalString(record.DOI),
      url: optionalString(record.URL),
      language: optionalString(record.language),
      bibtexKey: optionalString(record.id),
      rawBibtex: input,
      creators: creatorsFrom(record),
      tags: [],
      sourceKind: "bibtex",
    };
  });
}

export function literatureToCsl(item: LiteratureDraft): CslRecord {
  return {
    ...(item.bibtexKey.length > 0 || item.id !== undefined
      // The BibTeX adapter uses citation-key for an explicit pinned label;
      // CSL id alone permits its default author/year/title label generator.
      ? { id: item.bibtexKey || item.id, ...(item.bibtexKey ? { "citation-key": item.bibtexKey } : {}) }
      : {}),
    type: DOMAIN_TO_CSL[item.itemType],
    title: item.title,
    ...(item.abstractText.length > 0 ? { abstract: item.abstractText } : {}),
    ...(cslNames(item, "author").length > 0 ? { author: cslNames(item, "author") } : {}),
    ...(cslNames(item, "editor").length > 0 ? { editor: cslNames(item, "editor") } : {}),
    ...(cslNames(item, "translator").length > 0
      ? { translator: cslNames(item, "translator") }
      : {}),
    ...(cslNames(item, "contributor").length > 0
      ? { contributor: cslNames(item, "contributor") }
      : {}),
    ...(cslNames(item, "producer").length > 0 ? { producer: cslNames(item, "producer") } : {}),
    ...(cslNames(item, "bookAuthor").length > 0
      ? { "container-author": cslNames(item, "bookAuthor") }
      : {}),
    ...(cslNames(item, "seriesEditor").length > 0
      ? { "collection-editor": cslNames(item, "seriesEditor") }
      : {}),
    ...(item.issuedYear === undefined
      ? {}
      : { issued: { "date-parts": [[item.issuedYear]] } }),
    ...((item.itemType === "conferencePaper"
      ? (item.proceedingsTitle || item.containerTitle)
      : item.containerTitle).length > 0
      ? { "container-title": item.itemType === "conferencePaper"
        ? (item.proceedingsTitle || item.containerTitle)
        : item.containerTitle }
      : {}),
    ...(item.itemType === "conferencePaper" && (item.conferenceName ?? "").length > 0
      ? { "event-title": item.conferenceName }
      : {}),
    ...(item.itemType === "conferencePaper" && (item.place ?? "").length > 0
      ? { "event-place": item.place }
      : {}),
    ...(item.volume.length > 0 ? { volume: item.volume } : {}),
    ...(item.issue.length > 0 ? { issue: item.issue } : {}),
    ...(item.pages.length > 0 ? { page: item.pages } : {}),
    ...(item.doi.length > 0 ? { DOI: item.doi } : {}),
    ...(item.url.length > 0 ? { URL: item.url } : {}),
    ...(item.language.length > 0 ? { language: item.language } : {}),
  };
}

function records(items: readonly LiteratureDraft[]): readonly CslRecord[] {
  return items.map(literatureToCsl);
}

export function exportLiterature(
  items: readonly LiteratureDraft[],
  format: StructuredExportFormat,
): string {
  const data = records(items);
  if (format === "csl-json") {
    return `${JSON.stringify(data, null, 2)}\n`;
  }
  // Citation.js 0.8.2 considers ':' unsafe even in an explicit citation-key
  // and silently regenerates a label. Use safe, unique transport labels, then
  // restore validated BibTeX keys at the output boundary without mutating its
  // global formatter configuration or touching bibliographic field values.
  const pinned = new Map<string,string>();
  let prefix = "ResearchAssistantPinnedCitation";
  const serialized = JSON.stringify(data);
  while (serialized.includes(prefix)) prefix += "X";
  const input = format === "bibtex" ? data.map((record,index) => {
    const key = items[index]?.bibtexKey ?? "";
    if (!/^[A-Za-z][A-Za-z0-9_:+.-]{0,127}$/u.test(key)) return record;
    const placeholder = `${prefix}${index}`;
    pinned.set(placeholder,key);
    return {...record,"citation-key":placeholder};
  }) : data;
  const formatted = new Cite(input).format(format, { type: "text" });
  if (typeof formatted !== "string") {
    throw new Error(`Citation.js returned a non-text ${format} export`);
  }
  let result = formatted;
  for (const [placeholder,key] of pinned) {
    result = result.replace(new RegExp(`(^|\\n)(@[A-Za-z]+\\s*\\{)${placeholder}(?=,)`,"u"),
      (_match:string,before:string,entry:string) => `${before}${entry}${key}`);
  }
  return result;
}

function processorTemplate(style: CitationStyle): string {
  return style;
}

export function formatBibliography(
  items: readonly LiteratureItem[] | readonly LiteratureDraft[],
  style: CitationStyle,
): string {
  const result = new Cite(records(items)).format("bibliography", {
    format: "text",
    template: processorTemplate(style),
    lang: "en-US",
  });
  if (typeof result !== "string") {
    throw new Error("Citation.js returned a non-text bibliography");
  }
  return result.trim();
}

export function formatInTextCitation(
  items: readonly LiteratureItem[] | readonly LiteratureDraft[],
  style: CitationStyle,
): string {
  const result = new Cite(records(items)).format("citation", {
    format: "text",
    template: processorTemplate(style),
    lang: "en-US",
  });
  if (typeof result !== "string") {
    throw new Error("Citation.js returned a non-text citation");
  }
  return result.trim();
}
