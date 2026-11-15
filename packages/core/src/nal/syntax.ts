import { type NalAtom, type NalPattern, type NalQuery } from "./index";
export interface NalVocabulary { readonly atom: NalAtom; readonly label: string }
export interface NalFormatOptions { readonly displayOnly?: boolean }
/** Display labels are conveniences; exact IDs disambiguate equal names. */
export function parseNal(input: string, vocabulary: readonly NalVocabulary[], allowVariables = false): NalQuery {
  if (input.length > 8000) throw new Error("表达式最多 8000 个字符");
  const text = input.trim().replace(/\.$/u,"").replace(/\?$/u,"").replaceAll("-->","→");
  const raw = text.match(/"(?:\\.|[^"\\])*"|[()×→]|[^()×→"]+/gu) ?? [];
  if(raw.join("") !== text)throw new Error("引号未闭合或表达式无效");
  const tokens = raw.map(t=>t.trim()).filter(Boolean);
  let at = 0;
  function term(depth = 0): NalPattern {
    if (depth > 12) throw new Error("词项嵌套过深");
    if (tokens[at] === "(") {
      at++; const terms = [term(depth+1)];
      while (tokens[at] === "×") { at++; terms.push(term(depth+1)); }
      if (tokens[at++] !== ")" || terms.length < 2 || terms.length > 16) throw new Error("使用 (词项 × 词项) 表示有序乘积");
      return {kind:"product",terms};
    }
    const token = tokens[at++];
    if (!token || [")","×","→"].includes(token)) throw new Error("缺少词项");
    if (token.startsWith("?") && allowVariables && /^\?[^\s?]+$/u.test(token)) return {kind:"variable",name:token.slice(1)};
    const quoted = token.startsWith('"');
    const name = quoted ? JSON.parse(token) as string : token;
    const exact = quoted ? [] : vocabulary.filter(v=>`${v.atom.kind}:${v.atom.id}` === name);
    const matches = exact.length ? exact : vocabulary.filter(v=>v.label === name);
    if (matches.length === 0) throw new Error(`未找到“${name}”，请先创建概念或选择已有文献`);
    if (matches.length > 1) throw new Error(`“${name}”有多个同名对象，请使用 concept:ID 或 paper:ID`);
    return matches[0]!.atom;
  }
  const subject = term();
  if (tokens[at++] !== "→") throw new Error("使用 主词 → 谓词 表示继承语句");
  const predicate = term();
  if (at !== tokens.length) throw new Error("表达式末尾存在未识别内容");
  return {subject,predicate};
}
export function formatNalTerm(term: NalPattern, vocabulary: readonly NalVocabulary[], options: NalFormatOptions = {}): string {
  if(term.kind === "variable")return `?${term.name}`;
  if ("terms" in term) return `(${term.terms.map(t=>formatNalTerm(t,vocabulary,options)).join(term.kind === "product" ? " × " : term.kind === "conjunction" ? " ∧ " : term.kind === "compound" ? " [选择连接符] " : " ∨ ")})`;
  if (term.kind === "statement") return `<${formatNalStatement(term,vocabulary,options)}>`;
  const label = vocabulary.find(v=>v.atom.kind === term.kind && v.atom.id === term.id)?.label;
  if (!label) return options.displayOnly ? (term.kind === "concept" ? "未找到的概念" : "未找到的文献") : `${term.kind}:${term.id}`;
  if (!options.displayOnly && vocabulary.filter(v=>v.label === label).length > 1) return `${term.kind}:${term.id}`;
  return /[()*×→"$?\r\n\t]|&&|-->|\.$|^(?:concept|paper):/u.test(label) || label.trim() !== label ? JSON.stringify(label) : label;
}
export function formatNalStatement(s: NalQuery, vocabulary: readonly NalVocabulary[], options: NalFormatOptions = {}): string {
  return `${formatNalTerm(s.subject,vocabulary,options)} ${s.copula === "implication" ? "⇒" : s.copula === null ? "[连接符]" : "→"} ${formatNalTerm(s.predicate,vocabulary,options)}`;
}
