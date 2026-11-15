import { nalConceptKind } from "./conceptKinds";
/** Source facts use atoms/products; query patterns also admit recursive statement structure. */
export type NalAtom = { readonly kind: "concept" | "paper"; readonly id: string };
export type NalTerm = NalAtom | { readonly kind: "product"; readonly terms: readonly NalTerm[] };
export type NalPattern = NalAtom | { readonly kind: "variable"; readonly name: string }
  // `compound` represents an unset connector in an unfinished editor draft.
  | { readonly kind: "compound" | "product" | "conjunction" | "disjunction"; readonly terms: readonly NalPattern[] }
  | ({ readonly kind: "statement" } & NalQuery);
export type NalCopula = "inheritance" | "implication";
export type NalConceptKind = "ordinary" | "relation";
export interface NalConcept { readonly id: string; readonly label: string; readonly explanation: string; readonly revision: number; readonly conceptKind?: NalConceptKind }
export interface NalStatement {
  readonly id: string;
  readonly subject: NalTerm;
  readonly predicate: NalTerm;
  readonly origin: "human" | "legacy";
}
export interface NalAnnotation {
  readonly id: string;
  readonly targetKind: "concept" | "statement";
  readonly targetId: string;
  readonly notePageId: string;
}
/** Explicit instance of R(y,z) ∧ R(x,y) ⇒ R(x,z), for one relation identity. */
export interface NalRule {
  readonly id: string;
  readonly kind: "transitive";
  readonly relationConceptId: string;
}
export interface NalState {
  readonly revision: number;
  readonly concepts: readonly NalConcept[];
  readonly statements: readonly NalStatement[];
  readonly annotations: readonly NalAnnotation[];
  readonly rules: readonly NalRule[];
}
/** Missing copula is legacy inheritance; null exists only in an unfinished editor draft. */
export interface NalQuery { readonly copula?: NalCopula | null; readonly subject: NalPattern; readonly predicate: NalPattern }
export interface NalQueryGroup {
  readonly kind:"group";
  readonly connector:"conjunction"|"disjunction";
  readonly children:readonly NalQueryBlock[];
}
export type NalQueryBlock = NalQuery | NalQueryGroup;
export type NalMutation =
  | { readonly kind: "delete_concept"; readonly id: string }
  | { readonly kind: "add_statements"; readonly statements: readonly NalStatement[] }
  | { readonly kind: "delete_statement"; readonly id: string }
  | { readonly kind: "link_annotation"; readonly annotation: NalAnnotation }
  | { readonly kind: "unlink_annotation"; readonly id: string }
  | { readonly kind: "set_concept_kind"; readonly conceptId: string; readonly conceptKind: NalConceptKind }
  | NalRuleMutation;
export type NalRuleMutation = { readonly kind: "set_transitivity"; readonly relationConceptId: string; readonly enabled: boolean };
export const emptyNalState = (): NalState => ({revision:0,concepts:[],statements:[],annotations:[],rules:[]});
export const nalTermKey = (term: NalPattern): string => "terms" in term
  ? JSON.stringify([term.kind,term.kind === "product" ? term.terms.map(nalTermKey) : term.terms.map(nalTermKey).sort()]) : term.kind === "statement"
    ? JSON.stringify(["statement",term.copula ?? "inheritance",nalTermKey(term.subject),nalTermKey(term.predicate)])
    : JSON.stringify([term.kind,term.kind === "variable" ? term.name : term.id]);
