import { expect, it } from "vitest";
import { compareTableRows } from "./tableComparison";

const before = [["条件", "准确率"], ["无噪声", "0.80"], ["有噪声", "0.65"]];
it("locates the edited original row across an insertion using unchanged cells", () => {
  expect(compareTableRows(before, [before[0]!, ["新增", "0.50"], ["无噪声", "0.44"], before[2]!])).toEqual({
    ambiguous: false, pairs: [{ before: 0, after: 0 }, { after: 1 }, { before: 1, after: 2 }, { before: 2, after: 3 }],
  });
});
it("identifies a deleted row without shifting the correspondence of surviving rows", () => {
  expect(compareTableRows(before, [before[0]!, ["无噪声", "0.44"]]).pairs).toEqual([
    { before: 0, after: 0 }, { before: 1, after: 1 }, { before: 2 },
  ]);
});
it("uses complete rich cell values, preserving styles and atomic formulas", () => {
  const formula = { kind: "inline", items: [{ type: "inlineFormula", source: "x^2" }] };
  const styled = { kind: "inline", items: [{ type: "text", text: "A", styles: ["bold"] }] };
  expect(compareTableRows([[styled, formula]], [["new", "row"], [styled, { ...formula, items: [{ type: "inlineFormula", source: "y^2" }] }]]).pairs)
    .toEqual([{ after: 0 }, { before: 0, after: 1 }]);
});
it("retains unsupported geometry and excessive work as whole-table review", () => {
  expect(compareTableRows(before, [["条件", "准确率"], ["incomplete"]]).reason).toContain("列结构");
  expect(compareTableRows(Array.from({ length: 201 }, () => ["A"]), Array.from({ length: 201 }, () => ["A"])).reason).toContain("预算");
});

it("uses daff correspondence for added and deleted identical rows", () => {
  const two = [["A"], ["A"]], three = [...two, ["A"]];
  expect(compareTableRows(two, three)).toEqual({ ambiguous: false, pairs: [{ before: 0, after: 0 }, { before: 1, after: 1 }, { after: 2 }] });
  expect(compareTableRows(three, two)).toEqual({ ambiguous: false, pairs: [{ before: 0, after: 0 }, { before: 1, after: 1 }, { before: 2 }] });
});
it.each([0, 1, 2])("uses daff columns to preserve edited cells across insertion at column %s", column => {
  const current = [before[0]!, ["new row", "0.50"], ["无噪声", "0.44"], before[2]!].map((row, index) => {
    const result = [...row]; result.splice(column, 0, index ? `new ${index}` : "新增列"); return result;
  });
  const result = compareTableRows(before, current);
  expect(result.ambiguous).toBe(false);
  expect(result.pairs).toEqual([{ before: 0, after: 0 }, { after: 1 }, { before: 1, after: 2 }, { before: 2, after: 3 }]);
  const expected = [{ before: 0, after: column === 0 ? 1 : 0 }, { before: 1, after: column <= 1 ? 2 : 1 }];
  expected.splice(column, 0, { after: column } as typeof expected[number]);
  expect(result.columns).toEqual(expected);
});

it("compares complete JSON cell values independently of object property order", () => {
  const rich = { kind: "inline", items: [{ type: "text", text: "label", styles: ["bold"] }] };
  const reordered = { items: [{ styles: ["bold"], text: "label", type: "text" }], kind: "inline" };
  expect(compareTableRows([[rich, 1]], [["inserted", 0], [reordered, 2]]).pairs)
    .toEqual([{ after: 0 }, { before: 0, after: 1 }]);
  expect(compareTableRows([[{ ...rich, attachmentId: "a" }, 1]], [[{ ...rich, attachmentId: "b" }, 2]]).pairs)
    .not.toContainEqual({ before: 0, after: 0 });
});
it("does not force the first actual row into a header match", () => {
  const result = compareTableRows([["old", 1]], [["new", 2]]);
  expect(result.ambiguous).toBe(false);
  expect(result.pairs).toHaveLength(2);
  expect(result.pairs).toContainEqual({ before: 0 });
  expect(result.pairs).toContainEqual({ after: 0 });
});
it("handles empty tables and unchanged duplicates without reporting a change", () => {
  expect(compareTableRows([], [])).toEqual({ pairs: [], ambiguous: false });
  expect(compareTableRows([], [["A", null]])).toEqual({ pairs: [{ after: 0 }], ambiguous: false });
  expect(compareTableRows([["A", null]], [])).toEqual({ pairs: [{ before: 0 }], ambiguous: false });
  expect(compareTableRows([["A"], ["A"]], [["A"], ["A"]]).pairs).toEqual([
    { before: 0, after: 0 }, { before: 1, after: 1 },
  ]);
});
it("avoids delimiter collisions and keeps primitive types distinct", () => {
  const rows = [["a // b", "c"], ["a", "b // c"], ["number", 1], ["null", null]];
  expect(compareTableRows(rows, [rows[0]!, ["insert", "row"], rows[1]!, ["number", "1"], ["null", "null"]]).pairs)
    .toEqual([{ before: 0, after: 0 }, { after: 1 }, { before: 1, after: 2 }, { before: 2, after: 3 }, { before: 3, after: 4 }]);
});
it("retains whole-table review when daff detects a reordered row", () => {
  expect(compareTableRows(before, [before[0]!, before[2]!, before[1]!])).toMatchObject({ ambiguous: true, pairs: [] });
});
