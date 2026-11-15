export interface Collection {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly conceptId: string | null;
}
export interface CollectionRelationType {
  readonly id: string;
  readonly name: string;
  readonly inverseName: string;
  readonly directed: boolean;
  readonly builtIn: boolean;
}
export interface CollectionRelation {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly typeId: string;
}
export interface CollectionMembership {
  readonly itemId: string;
  readonly collectionId: string;
}
export interface ItemRelationAssignment {
  readonly itemId: string;
  readonly relationId: string;
}
/** Revision protects the complete graph, including deletion impact previews. */
export interface CollectionState {
  readonly revision: number;
  readonly collections: readonly Collection[];
  readonly types: readonly CollectionRelationType[];
  readonly relations: readonly CollectionRelation[];
  readonly memberships: readonly CollectionMembership[];
  readonly assignments: readonly ItemRelationAssignment[];
}
export type CollectionMutation =
  | { readonly kind: "save_collection"; readonly collection: Collection }
  | { readonly kind: "delete_collection"; readonly id: string }
  | { readonly kind: "save_type"; readonly relationType: CollectionRelationType }
  | { readonly kind: "delete_type"; readonly id: string }
  | { readonly kind: "add_relation"; readonly relation: CollectionRelation }
  | { readonly kind: "delete_relation"; readonly id: string }
  | { readonly kind: "classify"; readonly itemIds: readonly string[]; readonly collectionId: string; readonly relationIds: readonly string[] }
  | { readonly kind: "unassign"; readonly itemIds: readonly string[]; readonly relationIds: readonly string[] }
  | { readonly kind: "remove_membership"; readonly itemIds: readonly string[]; readonly collectionId: string };
export interface CollectionQuery {
  readonly collectionId?: string;
  readonly unclassified?: boolean;
  readonly typeId?: string;
  readonly relationIds?: readonly string[];
  readonly match?: "any" | "all";
  readonly withoutRelations?: boolean;
}
export function emptyCollectionState(): CollectionState {
  return { revision: 0, collections: [], relations: [], memberships: [], assignments: [], types: [
    { id: "sub-field", name: "sub-field", inverseName: "包含子领域", directed: true, builtIn: true },
    { id: "related-field", name: "related-field", inverseName: "related-field", directed: false, builtIn: true },
  ] };
}
export function collectionRelations(state: CollectionState, collectionId: string): readonly CollectionRelation[] {
  return state.relations.filter((r) => r.sourceId === collectionId || r.targetId === collectionId);
}
export function relationLabel(state: CollectionState, relation: CollectionRelation, collectionId: string): string {
  const type = state.types.find((t) => t.id === relation.typeId);
  const outgoing = relation.sourceId === collectionId;
  const other = state.collections.find((c) => c.id === (outgoing ? relation.targetId : relation.sourceId));
  return `${outgoing || !type?.directed ? type?.name : type.inverseName} · ${other?.name ?? "集合不可用"}`;
}
/** Filters IDs already scoped to active literature and its existing quick search. */
export function filterCollectionItems(state: CollectionState, itemIds: readonly string[], query: CollectionQuery): readonly string[] {
  const memberships = new Map<string, Set<string>>();
  for (const m of state.memberships) {
    if (!memberships.has(m.itemId)) memberships.set(m.itemId, new Set());
    memberships.get(m.itemId)?.add(m.collectionId);
  }
  const relevant = new Map(state.relations.filter((r) => query.collectionId === undefined || r.sourceId === query.collectionId || r.targetId === query.collectionId).map((r) => [r.id, r]));
  const tags = new Map<string, Set<string>>();
  for (const a of state.assignments) {
    if (!relevant.has(a.relationId)) continue;
    if (!tags.has(a.itemId)) tags.set(a.itemId, new Set());
    tags.get(a.itemId)?.add(a.relationId);
  }
  return [...new Set(itemIds)].filter((id) => {
    const member = memberships.get(id);
    if (query.unclassified && member?.size) return false;
    if (query.collectionId && !member?.has(query.collectionId)) return false;
    const assigned = tags.get(id) ?? new Set<string>();
    if (query.withoutRelations && assigned.size > 0) return false;
    if (query.typeId && ![...assigned].some((r) => relevant.get(r)?.typeId === query.typeId)) return false;
    const selected = query.relationIds ?? [];
    return selected.length === 0 || (query.match === "all" ? selected.every((r) => assigned.has(r)) : selected.some((r) => assigned.has(r)));
  });
}
export { applyCollectionMutation } from "./mutation";
export { decodeCollectionState } from "./schema";
