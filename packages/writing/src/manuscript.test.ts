import { describe, expect, it } from "vitest";

import { classifyManuscriptFile, normalizeManuscriptDraft } from "./manuscript";
import { parseManuscriptPath } from "./manuscriptPath";

describe("manuscript", () => {
  it("normalizes a new manuscript", () => {
    expect(normalizeManuscriptDraft({ title: " Paper " })).toEqual({
      title: "Paper",
      rootPath: "main.tex",
    });
  });

  it("classifies files without coupling to an editor", () => {
    expect(classifyManuscriptFile(parseManuscriptPath("main.tex"))).toBe("tex");
    expect(classifyManuscriptFile(parseManuscriptPath("figures/result.PDF"))).toBe("image");
    expect(classifyManuscriptFile(parseManuscriptPath("journal.cls"))).toBe("style");
  });
});
