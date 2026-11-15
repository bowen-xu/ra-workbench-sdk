import { nalAtoms, nalTermKey, type NalRule, type NalState, type NalStatement, type NalTerm, type NalQuery } from "./index";

export interface NalFact {
  readonly id: string;
  readonly subject: NalTerm;
  readonly predicate: NalTerm;
  readonly statementIds: readonly string[];
  readonly ruleIds: readonly string[];
  readonly derived: boolean;
}
export interface NalInferenceSnapshot {
  readonly statements: readonly NalStatement[];
  readonly rules: readonly NalRule[];
  readonly facts: readonly NalFact[];
}
export interface NalFactDelta {
  readonly removed: readonly NalFact[];
  readonly changed: readonly NalFact[];
  readonly joins: number;
}
export const INHERITANCE_RULE_ID = "builtin:inheritance-transitivity";
export const nalFactKey = (f: NalQuery): string => JSON.stringify([...(f.copula === "implication" ? ["implication"] : []),nalTermKey(f.subject), nalTermKey(f.predicate)]);
const unique = (values: readonly string[]) => [...new Set(values)];
type Index = Map<string, NalFact[]>;
function index(map: Index, key: string, fact: NalFact): void {
  const values = map.get(key) ?? [];
  values.push(fact);
  map.set(key, values);
}

/** Indexed insertion and proof-directed delete/rederive; publishes only a complete fixed point.
 * Deletion follows DRed: invalidate witnesses, seek alternative proofs for the affected
 * conclusions, then propagate the recovered/new facts. No argument substitution is used.
 */
