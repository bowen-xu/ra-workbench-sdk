import type { DocumentChange, DocumentPath } from "../document";

export function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => equalValue(value, b[index]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalValue(a[key], b[key]));
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function cloneValue<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
export function valueAt(value: unknown, path: DocumentPath): unknown {
  for (const segment of path) {
    if (typeof segment === "object") value = Array.isArray(value) ? value.find(item => isObject(item) && item[segment.key] === segment.value) : undefined;
    else value = isObject(value) || Array.isArray(value) ? (value as Record<string | number, unknown>)[segment] : undefined;
  }
  return value;
}
export function identity(value: unknown): { key: string; value: string } | undefined {
  if (!isObject(value)) return;
  for (const key of ["id", "field"]) if (typeof value[key] === "string") return { key, value: value[key] };
}
export function pathKey(path: DocumentPath): string { return JSON.stringify(path); }
export function containsPath(parent: DocumentPath, child: DocumentPath): boolean {
  return parent.length <= child.length && parent.every((part, i) => equalValue(part, child[i]));
}
export function changeAt(path: DocumentPath, before: unknown, after: unknown, kind: DocumentChange["kind"], reason?: string, beforePath = path): DocumentChange {
  const source = JSON.stringify([path, beforePath, before, after, kind]);
  // Identity is content-generation-specific. A stale button must not authorize
  // a different replacement just because its path has stayed the same.
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return { id: `${pathKey(path)}:${(hash >>> 0).toString(16)}`, path, beforePath, before, after, kind, ...(reason ? { reason } : {}) };
}
export function replaceAt(root: unknown, path: DocumentPath, value: unknown): unknown {
  if (!path.length) return cloneValue(value);
  const result = cloneValue(root), parent = valueAt(result, path.slice(0, -1)), last = path.at(-1)!;
  if (typeof last === "object") {
    if (!Array.isArray(parent)) throw new Error("MODEL_RANGE_CHANGED：目标容器已变化。");
    const index = parent.findIndex(item => isObject(item) && item[last.key] === last.value);
    if (index < 0) { if (value !== undefined) parent.push(cloneValue(value)); }
    else if (value === undefined) parent.splice(index, 1); else parent[index] = cloneValue(value);
  } else if (Array.isArray(parent) && typeof last === "number") {
    if (last < 0 || last > parent.length) throw new Error("MODEL_RANGE_CHANGED：序列范围已变化。");
    parent.splice(last, value === undefined || last === parent.length ? 0 : 1, ...(value === undefined ? [] : [cloneValue(value)]));
    if (value === undefined && last < parent.length) parent.splice(last, 1);
  } else if (isObject(parent) && typeof last === "string") {
    if (value === undefined) delete parent[last]; else parent[last] = cloneValue(value);
  } else throw new Error("MODEL_RANGE_CHANGED：目标节点已变化。");
  return result;
}
