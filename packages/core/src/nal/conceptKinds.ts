import type { NalConcept, NalConceptKind, NalState } from "./index";

/** Compatibility for untyped records only; explicit user classifications always win. */
export function nalConceptKind(concept: NalConcept, state: Pick<NalState,"statements"|"rules">): NalConceptKind {
  if (concept.conceptKind) return concept.conceptKind;
  return state.rules.some(r=>r.relationConceptId === concept.id)
    || state.statements.some(s=>s.subject.kind === "product" && s.predicate.kind === "concept" && s.predicate.id === concept.id)
    ? "relation" : "ordinary";
}

export function normalizeNalConceptKinds(state: NalState): NalState {
  return {...state,concepts:state.concepts.map(c=>({...c,conceptKind:nalConceptKind(c,state)}))};
}