export function nalAtoms(term: NalPattern): readonly NalAtom[] {
  if ("terms" in term) return term.terms.flatMap(nalAtoms);
  if (term.kind === "statement") return [...nalAtoms(term.subject),...nalAtoms(term.predicate)];
  return term.kind === "variable" ? [] : [term];
}
export function validateNalTerm(value: unknown, depth = 0, budget = {remaining:16000}): asserts value is NalTerm {
  if (--budget.remaining < 0)throw new Error("词项结构过大");
  if (!value || typeof value !== "object" || depth > 12) throw new Error("NAL 词项结构无效或嵌套过深");
  const t = value as Record<string, unknown>;
  if (t.kind === "product") {
    if (!Array.isArray(t.terms) || t.terms.length < 2 || t.terms.length > 16) throw new Error("乘积需要 2–16 个有序词项");
    t.terms.forEach(v=>validateNalTerm(v,depth+1,budget));
  } else if ((t.kind !== "concept" && t.kind !== "paper") || typeof t.id !== "string" || !t.id.trim() || t.id.length > 200) throw new Error("NAL 原子词项无效");
}
export function applyNalMutation(state: NalState, mutation: NalMutation, expectedRevision: number): NalState {
  if (state.revision !== expectedRevision) throw new Error("关系已变化，请刷新后重试");
  let {statements, annotations} = state;
  const concepts = new Set(state.concepts.map(c=>c.id));
  if (mutation.kind === "delete_concept") {
    if (!concepts.has(mutation.id)) throw new Error("概念已不存在，请刷新");
    const statements=state.statements.filter(s=>![...nalAtoms(s.subject),...nalAtoms(s.predicate)].some(a=>a.kind === "concept" && a.id === mutation.id));
    const retained=new Set(statements.map(s=>s.id));
    return {...state,revision:state.revision+1,concepts:state.concepts.filter(c=>c.id !== mutation.id),statements,
      rules:state.rules.filter(r=>r.relationConceptId !== mutation.id),annotations:state.annotations.filter(a=>a.targetKind === "concept" ? a.targetId !== mutation.id : retained.has(a.targetId))};
  }
  if (mutation.kind === "set_concept_kind") {
    if (!concepts.has(mutation.conceptId) || !["ordinary","relation"].includes(mutation.conceptKind)) throw new Error("概念类型无效");
    if (mutation.conceptKind === "ordinary" && (state.rules.some(r=>r.relationConceptId === mutation.conceptId) || state.statements.some(s=>s.subject.kind === "product" && s.predicate.kind === "concept" && s.predicate.id === mutation.conceptId))) throw new Error("该概念已用作关系；请先移除相关关系语句和规则");
    return {...state,revision:state.revision+1,concepts:state.concepts.map(c=>c.id === mutation.conceptId ? {...c,conceptKind:mutation.conceptKind} : c)};
  }
  if (mutation.kind === "set_transitivity") {
    if (!concepts.has(mutation.relationConceptId) || typeof mutation.enabled !== "boolean") throw new Error("规则对应的关系概念无效");
    const concept=state.concepts.find(c=>c.id === mutation.relationConceptId)!;
    if (mutation.enabled && nalConceptKind(concept,state) !== "relation") throw new Error("只有关系概念可以定义传递规则");
    const rules = state.rules.filter(r=>r.relationConceptId !== mutation.relationConceptId);
    if (mutation.enabled) rules.push({id:`transitive:${mutation.relationConceptId}`,kind:"transitive",relationConceptId:mutation.relationConceptId});
    return {...state,revision:state.revision+1,rules};
  }
  if (mutation.kind === "add_statements") {
    if (!mutation.statements.length || mutation.statements.length > 500) throw new Error("每次添加 1–500 条语句");
    const seen = new Set(statements.map(s=>`${nalTermKey(s.subject)}→${nalTermKey(s.predicate)}`));
    for (const statement of mutation.statements) {
      if (!statement.id.trim() || statement.id.length > 200 || statement.origin !== "human") throw new Error("新语句身份或来源无效");
      validateNalTerm(statement.subject); validateNalTerm(statement.predicate);
      for (const a of [...nalAtoms(statement.subject),...nalAtoms(statement.predicate)]) if (a.kind === "concept" && !concepts.has(a.id)) throw new Error("概念不存在，请刷新");
      const key = `${nalTermKey(statement.subject)}→${nalTermKey(statement.predicate)}`;
      if (seen.has(key)) continue;
      if (statements.some(s=>s.id === statement.id)) throw new Error("语句身份冲突");
      statements = [...statements,statement]; seen.add(key);
    }
  } else if (mutation.kind === "delete_statement") {
    if (!statements.some(s=>s.id === mutation.id)) throw new Error("语句已不存在");
    statements = statements.filter(s=>s.id !== mutation.id);
    annotations = annotations.filter(a=>a.targetKind !== "statement" || a.targetId !== mutation.id);
  } else if (mutation.kind === "link_annotation") {
    const a = mutation.annotation;
    if (!a.id || !a.notePageId || !["concept","statement"].includes(a.targetKind)) throw new Error("笔记关联无效");
    if (a.targetKind === "concept" ? !concepts.has(a.targetId) : !statements.some(s=>s.id === a.targetId)) throw new Error("笔记目标已不存在");
    if (annotations.some(v=>v.id === a.id && JSON.stringify(v) !== JSON.stringify(a))) throw new Error("笔记关联身份冲突");
    if (annotations.some(v=>v.targetKind === a.targetKind && v.targetId === a.targetId && v.notePageId !== a.notePageId)) throw new Error("每个概念或语句只能关联一份笔记");
    if (!annotations.some(v=>v.targetKind === a.targetKind && v.targetId === a.targetId && v.notePageId === a.notePageId)) annotations = [...annotations,a];
  } else annotations = annotations.filter(a=>a.id !== mutation.id);
  return {...state,revision:state.revision+1,statements,annotations};
}
export { queryNal, type NalMatch } from "./query";
export { inferNal, INHERITANCE_RULE_ID } from "./inference";
export { formatNalTransitivityRule } from "./rules";
export { nalConceptKind, normalizeNalConceptKinds } from "./conceptKinds";
export { parseNal, formatNalTerm, formatNalStatement, type NalVocabulary } from "./syntax";
export { decodeNalState, decodeNalAnnotation } from "./schema";
export { NalInferenceCache, nalFactKey, type NalFact, type NalInferenceSnapshot } from "./inference";
export { NalQueryCollections, type NalQueryCollection, type NalQueryCacheSnapshot, type NalCollectionResult } from "./queryCollections";
export { parseNalConditions, formatNalConditions } from "./querySyntax";
export { decodeNalQueryDefinitions, decodeNalQueryCache } from "./queryCacheSchema";
export { validateNalPattern, validateNalQuery, nalQueryVariables } from "./queryPatterns";
export { isNalQueryGroup, nalQueryLeaves, validateNalQueryBlocks } from "./queryBlocks";
