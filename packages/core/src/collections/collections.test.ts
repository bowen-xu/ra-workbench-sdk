import { describe, expect, it } from "vitest";
import { applyCollectionMutation, collectionRelations, decodeCollectionState, emptyCollectionState, filterCollectionItems, relationLabel, type CollectionMutation } from "./index";
function fixture() {
  let state = emptyCollectionState();
  const act = (mutation: CollectionMutation) => { state = applyCollectionMutation(state, mutation, state.revision); return state; };
  for (const id of ["a", "b", "c"]) act({ kind: "save_collection", collection: { id, name: id.toUpperCase(), description: "", conceptId: null } });
  act({ kind: "add_relation", relation: { id: "ab", sourceId: "a", targetId: "b", typeId: "sub-field" } });
  act({ kind: "add_relation", relation: { id: "ac", sourceId: "a", targetId: "c", typeId: "related-field" } });
  return { act, get state() { return state; } };
}
describe("manual collection network", () => {
  it("shares tags bilaterally and preserves membership on tag removal", () => {
    const f = fixture();
    f.act({ kind: "classify", itemIds: ["p", "p"], collectionId: "a", relationIds: ["ab", "ac"] });
    expect(f.state.memberships).toHaveLength(3); expect(f.state.assignments).toHaveLength(2);
    const incoming = collectionRelations(f.state, "b")[0];
    expect(incoming && relationLabel(f.state, incoming, "b")).toBe("包含子领域 · A");
    f.act({ kind: "unassign", itemIds: ["p"], relationIds: ["ab"] });
    expect(f.state.memberships).toHaveLength(3); expect(f.state.assignments).toHaveLength(1);
    f.act({ kind: "remove_membership", itemIds: ["p"], collectionId: "a" });
    expect(f.state.memberships).toHaveLength(2); expect(f.state.assignments).toHaveLength(0);
  });
  it("intersects type, tag, no-tag and prefiltered literature queries without duplicate rows", () => {
    const f = fixture();
    f.act({ kind: "classify", itemIds: ["p"], collectionId: "a", relationIds: ["ab", "ac"] });
    f.act({ kind: "classify", itemIds: ["q"], collectionId: "a", relationIds: ["ac"] });
    f.act({ kind: "classify", itemIds: ["r"], collectionId: "a", relationIds: [] });
    const ids = ["p", "q", "r", "u", "p"];
    expect(filterCollectionItems(f.state, ids, { collectionId: "a", relationIds: ["ab", "ac"], match: "all" })).toEqual(["p"]);
    expect(filterCollectionItems(f.state, ids, { collectionId: "a", relationIds: ["ab", "ac"], match: "any" })).toEqual(["p", "q"]);
    expect(filterCollectionItems(f.state, ids, { collectionId: "a", withoutRelations: true })).toEqual(["r"]);
    expect(filterCollectionItems(f.state, ids, { unclassified: true })).toEqual(["u"]);
    expect(filterCollectionItems(f.state, ["q", "r"], { collectionId: "a", typeId: "sub-field" })).toEqual([]);
    expect(filterCollectionItems(f.state, ids, { collectionId: "a", typeId: "sub-field", withoutRelations: true })).toEqual([]);
  });
  it("allows multiple parents but disallows hierarchy cycles and symmetric duplicates", () => {
    const f = fixture();
    f.act({ kind: "add_relation", relation: { id: "ac2", sourceId: "a", targetId: "c", typeId: "sub-field" } });
    expect(() => f.act({ kind: "add_relation", relation: { id: "ba", sourceId: "b", targetId: "a", typeId: "sub-field" } })).toThrow("循环");
    expect(() => f.act({ kind: "add_relation", relation: { id: "ca", sourceId: "c", targetId: "a", typeId: "related-field" } })).toThrow("已存在");
  });
  it("rejects stale decisions and invalid edges without mutating input", () => {
    const f = fixture(); const before = decodeCollectionState(JSON.parse(JSON.stringify(f.state)));
    expect(() => applyCollectionMutation(f.state, { kind: "delete_collection", id: "a" }, 0)).toThrow("变化");
    expect(() => f.act({ kind: "classify", itemIds: ["p"], collectionId: "b", relationIds: ["ac"] })).toThrow("变化");
    expect(f.state).toEqual(before);
  });
  it("keeps other memberships after collection deletion and uses live names", () => {
    const f = fixture();
    f.act({ kind: "classify", itemIds: ["p"], collectionId: "a", relationIds: ["ab", "ac"] });
    f.act({ kind: "save_collection", collection: { id: "a", name: "Renamed", description: "", conceptId: "concept" } });
    const incoming = f.state.relations.find((r) => r.id === "ab");
    expect(incoming && relationLabel(f.state, incoming, "b")).toBe("包含子领域 · Renamed");
    f.act({ kind: "delete_collection", id: "a" });
    expect(f.state.memberships).toHaveLength(2); expect(f.state.assignments).toEqual([]);
  });
  it("validates serialized boundaries and round-trips persisted state", () => {
    const f = fixture(); expect(decodeCollectionState(JSON.parse(JSON.stringify(f.state)))).toEqual(f.state);
    expect(() => decodeCollectionState({ ...f.state, revision: "2" })).toThrow();
    expect(() => decodeCollectionState({ ...f.state, types: [{ id: "x", directed: "false" }] })).toThrow();
  });
});
