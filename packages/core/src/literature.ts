export const LITERATURE_TYPES = [
  "journalArticle",
  "magazineArticle",
  "newspaperArticle",
  "conferencePaper",
  "book",
  "bookSection",
  "preprint",
  "manuscript",
  "thesis",
  "report",
  "dataset",
  "computerProgram",
  "webpage",
  "standard",
  "patent",
  "document",
] as const;

export type LiteratureType = (typeof LITERATURE_TYPES)[number];
export type ReadingStatus = "unread" | "reading" | "read";

export interface LiteratureCreator {
  readonly familyName: string;
  readonly givenName: string;
  readonly literalName: string;
  readonly role: string;
}

export interface LiteratureDraft {
  readonly id?: string;
  readonly itemType: LiteratureType;
  readonly title: string;
  readonly abstractText: string;
  readonly issuedYear?: number;
  readonly containerTitle: string;
  readonly conferenceName?: string;
  readonly proceedingsTitle?: string;
  readonly place?: string;
  readonly volume: string;
  readonly issue: string;
  readonly pages: string;
  readonly doi: string;
  readonly url: string;
  readonly language: string;
  readonly bibtexKey: string;
  readonly rawBibtex?: string;
  readonly creators: readonly LiteratureCreator[];
  readonly tags: readonly string[];
  readonly sourceKind?: string;
}

export interface AttachmentSummary {
  readonly id: string;
  readonly displayName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly contentSha256: string;
}

export interface AttachmentRemovalResult {
  readonly fileStatus: "deleted" | "missing" | "retained" | "cleanup_failed";
  readonly warning: string | null;
}

export interface MetadataSource {
  readonly fieldName: string;
  readonly sourceKind: string;
  readonly confirmedByUser: boolean;
}

export interface MetadataFieldDiff {
  readonly fieldName: string;
  readonly currentValue: string;
  readonly candidateValue: string;
  readonly userConfirmed: boolean;
}

export interface MetadataPreview {
  readonly id: string;
  readonly importJobId: string;
  readonly itemId?: string;
  readonly sourceKind: string;
  readonly sourceReference: string;
  readonly draft: LiteratureDraft;
  readonly diffs: readonly MetadataFieldDiff[];
  readonly warnings?: readonly string[];
}

export type LiteratureMetadataPatch =
  | { readonly fieldName: "itemType"; readonly value: LiteratureType }
  | { readonly fieldName: "title" | "abstractText" | "containerTitle" | "conferenceName" | "proceedingsTitle" | "place" | "volume" | "issue" | "pages" | "doi" | "url" | "language" | "bibtexKey"; readonly value: string }
  | { readonly fieldName: "issuedYear"; readonly value: number | null }
  | { readonly fieldName: "creators"; readonly value: readonly LiteratureCreator[] }
  | { readonly fieldName: "tags"; readonly value: readonly string[] };

export interface MetadataCandidateFieldDecision {
  readonly fieldName: LiteratureMetadataPatch["fieldName"];
  readonly choice: "candidate" | "current";
}

export type MetadataCandidateTrust = "reviewable" | "trusted";

export interface LiteratureItem extends LiteratureDraft {
  readonly id: string;
  readonly readingStatus: ReadingStatus;
  readonly attachments: readonly AttachmentSummary[];
  readonly projectIds: readonly string[];
  readonly metadataSources: readonly MetadataSource[];
  readonly trashedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DuplicateCandidate {
  readonly id: string;
  readonly leftItemId: string;
  readonly leftTitle: string;
  readonly rightItemId: string;
  readonly rightTitle: string;
  readonly reason: "doi" | "content_hash" | "normalized_title_year";
  readonly confidence: number;
}

export interface MergeOperation {
  readonly id: string;
  readonly survivorItemId: string;
  readonly survivorTitle: string;
  readonly mergedItemId: string;
  readonly mergedTitle: string;
  readonly state: "applied" | "undone";
  readonly createdAt: string;
}

export interface PageText {
  readonly pageIndex: number;
  readonly text: string;
}

export interface ImportResult {
  readonly inputLabel: string;
  readonly rawInput: string;
  readonly state: "pending" | "imported" | "duplicate" | "failed" | "cancelled";
  readonly itemId?: string;
  readonly errorMessage?: string;
}

export interface PdfImportCandidate {
  readonly path: string;
  readonly draft: LiteratureDraft;
}

export interface ImportJob {
  readonly id: string;
  readonly state: string;
  readonly sourceKind: string;
  readonly totalCount: number;
  readonly completedCount: number;
  readonly cancellationRequested: boolean;
  readonly results: readonly ImportResult[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface AnnotationDraft {
  readonly itemId: string;
  readonly attachmentId: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly SourceRect[];
  readonly quoteExact: string;
  readonly quotePrefix?: string;
  readonly quoteSuffix?: string;
  readonly annotationType: "highlight" | "note";
  readonly color?: string;
  readonly body?: string;
}

export interface LiteratureAnnotation {
  readonly id: string;
  readonly anchorId: string;
  readonly itemId: string;
  readonly attachmentId: string;
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly SourceRect[];
  readonly quoteExact: string;
  readonly annotationType: "highlight" | "note";
  readonly color: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface ReadingPosition {
  readonly pageIndex: number;
  readonly zoom: number;
}

export function emptyLiteratureDraft(): LiteratureDraft {
  return {
    itemType: "document",
    title: "",
    abstractText: "",
    containerTitle: "",
    conferenceName: "",
    proceedingsTitle: "",
    place: "",
    volume: "",
    issue: "",
    pages: "",
    doi: "",
    url: "",
    language: "",
    bibtexKey: "",
    creators: [],
    tags: [],
  };
}

export {applyLiteratureCreatorInput, createLiteratureCreatorInput, formatLiteratureCreators, updateLiteratureCreatorInput, primaryCreatorRoleForLiteratureType, LITERATURE_TYPE_OPTIONS} from "./literatureMetadataInput";
export type {LiteratureCreatorInput} from "./literatureMetadataInput";
