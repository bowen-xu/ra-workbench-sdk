import type { CollectionMutation, CollectionState } from "./index";

/** Pure preview-domain transaction. Browser and desktop enforce the same invariants. */
export function applyCollectionMutation(state: CollectionState, mutation: CollectionMutation, expectedRevision: number): CollectionState {
  if (state.revision !== expectedRevision) throw new Error("分类已变化，请刷新后重试");
  let { collections, types, relations, memberships, assignments } = state;
  const hasCollection = (id: string) => {
    if (!collections.some((c) => c.id === id)) throw new Error("集合已不存在，请刷新");
  };
  const text = (value: string, max: number) => {
    if (!value.trim() || value.length > max) throw new Error(`内容不能为空且最多 ${max} 个字符`);
  };
  switch (mutation.kind) {
    case "save_collection": {
      const c = mutation.collection;
      text(c.id, 200); text(c.name, 200);
      if (c.description.length > 4000) throw new Error("说明最多 4000 个字符");
      collections = [...collections.filter((v) => v.id !== c.id), { ...c, name: c.name.trim() }];
      break;
    }
    case "delete_collection":
      hasCollection(mutation.id);
      collections = collections.filter((c) => c.id !== mutation.id);
      relations = relations.filter((r) => r.sourceId !== mutation.id && r.targetId !== mutation.id);
      memberships = memberships.filter((m) => m.collectionId !== mutation.id);
      assignments = assignments.filter((a) => relations.some((r) => r.id === a.relationId));
      break;
    case "save_type": {
      const t = mutation.relationType;
      text(t.id, 200); text(t.name, 120); text(t.inverseName, 120);
      const previous = types.find((v) => v.id === t.id);
      if (previous?.builtIn || t.builtIn) throw new Error("内置关系类型不能修改");
      if (previous && previous.directed !== t.directed && relations.some((r) => r.typeId === t.id)) throw new Error("关系类型已使用，不能修改方向");
      types = [...types.filter((v) => v.id !== t.id), { ...t, name: t.name.trim(), inverseName: t.directed ? t.inverseName.trim() : t.name.trim() }];
      break;
    }
    case "delete_type":
      if (!types.some((t) => t.id === mutation.id && !t.builtIn) || relations.some((r) => r.typeId === mutation.id)) throw new Error("内置或仍在使用的关系类型不能删除");
      types = types.filter((t) => t.id !== mutation.id);
      break;
    case "add_relation": {
      const input = mutation.relation;
      text(input.id, 200); hasCollection(input.sourceId); hasCollection(input.targetId);
      const type = types.find((t) => t.id === input.typeId);
      if (!type) throw new Error("关系类型已不存在，请刷新");
      const r = !type.directed && input.sourceId > input.targetId ? { ...input, sourceId: input.targetId, targetId: input.sourceId } : input;
      if (r.sourceId === r.targetId) throw new Error("不能连接集合自身");
      if (relations.some((v) => v.id === r.id || (v.sourceId === r.sourceId && v.targetId === r.targetId && v.typeId === r.typeId))) throw new Error("关系已存在");
      if (r.typeId === "sub-field") {
        const pending = [r.targetId]; const seen = new Set<string>();
        while (pending.length) {
          const id = pending.pop();
          if (id === r.sourceId) throw new Error("sub-field 关系不能形成循环");
          if (id === undefined || seen.has(id)) continue;
          seen.add(id);
          pending.push(...relations.filter((v) => v.typeId === "sub-field" && v.sourceId === id).map((v) => v.targetId));
        }
      }
      relations = [...relations, r];
      break;
    }
    case "delete_relation":
      if (!relations.some((r) => r.id === mutation.id)) throw new Error("关系已不存在，请刷新");
      relations = relations.filter((r) => r.id !== mutation.id);
      assignments = assignments.filter((a) => a.relationId !== mutation.id);
      break;
    case "classify": {
      hasCollection(mutation.collectionId);
      const chosen = mutation.relationIds.map((id) => {
        const r = relations.find((v) => v.id === id && (v.sourceId === mutation.collectionId || v.targetId === mutation.collectionId));
        if (!r) throw new Error("所选关系已变化，请刷新");
        return r;
      });
      const collectionIds = new Set([mutation.collectionId, ...chosen.flatMap((r) => [r.sourceId, r.targetId])]);
      for (const itemId of new Set(mutation.itemIds)) {
        for (const collectionId of collectionIds) if (!memberships.some((m) => m.itemId === itemId && m.collectionId === collectionId)) memberships = [...memberships, { itemId, collectionId }];
        for (const r of chosen) if (!assignments.some((a) => a.itemId === itemId && a.relationId === r.id)) assignments = [...assignments, { itemId, relationId: r.id }];
      }
      break;
    }
    case "unassign":
      if (mutation.relationIds.some((id) => !relations.some((r) => r.id === id))) throw new Error("关系已不存在，请刷新");
      assignments = assignments.filter((a) => !(mutation.itemIds.includes(a.itemId) && mutation.relationIds.includes(a.relationId)));
      break;
    case "remove_membership":
      hasCollection(mutation.collectionId);
      memberships = memberships.filter((m) => !(mutation.itemIds.includes(m.itemId) && m.collectionId === mutation.collectionId));
      assignments = assignments.filter((a) => !(mutation.itemIds.includes(a.itemId) && relations.some((r) => r.id === a.relationId && (r.sourceId === mutation.collectionId || r.targetId === mutation.collectionId))));
      break;
  }
  return { revision: state.revision + 1, collections, types, relations, memberships, assignments };
}
