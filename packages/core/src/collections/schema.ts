import type { CollectionState } from "./index";
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("分类数据格式无效");
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== "string") throw new Error("分类字段格式无效");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("分类方向格式无效");
  return value;
}
function list<T>(value: unknown, decode: (r: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) throw new Error("分类列表格式无效");
  return value.map((v: unknown) => decode(record(v)));
}
export function decodeCollectionState(value: unknown): CollectionState {
  const s = record(value);
  if (!Number.isSafeInteger(s.revision) || typeof s.revision !== "number" || s.revision < 0) throw new Error("分类版本无效");
  return {
    revision: s.revision,
    collections: list(s.collections, (c) => ({ id: str(c.id), name: str(c.name), description: str(c.description), conceptId: c.conceptId === null ? null : str(c.conceptId) })),
    types: list(s.types, (t) => ({ id: str(t.id), name: str(t.name), inverseName: str(t.inverseName), directed: bool(t.directed), builtIn: bool(t.builtIn) })),
    relations: list(s.relations, (r) => ({ id: str(r.id), sourceId: str(r.sourceId), targetId: str(r.targetId), typeId: str(r.typeId) })),
    memberships: list(s.memberships, (m) => ({ itemId: str(m.itemId), collectionId: str(m.collectionId) })),
    assignments: list(s.assignments, (a) => ({ itemId: str(a.itemId), relationId: str(a.relationId) })),
  };
}
