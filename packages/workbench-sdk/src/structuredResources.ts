import type {AiEvidenceItem} from "@research-assistant/core/ai";
import type {StructuredHistoryRequest, StructuredLegacyImport, StructuredResource, StructuredResourceWrite,
  StructuredReviewRequest, StructuredStartupImport, StructuredStartupImportResult,
  StructuredTemplateBinding, StructuredWriteResult} from "@research-assistant/core/structured-resources";

export type StructuredResourceEvidence = AiEvidenceItem & {readonly fieldIds?: readonly string[]};
export interface StructuredResourceGateway {
  subscribeChanges?(changed: (change: {resourceId: string; paperId: string | null}) => void): Promise<() => void>;
  createTemplate(title: string, requestId: string): Promise<StructuredResource>;
  list(paperId?: string): Promise<readonly StructuredResource[]>;
  get(resourceId: string): Promise<StructuredResource>;
  getSources(resourceId: string): Promise<readonly StructuredResourceEvidence[]>;
  getVersion(resourceId: string, revision: number): Promise<StructuredResource>;
  write(draft: StructuredResourceWrite): Promise<StructuredWriteResult>;
  review(draft: StructuredReviewRequest): Promise<StructuredResource>;
  restoreHistory(draft: StructuredHistoryRequest): Promise<StructuredResource>;
  bindTemplate(draft: StructuredTemplateBinding): Promise<StructuredResource>;
  importLegacy(draft: StructuredLegacyImport): Promise<readonly StructuredResource[]>;
  importStartup(draft: StructuredStartupImport): Promise<StructuredStartupImportResult>;
}

/** Return Core's existing selected typed port, without exposing its registry,
 * native transport or a replacement persistence/authority owner. */
export declare function getStructuredResourceGateway(): StructuredResourceGateway;
/** Format only safe validation identities; no dispatch or storage owner is created. */
export declare function structuredWriteValidationDiagnostic(result: StructuredWriteResult): string;
