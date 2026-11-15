import { AiSchemaError, assertOnlyKeys, expectArray, expectRecord, expectRequiredInteger, expectRequiredString } from "./schemaSupport";
import { decodeReadingFieldColor, type PortraitTemplateField } from "./paperPortrait";
import type { AiCandidate } from "./review";

/** Explicit adoption wins; otherwise a saved model suggestion can drive extraction without review. */
export function selectPaperPortraitTemplate(candidates: readonly AiCandidate[], paperId: string): {
  readonly candidate: AiCandidate; readonly revision: number; readonly isConfirmed: boolean;
} | undefined {
  const eligible = candidates.filter(candidate => candidate.candidateKind === "paper_portrait_v1"
    && candidate.validationStatus === "valid" && candidate.reviewState !== "rejected"
    && candidate.evidenceBundle.items.length > 0 && candidate.evidenceBundle.items.every(source => source.paperId === paperId));
  const confirmed = eligible.flatMap(candidate => candidate.decisions.filter(decision => ["accept_unchanged", "accept_after_edit"].includes(decision.action))
    .map(decision => ({ candidate, decision })))
    .sort((a, b) => b.decision.createdAt.localeCompare(a.decision.createdAt) || b.decision.id.localeCompare(a.decision.id))[0];
  if (confirmed !== undefined) return { candidate: confirmed.candidate, revision: confirmed.decision.candidateRevision, isConfirmed: true };
  const suggested = eligible.filter(candidate => ["unreviewed", "edited"].includes(candidate.reviewState))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  return suggested === undefined ? undefined : { candidate: suggested, revision: suggested.currentRevision, isConfirmed: false };
}

export type PaperTemplateRef = { readonly portraitCandidateId: string; readonly portraitRevision: number }
  | { readonly templateResourceId: string; readonly templateResourceRevision: number };

export function paperTemplateRevision(reference: PaperTemplateRef): number { return "templateResourceId" in reference ? reference.templateResourceRevision : reference.portraitRevision; }
export function paperTemplateIdentity(reference: PaperTemplateRef): string { return "templateResourceId" in reference ? `resource:${reference.templateResourceId}:${reference.templateResourceRevision}` : `portrait:${reference.portraitCandidateId}:${reference.portraitRevision}`; }

/** An immutable per-run definition, separate from extracted reading content. */
export type PaperTemplateSnapshot = PaperTemplateRef & { readonly fields: readonly PortraitTemplateField[] };

export function decodePaperTemplateSnapshot(input: unknown): PaperTemplateSnapshot {
  const value = expectRecord(input, "$.paperTemplate", "paper template");
  const resource = "templateResourceId" in value;
  assertOnlyKeys(value, resource ? ["templateResourceId", "templateResourceRevision", "fields"] : ["portraitCandidateId", "portraitRevision", "fields"], "$.paperTemplate");
  const reference: PaperTemplateRef = resource ? {templateResourceId:expectRequiredString(value,"templateResourceId","$.paperTemplate",200),templateResourceRevision:expectRequiredInteger(value,"templateResourceRevision","$.paperTemplate",1,1_000_000)} : {portraitCandidateId:expectRequiredString(value,"portraitCandidateId","$.paperTemplate",200),portraitRevision:expectRequiredInteger(value,"portraitRevision","$.paperTemplate",1,1_000_000)};
  const raw = expectArray(value.fields, "$.paperTemplate.fields");
  if (raw.length < 1 || raw.length > 20) throw new AiSchemaError("limit_exceeded", "$.paperTemplate.fields", "1–20 fields required");
  const seen = new Set<string>();
  const fields = raw.map((entry, index): PortraitTemplateField => {
    const path = `$.paperTemplate.fields[${index}]`;
    const field = expectRecord(entry, path, "template field");
    assertOnlyKeys(field, ["id", "title", "question", "claimIds", "color"], path);
    const id = expectRequiredString(field, "id", path, 64);
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || seen.has(id)) throw new AiSchemaError("duplicate_id", path, "invalid or duplicate field id");
    seen.add(id);
    const claimIds = expectArray(field.claimIds ?? (resource ? [] : undefined), path);
    if (claimIds.length > 24 || claimIds.some(id => typeof id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(id)) || new Set(claimIds).size !== claimIds.length) throw new AiSchemaError("invalid_value", path, "invalid claim references");
    return { id, title: expectRequiredString(field, "title", path, 120), question: expectRequiredString(field, "question", path, 1000), claimIds: claimIds as string[], ...(field.color === undefined ? {} : { color: decodeReadingFieldColor(field.color)! }) };
  });
  return { ...reference, fields };
}

export function overviewFieldTitle(payload: { readonly paperTemplate?: PaperTemplateSnapshot }, field: string): string {
  return payload.paperTemplate?.fields.find(value => value.id === field)?.title ?? ({
    research_question: "研究问题", approach: "方法／论证路径", key_result: "关键结果", conclusion: "结论",
    limitation: "局限", open_question: "开放问题", argument: "核心论证", objection: "异议／反例", response: "回应",
  } as Readonly<Record<string, string>>)[field] ?? field;
}