export class NalInferenceCache {
  private snapshot: NalInferenceSnapshot;
  constructor(snapshot: NalInferenceSnapshot = { statements: [], rules: [], facts: [] }) {
    this.snapshot = snapshot;
  }
  export(): NalInferenceSnapshot { return this.snapshot; }
  sync(state: NalState, activePapers?: ReadonlySet<string>): NalFactDelta {
    const statements = state.statements.filter(s => !activePapers || [...nalAtoms(s.subject), ...nalAtoms(s.predicate)]
      .every(a => a.kind !== "paper" || activePapers.has(a.id)));
    const old = this.snapshot;
    // Labels, annotations and unrelated catalog changes do not cause inference work.
    if (JSON.stringify(statements) === JSON.stringify(old.statements) && JSON.stringify(state.rules) === JSON.stringify(old.rules)) {
      return { removed: [], changed: [], joins: 0 };
    }
    const currentStatements = new Map(statements.map(s => [s.id, JSON.stringify(s)]));
    const removedStatements = new Set(old.statements.filter(s => currentStatements.get(s.id) !== JSON.stringify(s)).map(s => s.id));
    const currentRules = new Map(state.rules.map(r => [r.id, JSON.stringify(r)]));
    const removedRules = new Set(old.rules.filter(r => currentRules.get(r.id) !== JSON.stringify(r)).map(r => r.id));
    const affected = old.facts.filter(f => f.statementIds.some(id => removedStatements.has(id)) || f.ruleIds.some(id => removedRules.has(id)));
    const affectedKeys = new Set(affected.map(nalFactKey));
    const facts = new Map(old.facts.filter(f => !affectedKeys.has(nalFactKey(f))).map(f => [nalFactKey(f), f]));
    const agenda: NalFact[] = [];
    const subjects: Index = new Map(), predicates: Index = new Map();
    const binary = new Map(state.rules.map(rule => [rule.relationConceptId, { first: new Map() as Index, second: new Map() as Index, rule }]));
    const register = (fact: NalFact) => {
      index(subjects, nalTermKey(fact.subject), fact);
      index(predicates, nalTermKey(fact.predicate), fact);
      if (fact.subject.kind === "product" && fact.subject.terms.length === 2 && fact.predicate.kind === "concept") {
        const entry = binary.get(fact.predicate.id);
        if (entry) {
          index(entry.first, nalTermKey(fact.subject.terms[0]!), fact);
          index(entry.second, nalTermKey(fact.subject.terms[1]!), fact);
        }
      }
    };
    for (const fact of facts.values()) register(fact);
    const add = (fact: NalFact) => {
      const key = nalFactKey(fact);
      const existing = facts.get(key);
      if (existing) {
        // An explicit assertion is an independent support for a previously derived fact.
        if (!fact.derived && existing.derived) facts.set(key, fact);
        return;
      }
      if (facts.size >= 20_000) throw new Error("关系推导超过 20000 条结果，请减少关系范围或停用不需要的传递规则");
      facts.set(key, fact); agenda.push(fact); register(fact);
    };
    for (const s of statements) add({ ...s, statementIds: [s.id], ruleIds: [], derived: false });
    let joins = 0;
    const derive = (subject: NalTerm, predicate: NalTerm, a: NalFact, b: NalFact, ruleId: string) => {
      if (++joins > 200_000) throw new Error("关系推导计算量超过上限，请停用不需要的传递规则后重试");
      if (ruleId === INHERITANCE_RULE_ID && nalTermKey(subject) === nalTermKey(predicate)) return;
      const value = { subject, predicate };
      add({ ...value, id: `derived:${nalFactKey(value)}`, statementIds: unique([...a.statementIds, ...b.statementIds]),
        ruleIds: unique([...a.ruleIds, ...b.ruleIds, ruleId]), derived: true });
    };
    // Match rule heads against only overdeleted conclusions. This finds alternate
    // witnesses without repeating every join in the unaffected materialisation.
    for (const target of affected) {
      if (facts.has(nalFactKey(target))) continue;
      for (const left of [...(subjects.get(nalTermKey(target.subject)) ?? [])]) {
        const right = facts.get(nalFactKey({ subject: left.predicate, predicate: target.predicate }));
        if (right) derive(target.subject, target.predicate, left, right, INHERITANCE_RULE_ID);
      }
      if (target.subject.kind !== "product" || target.subject.terms.length !== 2 || target.predicate.kind !== "concept") continue;
      const entry = binary.get(target.predicate.id);
      if (!entry) continue;
      const [x, z] = target.subject.terms as readonly [NalTerm, NalTerm];
      for (const left of [...(entry.first.get(nalTermKey(x)) ?? [])]) {
        if (left.subject.kind !== "product") continue;
        const right = facts.get(nalFactKey({ subject: { kind: "product", terms: [left.subject.terms[1]!, z] }, predicate: target.predicate }));
        if (right) derive(target.subject, target.predicate, left, right, entry.rule.id);
      }
    }
    const oldRules = new Map(old.rules.map(r => [r.id, JSON.stringify(r)]));
    for (const rule of state.rules) if (oldRules.get(rule.id) !== JSON.stringify(rule)) {
      for (const f of facts.values()) if (f.predicate.kind === "concept" && f.predicate.id === rule.relationConceptId) agenda.push(f);
    }
    for (let at = 0; at < agenda.length; at++) {
      const fact = agenda[at]!;
      for (const after of [...(subjects.get(nalTermKey(fact.predicate)) ?? [])]) derive(fact.subject, after.predicate, fact, after, INHERITANCE_RULE_ID);
      for (const before of [...(predicates.get(nalTermKey(fact.subject)) ?? [])]) derive(before.subject, fact.predicate, before, fact, INHERITANCE_RULE_ID);
      if (fact.subject.kind !== "product" || fact.subject.terms.length !== 2 || fact.predicate.kind !== "concept") continue;
      const entry = binary.get(fact.predicate.id);
      if (!entry) continue;
      const [x, y] = fact.subject.terms as readonly [NalTerm, NalTerm];
      for (const after of [...(entry.first.get(nalTermKey(y)) ?? [])]) {
        if (after.subject.kind === "product") derive({ kind: "product", terms: [x, after.subject.terms[1]!] }, fact.predicate, fact, after, entry.rule.id);
      }
      for (const before of [...(entry.second.get(nalTermKey(x)) ?? [])]) {
        if (before.subject.kind === "product") derive({ kind: "product", terms: [before.subject.terms[0]!, y] }, fact.predicate, before, fact, entry.rule.id);
      }
    }
    const previous = new Map(old.facts.map(f => [nalFactKey(f), JSON.stringify(f)]));
    const changed = [...facts.values()].filter(f => previous.get(nalFactKey(f)) !== JSON.stringify(f));
    const removed = old.facts.filter(f => !facts.has(nalFactKey(f)));
    this.snapshot = { statements, rules: state.rules, facts: [...facts.values()] };
    return { changed, removed, joins };
  }
}

/** Full initial materialisation; subsequent updates should retain NalInferenceCache. */
export function inferNal(state: NalState, activePapers?: ReadonlySet<string>): readonly NalFact[] {
  const cache = new NalInferenceCache();
  cache.sync(state, activePapers);
  return cache.export().facts;
}
