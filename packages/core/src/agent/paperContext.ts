import { row, utf8Length } from "./workspaceDecoding";

export interface AgentPaperContextRequest {
  readonly paperId: string;
  readonly snapshotId: string;
  readonly expectedContextHash: string;
}
export interface AgentPaperContextPrepareRequest {
  readonly paperId: string;
  readonly attachmentIds: readonly string[];
  readonly imageAssets?: readonly { readonly contextItemId: string; readonly dataUrl: string }[];
}
export interface AgentPaperContextPreparation {
  readonly schemaVersion: 1;
  readonly paperId: string;
  readonly snapshotId: string;
  readonly contextHash: string;
}
export interface AgentPaperContextAttachment {
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly parseRunId: string;
  readonly ordinal: number;
}
export interface AgentPaperContextItem {
  readonly sourceId: string;
  /** Display alias in this snapshot, not a globally unique source identity. */
  readonly id: string;
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly parseRunId: string;
  readonly rawRef: string;
  readonly kind: "text" | "table" | "picture" | "group" | "key_value" | "form" | "field" | "field_region";
  readonly label: string | null;
  readonly pageIndex: number | null;
  readonly regions: readonly { readonly pageIndex: number; readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } }[];
  readonly charspan: readonly [number, number] | null;
  readonly sourceTextHash: string | null;
  readonly text: string | null;
  readonly tableJson: unknown;
  /** Required image reference when present; null does not mean a text-only source.
   * A manifest neither carries the bytes nor proves their present availability. */
  readonly imageContentSha256: string | null;
}
export interface AgentPaperContextPreview {
  readonly schemaVersion: 1;
  readonly paperId: string;
  readonly snapshotId: string;
  readonly contextHash: string;
  readonly attachments: readonly AgentPaperContextAttachment[];
  readonly items: readonly AgentPaperContextItem[];
}
function fail(): never { throw new Error("Invalid or unsupported paper context preview"); }
function identity(value: unknown, max = 1024): string {
  if (typeof value !== "string" || !value.trim() || utf8Length(value) > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return fail();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return fail();
  return value;
}
function page(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) return fail();
  return value;
}
function text(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return fail();
  utf8Length(value);
  return value;
}
export function decodeAgentPaperContextRequest(value: unknown): AgentPaperContextRequest {
  const r = row(value, ["paperId", "snapshotId", "expectedContextHash"]);
  const expectedContextHash = hash(r.expectedContextHash);
  if (r.snapshotId !== `paper-context-${expectedContextHash}`) return fail();
  return { paperId: identity(r.paperId), snapshotId: r.snapshotId, expectedContextHash };
}
export function decodeAgentPaperContextPrepareRequest(value: unknown): AgentPaperContextPrepareRequest {
  const hasImages = !!value && typeof value === "object" && Object.hasOwn(value, "imageAssets");
  const r = row(value, ["paperId", "attachmentIds", ...(hasImages ? ["imageAssets"] : [])]);
  if (!Array.isArray(r.attachmentIds) || r.attachmentIds.length > 64) return fail();
  const attachmentIds = r.attachmentIds.map((value) => identity(value));
  if (new Set(attachmentIds).size !== attachmentIds.length) return fail();
  let imageAssets: AgentPaperContextPrepareRequest["imageAssets"];
  if (hasImages) {
    if (!Array.isArray(r.imageAssets) || r.imageAssets.length > 128) return fail();
    imageAssets = r.imageAssets.map((asset) => {
      const image = row(asset, ["contextItemId", "dataUrl"]);
      if (typeof image.contextItemId !== "string" || !image.contextItemId.trim() || utf8Length(image.contextItemId) > 256
        || typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/png;base64,") || utf8Length(image.dataUrl) > 28 * 1024 * 1024) return fail();
      return { contextItemId: image.contextItemId, dataUrl: image.dataUrl };
    });
    if (new Set(imageAssets.map((asset) => asset.contextItemId)).size !== imageAssets.length) return fail();
  }
  return { paperId: identity(r.paperId), attachmentIds, ...(imageAssets === undefined ? {} : { imageAssets }) };
}
export function decodeAgentPaperContextPreparation(value: unknown, expected: AgentPaperContextPrepareRequest): AgentPaperContextPreparation {
  const request = decodeAgentPaperContextPrepareRequest(expected);
  const r = row(value, ["schemaVersion", "paperId", "snapshotId", "contextHash"]);
  const contextHash = hash(r.contextHash);
  if (r.schemaVersion !== 1 || r.paperId !== request.paperId || r.snapshotId !== `paper-context-${contextHash}`) return fail();
  return { schemaVersion: 1, paperId: request.paperId, snapshotId: r.snapshotId as string, contextHash };
}
function item(value: unknown): AgentPaperContextItem {
  const r = row(value, ["sourceId", "id", "attachmentId", "contentSha256", "parseRunId", "rawRef", "kind", "label", "pageIndex", "regions", "charspan", "sourceTextHash", "text", "tableJson", "imageContentSha256"]);
  if (typeof r.sourceId !== "string" || !/^paper-source:[0-9a-f]{64}$/.test(r.sourceId)
    || typeof r.kind !== "string" || !["text", "table", "picture", "group", "key_value", "form", "field", "field_region"].includes(r.kind)
    || !Array.isArray(r.regions) || r.regions.length > 20_000) return fail();
  const regions = r.regions.map(value => {
    const region = row(value, ["pageIndex", "rect"]), rect = row(region.rect, ["x", "y", "width", "height"]);
    const { x, y, width, height } = rect;
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number"
      || ![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > 1.000001 || y + height > 1.000001) return fail();
    return { pageIndex: page(region.pageIndex), rect: { x, y, width, height } };
  });
  let charspan: [number, number] | null = null;
  if (r.charspan !== null) {
    if (!Array.isArray(r.charspan) || r.charspan.length !== 2) return fail();
    charspan = [page(r.charspan[0]), page(r.charspan[1])];
    if (charspan[0] > charspan[1]) return fail();
  }
  return { sourceId: r.sourceId, id: identity(r.id, 80), attachmentId: identity(r.attachmentId),
    contentSha256: hash(r.contentSha256), parseRunId: identity(r.parseRunId), rawRef: identity(r.rawRef),
    kind: r.kind as AgentPaperContextItem["kind"], label: text(r.label), pageIndex: r.pageIndex === null ? null : page(r.pageIndex),
    regions, charspan, sourceTextHash: r.sourceTextHash === null ? null : hash(r.sourceTextHash), text: text(r.text),
    tableJson: JSON.parse(JSON.stringify(r.tableJson)), imageContentSha256: r.imageContentSha256 === null ? null : hash(r.imageContentSha256) };
}

/** Full source manifest; intentionally not assignable to a text SubmissionInput. */
export function decodeAgentPaperContextPreview(value: unknown, expected: AgentPaperContextRequest): AgentPaperContextPreview {
  const request = decodeAgentPaperContextRequest(expected);
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string" || utf8Length(encoded) > 8 * 1024 * 1024) return fail();
  const r = row(value, ["schemaVersion", "paperId", "snapshotId", "contextHash", "attachments", "items"]);
  if (r.schemaVersion !== 1 || r.paperId !== request.paperId || r.snapshotId !== request.snapshotId || r.contextHash !== request.expectedContextHash
    || !Array.isArray(r.attachments) || r.attachments.length === 0 || r.attachments.length > 64 || !Array.isArray(r.items) || r.items.length > 20_000) return fail();
  const attachments = r.attachments.map((value, ordinal) => {
    const a = row(value, ["attachmentId", "contentSha256", "parseRunId", "ordinal"]);
    if (a.ordinal !== ordinal) return fail();
    return { attachmentId: identity(a.attachmentId), contentSha256: hash(a.contentSha256), parseRunId: identity(a.parseRunId), ordinal };
  });
  const byId = new Map(attachments.map(a => [a.attachmentId, a]));
  if (byId.size !== attachments.length) return fail();
  const items = r.items.map(item);
  if (new Set(items.map(i => i.id)).size !== items.length || new Set(items.map(i => i.sourceId)).size !== items.length) return fail();
  for (const source of items) {
    const attachment = byId.get(source.attachmentId);
    if (!attachment || attachment.contentSha256 !== source.contentSha256 || attachment.parseRunId !== source.parseRunId) return fail();
  }
  return { schemaVersion: 1, paperId: request.paperId, snapshotId: request.snapshotId, contextHash: request.expectedContextHash, attachments, items };
}
