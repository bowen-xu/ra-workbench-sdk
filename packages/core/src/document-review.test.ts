import { expect, it } from "vitest";
import { persistReviewSnapshots, resolveReviewDocument, shouldSynchronizeReviewBaseline } from "./document-review";

it("applies the same B/D transition with injected text and block storage", () => {
  for (const action of ["keep", "undo"] as const) {
    const text = resolveReviewDocument({ content: "aNEWz", reviewBaseline: "aOLDz" }, action, {
      equal: (a, b) => a === b,
      replace: (target, range: readonly number[], source, from: readonly number[]) => target.slice(0, range[0])
        + source.slice(from[0], from[1]) + target.slice(range[1]),
    }, { baseline: [1, 4], current: [1, 4] });
    const blocks = resolveReviewDocument({ content: ["a", "NEW", "z"], reviewBaseline: ["a", "OLD", "z"] }, action, {
      equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      replace: (target, range: readonly number[], source, from: readonly number[]) => [...target.slice(0, range[0]),
        ...source.slice(from[0], from[1]), ...target.slice(range[1])],
    }, { baseline: [1, 2], current: [1, 2] });
    expect(blocks.content.join("")).toBe(text.content);
    expect(blocks.reviewBaseline.join("")).toBe(text.reviewBaseline);
    expect(text).toEqual(action === "keep" ? { content: "aNEWz", reviewBaseline: "aNEWz" }
      : { content: "aOLDz", reviewBaseline: "aOLDz" });
  }
});

it("records native baseline inverses rather than synchronizing history and Agent input", () => {
  expect(shouldSynchronizeReviewBaseline("manual", true, false)).toBe(true);
  for (const origin of ["agent", "review", "undo", "redo", "restore"] as const)
    expect(shouldSynchronizeReviewBaseline(origin, true, false)).toBe(false);
  expect(shouldSynchronizeReviewBaseline("manual", true, true)).toBe(false);
});

it("persists pending review and drains newer D/B entered during acknowledgment", async () => {
  let current = { content: "new", reviewBaseline: "old" }, saved: typeof current | undefined;
  const writes: typeof current[] = [];
  await persistReviewSnapshots({
    capture: () => current,
    prepare: next => next === saved ? null : next,
    write: async write => {
      writes.push(write); saved = write;
      if (writes.length === 1) current = { content: "new manual", reviewBaseline: "old manual" };
    },
  });
  expect(writes).toEqual([{ content: "new", reviewBaseline: "old" }, { content: "new manual", reviewBaseline: "old manual" }]);
  expect(saved).toBe(current);
});
