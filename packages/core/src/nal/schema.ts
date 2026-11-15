import { validateNalTerm, normalizeNalConceptKinds, type NalState, type NalAnnotation } from "./index";
export function decodeNalAnnotation(value: unknown): NalAnnotation {
  if(!value || typeof value !== "object")throw new Error("笔记关联格式无效");
  const a=value as NalAnnotation;
  if(![a.id,a.targetId,a.notePageId].every(v=>typeof v === "string" && v.trim().length>0) || !["concept","statement"].includes(a.targetKind))throw new Error("笔记关联格式无效");
  return a;
}
export function decodeNalState(value: unknown): NalState {
  if (!value || typeof value !== "object") throw new Error("关系数据格式无效");
  const v = value as NalState;
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.concepts) || !Array.isArray(v.statements) || !Array.isArray(v.annotations)) throw new Error("关系数据格式无效");
  const string = (s: unknown): s is string => typeof s === "string" && s.length > 0;
  for (const c of v.concepts) if (!string(c.id) || !string(c.label) || typeof c.explanation !== "string" || !Number.isSafeInteger(c.revision)) throw new Error("概念格式无效");
  for (const c of v.concepts) if (c.conceptKind !== undefined && !["ordinary","relation"].includes(c.conceptKind)) throw new Error("概念类型无效");
  for (const s of v.statements) {
    if (!string(s.id) || !["human","legacy"].includes(s.origin)) throw new Error("语句格式无效");
    validateNalTerm(s.subject); validateNalTerm(s.predicate);
  }
  for (const a of v.annotations) decodeNalAnnotation(a);
  const rules = v.rules ?? [];
  if (!Array.isArray(rules) || rules.some(r=>!string(r.id) || r.kind !== "transitive" || !v.concepts.some(c=>c.id === r.relationConceptId))) throw new Error("关系规则格式无效");
  if (new Set(rules.map(r=>r.relationConceptId)).size !== rules.length) throw new Error("关系规则重复");
  const normalized=normalizeNalConceptKinds({...v,rules});
  if (rules.some(r=>normalized.concepts.find(c=>c.id === r.relationConceptId)?.conceptKind !== "relation")) throw new Error("普通概念不能持有关系规则");
  return normalized;
}
