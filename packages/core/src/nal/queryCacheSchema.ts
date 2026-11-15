import { validateNalTerm, validateNalQueryBlocks, validateNalPattern, nalQueryVariables, nalQueryLeaves, type NalQueryBlock, type NalQueryCollection, type NalQueryCacheSnapshot } from "./index";
import { INHERITANCE_RULE_ID, nalFactKey } from "./inference";
import { nalRuleSources } from "./query";
export function decodeNalQueryDefinitions(value: unknown): readonly NalQueryCollection[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("查询集合最多 100 个");
  const definitions = value as NalQueryCollection[];
  const budget={remaining:16000};
  for (const d of definitions) {
    if (!d || typeof d.id !== "string" || !d.id || d.id.length > 200 || typeof d.name !== "string" || !d.name.trim() || d.name.length > 200
      || (d.parentId !== undefined && (typeof d.parentId !== "string" || !d.parentId)) || !Array.isArray(d.conditions) || !d.conditions.length || d.conditions.length > 16) throw new Error("查询集合格式无效");
    validateNalQueryBlocks(d.conditions,budget);
    if(d.outputMode!==undefined && d.outputMode!=="all")throw new Error("输出变量模式无效");
  }
  if (new Set(definitions.map(d => d.id)).size !== definitions.length) throw new Error("查询集合身份重复");
  for (const d of definitions) {
    const seen = new Set<string>(), conditions:NalQueryBlock[]=[]; let at: NalQueryCollection | undefined = d, count = 0;
    while (at) {
      if (seen.has(at.id) || seen.size >= 16 || (count += nalQueryLeaves(at.conditions).length) > 16) throw new Error("查询目录存在循环或超过 16 个条件");
      seen.add(at.id);
      conditions.push(...at.conditions);
      const parent: string | undefined = at.parentId;
      at = parent ? definitions.find(v => v.id === parent) : undefined;
      if (parent && !at) throw new Error("上级查询已不存在");
    }
    if(d.outputVariables!==undefined && (!Array.isArray(d.outputVariables) || new Set(d.outputVariables).size!==d.outputVariables.length || d.outputVariables.some(n=>typeof n!=="string" || !nalQueryVariables(conditions).includes(n))))throw new Error("输出变量无效，请从语句中选择");
  }
  return definitions;
}
/** Invalid derived bytes can be discarded without losing the durable definitions. */
export function decodeNalQueryCache(value: unknown): NalQueryCacheSnapshot | undefined {
  try {
    if (!value || typeof value !== "object") return undefined;
    const c = value as NalQueryCacheSnapshot;
    if (c.version !== 3 || !c.inference || !Array.isArray(c.inference.facts) || c.inference.facts.length > 20_000 || !Array.isArray(c.inference.statements)
      || !Array.isArray(c.inference.rules) || !Array.isArray(c.collections)) return undefined;
    const sources = new Set(c.inference.statements.map(s => s.id));
    const rules = new Set([INHERITANCE_RULE_ID, ...c.inference.rules.map(r => r.id)]);
    for (const s of c.inference.statements) { validateNalTerm(s.subject); validateNalTerm(s.predicate); }
    const keys = new Set<string>();
    for (const f of c.inference.facts) {
      validateNalTerm(f.subject); validateNalTerm(f.predicate);
      if (typeof f.id !== "string" || typeof f.derived !== "boolean" || !Array.isArray(f.statementIds) || !f.statementIds.length || f.statementIds.some((id: unknown) => typeof id !== "string" || !sources.has(id))
        || !Array.isArray(f.ruleIds) || f.ruleIds.some((id: unknown) => typeof id !== "string" || !rules.has(id)) || keys.has(nalFactKey(f))) return undefined;
      keys.add(nalFactKey(f));
    }
    decodeNalQueryDefinitions(c.collections.map(v => v.definition));
    for(const source of nalRuleSources(c.inference))keys.add(nalFactKey(source));
    for (const view of c.collections) {
      if (!Array.isArray(view.clauseKeys) || view.clauseKeys.some((ks: unknown) => !Array.isArray(ks) || ks.some((k: unknown) => typeof k !== "string" || !keys.has(k))) || !Array.isArray(view.paperIds)
        || view.paperIds.some((id: unknown) => typeof id !== "string") || !Array.isArray(view.evidenceKeys) || view.evidenceKeys.some((k: unknown) => typeof k !== "string" || !keys.has(k))) return undefined;
      if(!Array.isArray(view.bindings) || view.bindings.length>20_000)return undefined;
      for(const row of view.bindings){if(!row || typeof row!=="object" || Array.isArray(row))return undefined;for(const value of Object.values(row))validateNalPattern(value);}
    }
    return c;
  } catch { return undefined; }
}
