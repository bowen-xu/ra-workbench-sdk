import { parseSourceLink } from "./sourceNavigation";
/** Stable managed resources; identity and formal content have separate lifetimes. */
export const READING_TEMPLATE_CATALOG_ID = "8bda6f39-8371-4d69-90b8-9f1b1ca8ab01";
export type StructuredResourceKind = "portrait" | "structuredReading" | "readingTemplate";
export interface StructuredTemplateRef {
  readonly resourceId: string;
  readonly revision: number;
}
export interface StructuredValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}
export interface StructuredResourceDraft {
  readonly id: string;
  readonly resourceId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly content: string;
  readonly contentHash: string;
  readonly creatorConversationId?: string;
  readonly errors: readonly StructuredValidationIssue[];
}
export interface StructuredResource {
  readonly id: string;
  readonly kind: StructuredResourceKind;
  readonly paperId?: string;
  readonly sourceUri: string;
  readonly title: string;
  readonly revision: number;
  readonly content: unknown;
  readonly reviewBaseline: unknown;
  readonly pendingFieldIds: readonly string[];
  readonly reviewedFieldIds: readonly string[];
  readonly templateRef?: StructuredTemplateRef;
  readonly draft?: StructuredResourceDraft;
}
export interface StructuredResourceWrite {
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly content: string;
  readonly requestId: string;
  readonly conversationId?: string;
  readonly expectedDraftRevision?: number;
  readonly sourceSnapshotId?: string;
  readonly editorKind?: "human" | "agent";
}
export interface StructuredWriteReceipt {
  readonly requestId: string;
  readonly resourceId: string;
  readonly revision: number;
  readonly contentHash: string;
}
/** Actual identities of a consumed Native validation rejection. The gateway
 * binds these to the acknowledged dispatch before exposing them to a caller. */
