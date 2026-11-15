import { parseNal, formatNalStatement, type NalVocabulary } from "./syntax";
import type { NalQuery } from "./index";

/** Split conjunctions outside quoted labels; ASCII Narsese product and $ variables are accepted in queries. */
export function parseNalConditions(input: string, vocabulary: readonly NalVocabulary[]): readonly NalQuery[] {
  if (input.length > 8000) throw new Error("查询最多 8000 个字符");
  const clauses: string[] = [];
  let text = "", quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (escaped) { text += c; escaped = false; continue; }
    if (quoted && c === "\\") { text += c; escaped = true; continue; }
    if (c === '"') quoted = !quoted;
    if (!quoted && c === "&" && input[i+1] === "&") { clauses.push(text); text = ""; i++; continue; }
    text += !quoted && c === "*" ? "×" : !quoted && c === "$" && (i === 0 || /[\s(×*]/u.test(input[i-1]!)) ? "?" : c;
  }
  clauses.push(text);
  if (clauses.length > 16) throw new Error("一个查询路径最多 16 个条件");
  return clauses.map(c => parseNal(c, vocabulary, true));
}
export function formatNalConditions(conditions: readonly NalQuery[], vocabulary: readonly NalVocabulary[]): string {
  return conditions.map(q => formatNalStatement(q, vocabulary)).join(" && ");
}
