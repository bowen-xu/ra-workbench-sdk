export const REFERENCE_FIELD_NAMES = ["title", "authors", "year", "doi"] as const;
export type ReferenceFieldName = (typeof REFERENCE_FIELD_NAMES)[number];

export type ReferenceFieldSource =
  | "reference_text"
  | "external_metadata"
  | "ai_inference"
  | "human";

export interface ReferenceMetadataField {
  readonly name: ReferenceFieldName;
  readonly value: string;
  readonly sourceKind: ReferenceFieldSource;
  readonly confirmedByUser: boolean;
}

export type ReferenceParseState = "unparsed" | "parsed" | "failed";
export type ReferenceIdentityState =
  | "unverified"
  | "matched_existing"
  | "verified_external"
  | "ambiguous"
  | "not_found";
export type ReferenceSemanticState = "unreviewed" | "reviewed";
export type ReferenceUsageKind =
  | "mentions"
  | "uses_method"
  | "supports"
  | "opposes"
  | "extends"
  | "background";

export interface ReferenceRecord {
  readonly id: string;
  readonly citingPaperId: string;
  readonly sourceAnchorId: string;
  readonly rawText: string;
  readonly fields: readonly ReferenceMetadataField[];
  readonly parseState: ReferenceParseState;
  readonly identityState: ReferenceIdentityState;
  readonly matchedItemId?: string;
  readonly semanticState: ReferenceSemanticState;
  readonly usageKind?: ReferenceUsageKind;
  readonly usageSummary: string;
  readonly usageAnchorId?: string;
  readonly provenanceKind: "human_original" | "ai_accepted_unchanged" | "ai_accepted_after_edit";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReferenceRecordDraft {
  readonly id?: string;
  readonly citingPaperId: string;
  readonly sourceAnchorId: string;
  readonly rawText: string;
  readonly fields: readonly ReferenceMetadataField[];
  readonly parseState: ReferenceParseState;
  readonly identityState: ReferenceIdentityState;
  readonly matchedItemId?: string;
  readonly semanticState: ReferenceSemanticState;
  readonly usageKind?: ReferenceUsageKind;
  readonly usageSummary: string;
  readonly usageAnchorId?: string;
  readonly expectedRevision?: number;
  readonly changeReason: string;
}
