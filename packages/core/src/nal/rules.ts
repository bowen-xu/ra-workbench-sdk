import { formatNalTerm, type NalVocabulary, type NalFormatOptions } from "./syntax";

/** Rendering of the typed binary rule; this is not an arbitrary implication parser. */
export function formatNalTransitivityRule(relationConceptId: string, vocabulary: readonly NalVocabulary[], options: NalFormatOptions = {}): string {
  const relation = formatNalTerm({kind:"concept",id:relationConceptId},vocabulary,options);
  return `($y × $z) → ${relation} && ($x × $y) → ${relation} |- ($x × $z) → ${relation}`;
}
