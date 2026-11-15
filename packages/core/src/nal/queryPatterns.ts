import { validateNalTerm, nalQueryLeaves, type NalPattern, type NalQuery, type NalQueryBlock } from "./index";

export function validateNalPattern(value: unknown, depth=0, budget={remaining:16000}): asserts value is NalPattern {
  if (--budget.remaining<0 || !value || typeof value!=="object" || depth>12) throw new Error("查询词项结构无效或过大");
  const p=value as NalPattern;
  if (p.kind==="compound") throw new Error("请选择组合连接符");
  if (p.kind==="variable") {
    if (typeof p.name!=="string" || !p.name.trim() || p.name.length>200) throw new Error("查询变量无效");
  } else if (p.kind==="statement") {
    validateNalQuery(p,depth+1,budget);
  } else if (["product","conjunction","disjunction"].includes(p.kind)) {
    if (!("terms" in p) || !Array.isArray(p.terms) || p.terms.length<2 || p.terms.length>16) throw new Error("组合需要 2–16 个词项");
    p.terms.forEach(t=>validateNalPattern(t,depth+1,budget));
  } else validateNalTerm(p);
}
export function validateNalQuery(value: unknown,depth=0,budget={remaining:16000}): asserts value is NalQuery {
  if (!value || typeof value!=="object" || depth>12) throw new Error("查询语句无效");
  const q=value as NalQuery;
  if (q.copula!==undefined && q.copula!=="inheritance" && q.copula!=="implication") throw new Error("请选择语句连接符");
  validateNalPattern(q.subject,depth,budget);validateNalPattern(q.predicate,depth,budget);
}
/** Variable order follows the expression, with shared identities listed only once. */
export function nalQueryVariables(conditions:readonly NalQueryBlock[]): readonly string[] {
  const names=new Set<string>();
  const visit=(p:NalPattern):void=>{
    if(p.kind==="variable"){if(p.name.trim())names.add(p.name);}
    else if("terms" in p)p.terms.forEach(visit);
    else if(p.kind==="statement"){visit(p.subject);visit(p.predicate);}
  };
  nalQueryLeaves(conditions).forEach(q=>{visit(q.subject);visit(q.predicate);});
  return [...names];
}
