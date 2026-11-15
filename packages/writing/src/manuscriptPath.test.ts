import { describe, expect, it } from "vitest";

import { parentManuscriptPath, parseManuscriptPath } from "./manuscriptPath";

describe("parseManuscriptPath", () => {
  it("accepts a normalized nested source path", () => {
    const path = parseManuscriptPath("sections/introduction.tex");

    expect(path).toBe("sections/introduction.tex");
    expect(parentManuscriptPath(path)).toBe("sections");
  });

  it.each(["", "/main.tex", "../main.tex", "sections/../main.tex", "a//b.tex", "C:/main.tex", "a\\b.tex", "aux"])(
    "rejects an unsafe path: %s",
    (path) => {
      expect(() => parseManuscriptPath(path)).toThrow();
    },
  );
});
