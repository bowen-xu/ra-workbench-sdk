export type {
  ReferenceFieldName,
  ReferenceFieldSource,
  ReferenceIdentityState,
  ReferenceMetadataField,
  ReferenceParseState,
  ReferenceRecord,
  ReferenceRecordDraft,
  ReferenceSemanticState,
  ReferenceUsageKind,
} from "./referenceRecord";
export { REFERENCE_FIELD_NAMES } from "./referenceRecord";
export type {
  EvidenceMatrix,
  EvidenceMatrixCell,
  EvidenceMatrixCellDraft,
  EvidenceMatrixDimension,
  EvidenceMatrixDraft,
  EvidenceMatrixStatement,
} from "./evidenceMatrix";
export type {
  DerivedResearchView,
  DerivedResearchViewDraft,
  DerivedResearchViewKind,
  DerivedViewInputRef,
  DerivedViewItem,
} from "./derivedView";
export { detectDoclingReferences, type DetectedReference } from "./doclingReferences";
