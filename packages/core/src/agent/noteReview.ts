import { decodeNoteDocument, type NoteInlineBlockContentV1 } from "../notes/document";
import { id, row, utf8Length } from "./workspaceDecoding";

export interface AgentNoteReviewScope {
  readonly conversationId: string;
  readonly pageId: string;
  readonly turnId: string;
  readonly itemId: string;
}
export interface AgentNoteRewrite {
  readonly schemaVersion: 1;
  readonly kind: "noteInlineRewrite";
  readonly status: "proposed";
  readonly proposalId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly contextSnapshotId: string;
  readonly sourceId: string;
  readonly pageId: string;
  readonly revision: string;
  readonly anchor: string;
  readonly edits: readonly {
    readonly blockId: string;
    readonly before: NoteInlineBlockContentV1;
    readonly after: NoteInlineBlockContentV1;
  }[];
}
export interface AgentNoteRewriteReview {
  readonly schemaVersion: 1;
  readonly scope: AgentNoteReviewScope;
  readonly proposal: AgentNoteRewrite;
  readonly currentRevision: number;
  readonly baselineMatches: boolean;
}
export class AgentNoteReviewDecodeError extends Error {
  constructor() { super("Invalid or mismatched note rewrite review"); this.name = "AgentNoteReviewDecodeError"; }
}
function fail(): never { throw new AgentNoteReviewDecodeError(); }
function revision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function blockId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || utf8Length(value) > 128) return fail();
  return value;
}
export function decodeAgentNoteReviewScope(value: unknown): AgentNoteReviewScope {
  try {
    const r = row(value, ["conversationId", "pageId", "turnId", "itemId"]);
    return { conversationId:id(r.conversationId), pageId:id(r.pageId), turnId:id(r.turnId), itemId:id(r.itemId) };
  } catch { return fail(); }
}
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b,key) && sameJson(a[key],b[key]));
}
function inline(value: unknown, pageId: string, blockId: string): NoteInlineBlockContentV1 {
  const document = decodeNoteDocument({schemaVersion:1,pageId,blocks:[{id:blockId,type:"paragraph",props:{},content:value,children:[]}]});
  const decoded = document.blocks[0]?.content;
  if (decoded?.kind !== "inline" || !sameJson(decoded,value)) return fail();
  return decoded;
}
function references(content: NoteInlineBlockContentV1): string[] {
  return content.items.flatMap(item=>item.type==="link" ? [JSON.stringify(["link",item.href])]
    : item.type==="mention" ? [JSON.stringify(["mention",item.targetKind,item.targetId])] : []).sort();
}
/** Strict presentation data only. Native review rederives the result from the
 * completed tool call; displaying a proposal does not authorize application. */
export function decodeAgentNoteRewriteReview(value: unknown, expected: AgentNoteReviewScope): AgentNoteRewriteReview {
  try {
    const scope = decodeAgentNoteReviewScope(expected);
    const r = row(value,["schemaVersion","scope","proposal","currentRevision","baselineMatches"]);
    if (r.schemaVersion !== 1 || !sameJson(decodeAgentNoteReviewScope(r.scope),scope) || typeof r.baselineMatches !== "boolean") return fail();
    const currentRevision = revision(r.currentRevision);
    const p = row(r.proposal,["schemaVersion","kind","status","proposalId","conversationId","turnId","contextSnapshotId","sourceId","pageId","revision","anchor","edits"]);
    if (utf8Length(JSON.stringify(p)) > 128*1024 || p.schemaVersion !== 1 || p.kind !== "noteInlineRewrite" || p.status !== "proposed"
      || p.conversationId !== scope.conversationId || p.pageId !== scope.pageId || p.turnId !== scope.turnId
      || typeof p.proposalId !== "string" || !/^note-rewrite:[0-9a-f]{64}$/.test(p.proposalId)
      || typeof p.sourceId !== "string" || !/^note:[0-9a-f]{64}$/.test(p.sourceId)
      || typeof p.revision !== "string" || !/^revision:(0|[1-9][0-9]*):sha256:[0-9a-f]{64}$/.test(p.revision)
      || typeof p.anchor !== "string" || !Array.isArray(p.edits) || !p.edits.length || p.edits.length > 32) return fail();
    const anchor = row(JSON.parse(p.anchor),["schemaVersion","pageId","pageRevision","blockId"]);
    const pageRevision = revision(Number(p.revision.split(":")[1]));
    if (anchor.schemaVersion !== 1 || anchor.pageId !== scope.pageId || anchor.pageRevision !== pageRevision
      || (anchor.blockId !== null && blockId(anchor.blockId) !== anchor.blockId)
      || (r.baselineMatches && currentRevision !== pageRevision)) return fail();
    const seen = new Set<string>();
    const edits = p.edits.map(value => {
      const e = row(value,["blockId","before","after"]);
      const target = blockId(e.blockId);
      if (seen.has(target)) return fail();
      seen.add(target);
      const before = inline(e.before,scope.pageId,target), after = inline(e.after,scope.pageId,target);
      if (sameJson(before,after) || !sameJson(references(before),references(after))) return fail();
      return {blockId:target,before,after};
    });
    return {schemaVersion:1,scope,currentRevision,baselineMatches:r.baselineMatches,proposal:{
      schemaVersion:1,kind:"noteInlineRewrite",status:"proposed",proposalId:p.proposalId,
      conversationId:scope.conversationId,turnId:scope.turnId,contextSnapshotId:id(p.contextSnapshotId),
      sourceId:p.sourceId,pageId:scope.pageId,revision:p.revision,anchor:p.anchor,edits,
    }};
  } catch { return fail(); }
}
