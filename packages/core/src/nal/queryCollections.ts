import { evaluateNalGroups } from "./queryGroupEvaluation";
import { NalInferenceCache, nalFactKey, type NalInferenceSnapshot } from "./inference";
import { matchNalFact, matchNalSources, nalRuleSources, type NalMatch, type NalQuerySource } from "./query";
import { nalQueryLeaves, nalQueryVariables, validateNalQueryBlocks, type NalQueryBlock, type NalState, type NalPattern } from "./index";

export interface NalQueryCollection {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string;
  /** Local conditions only; ancestors are conjoined using shared variable bindings. */
  readonly conditions: readonly NalQueryBlock[];
  /** Omitted for legacy membership queries; new editors save an explicit projection. */
  readonly outputVariables?: readonly string[] | undefined;
  readonly outputMode?: "all" | undefined;
}
interface CachedCollection {
  readonly definition: NalQueryCollection;
  readonly clauseKeys: readonly (readonly string[])[];
  readonly paperIds: readonly string[];
  readonly evidenceKeys: readonly string[];
  readonly bindings: readonly Readonly<Record<string,NalPattern>>[];
}
export interface NalQueryCacheSnapshot {
  readonly version: 3;
  readonly inference: NalInferenceSnapshot;
  readonly collections: readonly CachedCollection[];
}
export interface NalCollectionResult {
  readonly definition: NalQueryCollection;
  readonly conditions: readonly NalQueryBlock[];
  readonly paperIds: readonly string[];
  readonly matches: readonly NalMatch[];
  readonly bindings: readonly Readonly<Record<string,NalPattern>>[];
}

function inheritedConditions(def: NalQueryCollection, definitions: readonly NalQueryCollection[], trail: readonly string[] = []): readonly NalQueryBlock[] {
  if (trail.includes(def.id) || trail.length >= 16) throw new Error("查询目录存在循环或超过 16 层");
  const parent = def.parentId ? definitions.find(d => d.id === def.parentId) : undefined;
  if (def.parentId && !parent) throw new Error("上级查询已不存在");
  const conditions = [...(parent ? inheritedConditions(parent, definitions, [...trail, def.id]) : []), ...def.conditions];
  if (nalQueryLeaves(conditions).length > 16) throw new Error("一个查询路径最多 16 个条件");
  return conditions;
}

/** Derived query views; config is durable, cache is replaceable and contains no source edits. */
export class NalQueryCollections {
  private inference: NalInferenceCache;
  private collections: readonly CachedCollection[];
  private facts: Map<string, NalQuerySource>;
  constructor(snapshot?: NalQueryCacheSnapshot) {
    this.inference = new NalInferenceCache(snapshot?.inference);
    this.collections = snapshot?.collections ?? [];
    this.facts = new Map([...this.inference.export().facts,...nalRuleSources(this.inference.export())].map(f => [nalFactKey(f), f]));
  }
  export(): NalQueryCacheSnapshot { return { version: 3, inference: this.inference.export(), collections: this.collections }; }
  sync(state: NalState, activePapers: ReadonlySet<string>, definitions: readonly NalQueryCollection[]): { joins: number; matchedFacts: number; updatedViews: number } {
    // Work on a copy so a budget failure never publishes a partial query directory.
    const inference = new NalInferenceCache(this.inference.export());
    const delta = inference.sync(state, activePapers);
    const facts = new Map<string,NalQuerySource>([...inference.export().facts,...nalRuleSources(state)].map(f => [nalFactKey(f), f]));
    const changed=[...delta.changed,...[...facts.values()].filter(f=>f.copula==="implication" && !this.facts.has(nalFactKey(f)))];
    const removed=[...delta.removed,...[...this.facts.values()].filter(f=>f.copula==="implication" && !facts.has(nalFactKey(f)))];
    let matchedFacts = 0, updatedViews = 0;
    const collections = definitions.map(definition => {
      const conditions = inheritedConditions(definition, definitions);
      const previous = this.collections.find(c => c.definition.id === definition.id);
      const previousConditions = previous ? inheritedConditions(previous.definition, this.collections.map(c => c.definition)) : [];
      const same = previous && JSON.stringify(conditions) === JSON.stringify(previousConditions) && JSON.stringify(definition.outputVariables)===JSON.stringify(previous.definition.outputVariables) && definition.outputMode===previous.definition.outputMode;
      if (same && !removed.length && !changed.length) return { ...previous, definition };
      let needsJoin = !same;
      const leaves=nalQueryLeaves(conditions);
      const clauseKeys = leaves.map((condition, i) => {
        const keys = new Set(same ? previous.clauseKeys[i] : []);
        if (same) for (const fact of removed) { if (keys.delete(nalFactKey(fact))) needsJoin = true; }
        for (const fact of same ? changed : facts.values()) {
          matchedFacts++;
          const key = nalFactKey(fact);
          if (matchNalFact(fact, condition)) { if (!keys.has(key)) needsJoin = true; keys.add(key); }
          else if (keys.delete(key)) needsJoin = true;
        }
        return [...keys];
      });
      if (!needsJoin && previous) return { ...previous, definition };
      updatedViews++;
      const clauses = clauseKeys.map((keys,i)=>matchNalSources(keys.flatMap(key=>{const fact=facts.get(key);return fact ? [fact] : [];}),leaves[i]!));
      return { definition, clauseKeys, ...evaluateNalGroups(conditions,clauses,definition.outputMode==="all" ? nalQueryVariables(conditions) : definition.outputVariables) };
    });
    this.inference = inference;
    this.facts = facts;
    this.collections = collections;
    return { joins: delta.joins, matchedFacts, updatedViews };
  }
  results(): readonly NalCollectionResult[] {
    const definitions = this.collections.map(c => c.definition);
    return this.collections.map(c => {
      const conditions = inheritedConditions(c.definition, definitions);
      return { definition: c.definition, conditions, paperIds: c.paperIds, bindings:c.bindings, matches: c.evidenceKeys.flatMap(key => {
        const fact = this.facts.get(key);
        const match = fact && nalQueryLeaves(conditions).map(q => matchNalFact(fact, q)).find(Boolean);
        return match ? [match] : [];
      }) };
    });
  }
  query(conditions: readonly NalQueryBlock[],outputVariables?:readonly string[]): { paperIds: readonly string[]; matches: readonly NalMatch[];bindings:readonly Readonly<Record<string,NalPattern>>[] } {
    validateNalQueryBlocks(conditions);
    if(!conditions.length || conditions.length>16)throw new Error("查询需要 1–16 条语句");
    if(outputVariables?.some(name=>!nalQueryVariables(conditions).includes(name)))throw new Error("输出变量无效，请从语句中选择");
    const clauses = nalQueryLeaves(conditions).map(q => matchNalSources(this.facts.values(),q));
    const result = evaluateNalGroups(conditions,clauses,outputVariables);
    return { paperIds: result.paperIds,bindings:result.bindings, matches: result.evidenceKeys.flatMap(key => {
      const fact = this.facts.get(key);
      const match = fact && nalQueryLeaves(conditions).map(q => matchNalFact(fact, q)).find(Boolean);
      return match ? [match] : [];
    }) };
  }
}
