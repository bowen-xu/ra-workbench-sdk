/** Bibliography entries derived from a persisted DoclingDocument, never human review. */
export interface DetectedReference { readonly sourceRef: string; readonly rawText: string; readonly pageIndex: number }
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
export function detectDoclingReferences(document: unknown): readonly DetectedReference[] {
  const root = object(document);
  if (root === undefined || !Array.isArray(root.texts)) return [];
  const texts = new Map<string, Record<string, unknown>>();
  for (const value of root.texts.slice(0, 50000)) {
    const item = object(value);
    if (item !== undefined && typeof item.self_ref === "string") texts.set(item.self_ref, item);
  }
  const ordered: Record<string, unknown>[] = [];
  const groups = new Map<string, Record<string, unknown>>();
  if (Array.isArray(root.groups)) for (const value of root.groups) { const item = object(value); if (item && typeof item.self_ref === "string") groups.set(item.self_ref, item); }
  const visited = new Set<string>();
  function visit(node: Record<string, unknown> | undefined, depth: number): void {
    if (!node || depth > 32 || !Array.isArray(node.children)) return;
    for (const value of node.children) {
      const ref = object(value)?.$ref;
      if (typeof ref !== "string" || visited.has(ref)) continue;
      visited.add(ref);
      const text = texts.get(ref);
      if (text !== undefined) ordered.push(text);
      visit(groups.get(ref), depth + 1);
    }
  }
  visit(object(root.body), 0);
  if (ordered.length === 0) ordered.push(...texts.values());
  let bibliography = false;
  const result: DetectedReference[] = [];
  const seen = new Set<string>();
  for (const item of ordered) {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (item.label === "section_header" || item.label === "title") {
      bibliography = /^(?:\d+[.\s]*)?(?:references|bibliography|参考文献|文献目录)\s*[:：]?$/iu.test(text);
      continue;
    }
    if (item.label !== "reference" && (!bibliography || !["text", "list_item"].includes(String(item.label)))) continue;
    const provenance = Array.isArray(item.prov) ? object(item.prov[0]) : undefined;
    const page = provenance?.page_no;
    if (typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || text.length === 0 || text.length > 20000 || seen.has(text)) continue;
    seen.add(text);
    result.push({ sourceRef: String(item.self_ref), rawText: text, pageIndex: page - 1 });
    if (result.length >= 2000) break;
  }
  return result;
}