export interface StructuredValidationOrigin {
  readonly requestId: string;
  readonly packageKey: string;
  readonly instanceId: string;
  readonly nativeRequestId: string;
}
export interface StructuredWriteResult {
  /** approvalRequired is read compatibility for persisted pre-Diff receipts only. */
  readonly status: "applied" | "invalid" | "conflict" | "approvalRequired";
  readonly resource: StructuredResource;
  readonly draft?: StructuredResourceDraft;
  readonly errors: readonly StructuredValidationIssue[];
  readonly receipt?: StructuredWriteReceipt;
  readonly validationOrigin?: StructuredValidationOrigin;
}
export interface StructuredReviewRequest {
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly requestId: string;
  readonly action: "keep" | "undo" | "undoGeneration" | "verify" | "resetVerification" | "clear";
  readonly fieldIds?: readonly string[];
  readonly scope?: "all" | "unreviewed";
}
export interface StructuredHistoryRequest {
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly operationRevision: number;
  readonly direction: "undo" | "redo";
  readonly requestId: string;
}
export interface StructuredTemplateBinding {
  readonly paperId: string;
  readonly templateId: string;
  readonly templateRevision: number;
  readonly expectedRevision: number;
  readonly confirmed: boolean;
  readonly requestId: string;
}
export interface StructuredLegacyImport {
  readonly requestId: string;
  readonly catalog?: unknown;
  readonly paperId?: string;
  readonly presentation?: {
    readonly fields: readonly {
      readonly candidateId: string;
      readonly fieldId: string;
    }[];
    readonly hiddenUnitIds: readonly string[];
  };
}
export interface StructuredStartupImport {
  readonly catalog?: unknown;
  readonly presentations: readonly {readonly paperId: string; readonly presentation: NonNullable<StructuredLegacyImport["presentation"]>}[];
  /** Legacy cache is decoded after the native authority/deleted-conversation checks. */
  readonly contexts: readonly {readonly conversationId: string; readonly state: unknown}[];
}
export interface StructuredStartupImportResult {
  readonly paperIds: readonly string[];
  readonly importedPaperCount: number;
  readonly importedTemplateCount: number;
  /** Original rows/preferences remain pending until their owner is selected. */
  readonly deferredPaperIds?: readonly string[];
  readonly deferredContextIds?: readonly string[];
}
export interface StructuredResourceField {
  readonly id: string;
  readonly title: string;
  readonly value: unknown;
  readonly text: string;
  readonly color?: string;
}
const row = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("结构化资源回执无效");
  return value as Record<string, unknown>;
};
const string = (value: unknown): string => {
  if (typeof value !== "string")
    throw new Error("结构化资源文字无效");
  return value;
};
const revision = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("结构化资源版本无效");
  return value;
};
const strings = (value: unknown): readonly string[] => {
  if (!Array.isArray(value))
    throw new Error("结构化资源字段无效");
  return value.map(string);
};
export function decodeStructuredIssues(value: unknown): readonly StructuredValidationIssue[] {
  if (!Array.isArray(value))
    throw new Error("结构化校验结果无效");
  return value.map(item => {
    const v = row(item);
    return {
      path: string(v.path),
      code: string(v.code),
      message: string(v.message)
    };
  });
}
function decodeDraft(value: unknown): StructuredResourceDraft {
  const v = row(value);
  return {
    id: string(v.id),
    resourceId: string(v.resourceId),
    baseRevision: revision(v.baseRevision),
    revision: revision(v.revision),
    content: string(v.content),
    contentHash: string(v.contentHash),
    errors: decodeStructuredIssues(v.errors),
    ...(v.creatorConversationId == null ? {} : { creatorConversationId: string(v.creatorConversationId) })
  };
}
export function decodeStructuredResource(value: unknown): StructuredResource {
  const v = row(value), id = string(v.id), kind = string(v.kind);
  if (!["portrait", "structuredReading", "readingTemplate"].includes(kind))
    throw new Error("结构化资源类型无效");
  const paperId = v.paperId == null ? undefined : string(v.paperId), sourceUri = string(v.sourceUri);
  const path = parseSourceLink(sourceUri).path;
  const expected = kind === "readingTemplate" && paperId === undefined ? ["agents", "skills", "edit-structured-resources", "assets", "reading", `${id}.json`] : ["library", paperId, id];
  if (path.length !== expected.length || path.some((part, index) => part !== expected[index]))
    throw new Error("结构化资源来源身份不匹配");
  const template = v.templateRef == null ? undefined : row(v.templateRef);
  const draft = v.draft == null ? undefined : decodeDraft(v.draft);
  if (draft && draft.resourceId !== id)
    throw new Error("结构化资源草稿身份不匹配");
  return {
    id,
    kind: kind as StructuredResourceKind,
    sourceUri,
    title: string(v.title),
    revision: revision(v.revision),
    content: v.content ?? null,
    reviewBaseline: v.reviewBaseline ?? null,
    pendingFieldIds: strings(v.pendingFieldIds),
    reviewedFieldIds: strings(v.reviewedFieldIds),
    ...(paperId ? { paperId } : {}),
    ...(template ? { templateRef: { resourceId: string(template.resourceId), revision: revision(template.revision) } } : {}),
    ...(draft ? { draft } : {})
  };
}
export function decodeStructuredResourceList(value: unknown): readonly StructuredResource[] {
  if (!Array.isArray(value))
    throw new Error("结构化资源列表无效");
  return value.map(decodeStructuredResource);
}
export function decodeStructuredWriteResult(value: unknown): StructuredWriteResult {
  const v = row(value), status = string(v.status), resource = decodeStructuredResource(v.resource);
  if (!["applied", "invalid", "conflict", "approvalRequired"].includes(status))
    throw new Error("结构化资源写入状态无效");
  const draft = v.draft == null ? undefined : decodeDraft(v.draft), rawReceipt = v.receipt == null ? undefined : row(v.receipt);
  if (status === "applied" && !rawReceipt)
    throw new Error("缺少结构化资源持久写入回执");
  const receipt = rawReceipt ? {
    requestId: string(rawReceipt.requestId),
    resourceId: string(rawReceipt.resourceId),
    revision: revision(rawReceipt.revision),
    contentHash: string(rawReceipt.contentHash)
  } : undefined;
  if (receipt && (receipt.resourceId !== resource.id || receipt.revision !== resource.revision))
    throw new Error("结构化资源写入回执身份不匹配");
  let validationOrigin: StructuredValidationOrigin | undefined;
  if (v.validationOrigin !== undefined) {
    const origin = row(v.validationOrigin), fields = ["requestId", "packageKey", "instanceId", "nativeRequestId"] as const;
    const keys = Reflect.ownKeys(origin), prototype = Object.getPrototypeOf(origin);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== fields.length
      || fields.some(field => !Object.hasOwn(origin, field) || typeof origin[field] !== "string"))
      throw new Error("结构化资源校验身份无效");
    validationOrigin = {requestId: string(origin.requestId), packageKey: string(origin.packageKey),
      instanceId: string(origin.instanceId), nativeRequestId: string(origin.nativeRequestId)};
  }
  return {
    status: status as StructuredWriteResult["status"],
    resource,
    errors: decodeStructuredIssues(v.errors),
    ...(draft ? { draft } : {}),
    ...(receipt ? { receipt } : {}),
    ...(validationOrigin ? { validationOrigin } : {})
  };
}
/** Review ranges use stable field/claim identity, never array positions. */
export function structuredResourceFields(content: unknown): readonly StructuredResourceField[] {
  if (!content || typeof content !== "object" || Array.isArray(content))
    return [];
  const body = content as Record<string, unknown>;
  const template = body.paperTemplate && typeof body.paperTemplate === "object" ? body.paperTemplate as {
    fields?: readonly {
      id: string;
      title: string;
      color?: string;
    }[];
  } : undefined;
  const values = Array.isArray(body.claims) ? body.claims : Array.isArray(body.fields) ? body.fields : [];
  return values.map(value => {
    const v = row(value), id = string(v.id ?? v.field), definition = template?.fields?.find(field => field.id === id), statements = Array.isArray(v.statements) ? v.statements : [];
    const text = typeof v.description === "string" ? v.description : typeof v.question === "string" ? v.question : statements.map(s => string(row(s).text)).join("\n\n");
    return {
      id,
      title: typeof v.title === "string" ? v.title : typeof v.label === "string" ? v.label : definition?.title ?? id,
      value,
      text,
      ...(typeof v.color === "string" ? { color: v.color } : definition?.color ? { color: definition.color } : {})
    };
  });
}
export function replaceStructuredFieldText(content: unknown, fieldId: string, text: string): unknown {
  const body = row(content);
  if (Array.isArray(body.claims))
    return { ...body, claims: body.claims.map(value => {
        const v = row(value);
        return v.id === fieldId ? { ...v, description: text } : value;
      }) };
  if (Array.isArray(body.fields))
    return { ...body, fields: body.fields.map(value => {
        const v = row(value);
        if ((v.field ?? v.id) !== fieldId)
          return value;
        if (typeof v.question === "string")
          return { ...v, question: text };
        const statements = Array.isArray(v.statements) ? v.statements : [];
        if (statements.length === 0)
          throw new Error("此字段尚无来源陈述，请通过 Agent 补充来源后写入。");
        const evidenceItemIds = [...new Set(statements.flatMap(statement => strings(row(statement).evidenceItemIds)))];
        const evidenceQuotes = statements.flatMap(statement => Array.isArray(row(statement).evidenceQuotes) ? row(statement).evidenceQuotes as unknown[] : []);
        return { ...v, statements: [{
              ...row(statements[0]),
              text,
              evidenceItemIds,
              ...(evidenceQuotes.length ? { evidenceQuotes } : {})
            }] };
      }) };
  throw new Error("资源没有可编辑字段");
}
/** Metadata, retained fields and ordering have independent stable review ranges. */
export function structuredResourceDiffFields(content: unknown): readonly StructuredResourceField[] {
  const fields = structuredResourceFields(content);
  if (!content || typeof content !== "object" || Array.isArray(content)) return fields;
  const body = content as Record<string, unknown>;
  const retained = Array.isArray(body.retainedFields) ? structuredResourceFields({
    fields: body.retainedFields, paperTemplate: body.paperTemplate,
  }).map(field => ({...field, id: `$retained:${field.id}`, title: `保留的旧字段 · ${field.title}`})) : [];
  const metadata = Object.fromEntries(Object.entries(content).filter(([key]) =>
    !["claims", "fields", "retainedFields"].includes(key)));
  return [
    ...fields,
    ...retained,
    {id: "$metadata", title: "概况与模板信息", value: metadata, text: JSON.stringify(metadata, null, 2)},
    {id: "$order", title: "字段顺序", value: fields.map(field => field.id),
      text: fields.map(field => field.title).join(" → ")},
  ];
}
