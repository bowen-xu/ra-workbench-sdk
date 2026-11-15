import { describe, expect, it } from "vitest";

import { inspectCitationUsage, type CitationBinding } from "./citationBinding";

const binding = (citationKey: string): CitationBinding => ({
  manuscriptId: "manuscript",
  literatureItemId: citationKey,
  citationKey,
  bibtexEntry: "",
  state: "active",
  pinnedAt: "now",
  updatedAt: "now",
});

describe("citation usage", () => {
  it("classifies used, unused, and missing keys across cite commands", () => {
    expect(inspectCitationUsage(
      ["\\cite{alpha, missing}", "\\textcite[12]{beta}"],
      [binding("alpha"), binding("beta"), binding("unused")],
    )).toEqual({
      usedKeys: ["alpha", "beta"],
      unusedKeys: ["unused"],
      missingKeys: ["missing"],
    });
  });
});

it("recognizes project-local bibliography keys, starred cite commands, nocite and ignores comments", () => {
  expect(inspectCitationUsage(["\\citep*[see]{local} % \\cite{ignored}\n\\nocite{*}"], [], ["local","other"]))
    .toEqual({usedKeys:["local","other"],unusedKeys:[],missingKeys:[]});
});
