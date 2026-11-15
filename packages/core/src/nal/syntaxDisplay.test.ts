import { expect, it } from "vitest";
import { formatNalStatement, formatNalTransitivityRule, parseNal, type NalQuery, type NalVocabulary } from "./index";

const statement: NalQuery = {
  subject: { kind: "product", terms: [{ kind: "paper", id: "paper-id" }, { kind: "concept", id: "domain-id" }] },
  predicate: { kind: "concept", id: "relation-id" },
};
const vocabulary: readonly NalVocabulary[] = [
  { atom: { kind: "paper", id: "paper-id" }, label: "文章1" },
  { atom: { kind: "concept", id: "domain-id" }, label: "AI领域" },
  { atom: { kind: "concept", id: "relation-id" }, label: "所属领域" },
  { atom: { kind: "concept", id: "legacy-domain-id" }, label: "AI领域" },
];

it("uses readable names for display while preserving stable identity in editable expressions", () => {
  expect(formatNalStatement(statement, vocabulary, { displayOnly: true })).toBe("(文章1 × AI领域) → 所属领域");
  const editable = formatNalStatement(statement, vocabulary);
  expect(editable).toContain("concept:domain-id");
  expect(parseNal(editable, vocabulary)).toEqual(statement);
});

it("resolves renamed concepts from the current vocabulary without rewriting the statement", () => {
  const original = JSON.stringify(statement);
  const renamed = vocabulary.map(v => v.atom.id === "domain-id" ? { ...v, label: "人工智能领域" } : v);
  expect(formatNalStatement(statement, renamed, { displayOnly: true })).toBe("(文章1 × 人工智能领域) → 所属领域");
  expect(JSON.stringify(statement)).toBe(original);
  expect(formatNalTransitivityRule("relation-id", [...vocabulary, { atom: { kind: "concept", id: "legacy-relation" }, label: "所属领域" }], { displayOnly: true })).not.toContain("concept:");
});

it("uses readable missing-object messages instead of raw identifiers", () => {
  const label = formatNalStatement(statement, [], { displayOnly: true });
  expect(label).toBe("(未找到的文献 × 未找到的概念) → 未找到的概念");
  expect(label).not.toContain("-id");
});
