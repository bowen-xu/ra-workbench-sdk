import { describe, expect, it } from "vitest";

import {
  exportLiterature,
  formatBibliography,
  formatInTextCitation,
  parseBibtex,
} from "./citation";

const BIBTEX = `
@article{Xu2026,
  author = {徐, 博文 and M{\\\"u}ller, Anna},
  title = {A {Unicode} study of 可追溯 research},
  journal = {Journal of Tests},
  year = {2026},
  doi = {10.1000/test}
}`;

describe("citation boundary", () => {
  it("parses BibTeX without losing Unicode or author order", () => {
    const [item] = parseBibtex(BIBTEX);
    expect(item?.title).toContain("可追溯");
    expect(item?.creators.map((creator) => creator.familyName)).toEqual([
      "徐",
      "Müller",
    ]);
    expect(item?.rawBibtex).toBe(BIBTEX);
  });

  it("degrades unknown entry types to a generic document", () => {
    const [item] = parseBibtex("@misc{odd, title={Unknown form}, year={2024}}");
    expect(item?.itemType).toBe("document");
    expect(item?.bibtexKey).toBe("odd");
  });

  it.each([
    ["@book{book, title={Collected Work}, year={2024}}", "book"],
    ["@inbook{chapter, title={A Chapter}, booktitle={Collected Work}, year={2024}}", "bookSection"],
    ["@proceedings{proceedings, title={Conference Proceedings}, year={2024}}", "book"],
    ["@inproceedings{paper, title={Conference Paper}, booktitle={Conference Proceedings}, year={2024}}", "conferencePaper"],
    ["@phdthesis{thesis, title={A Thesis}, school={Test University}, year={2024}}", "thesis"],
    ["@unpublished{draft, title={A Manuscript}, year={2024}}", "manuscript"],
  ] as const)("maps common BibTeX type %# through the Citation.js boundary", (input, expected) => {
    expect(parseBibtex(input)[0]?.itemType).toBe(expected);
  });

  it.each([
    ["magazineArticle", "article-magazine"],
    ["newspaperArticle", "article-newspaper"],
    ["book", "book"],
    ["bookSection", "chapter"],
    ["preprint", "manuscript"],
    ["manuscript", "manuscript"],
    ["thesis", "thesis"],
    ["dataset", "dataset"],
    ["computerProgram", "software"],
    ["webpage", "webpage"],
    ["standard", "standard"],
    ["patent", "patent"],
    ["document", "document"],
  ] as const)("exports %s as CSL %s", (itemType, expected) => {
    const [base] = parseBibtex(BIBTEX);
    expect(base).toBeDefined();
    const csl = JSON.parse(exportLiterature([{ ...base!, itemType }], "csl-json"));
    expect(csl[0]?.type).toBe(expected);
  });

  it("exports interoperable BibTeX, RIS and CSL JSON", () => {
    const items = parseBibtex(BIBTEX);
    expect(exportLiterature(items, "bibtex")).toContain("@article");
    expect(exportLiterature(items, "ris")).toContain("TY  - JOUR");
    expect(JSON.parse(exportLiterature(items, "csl-json"))).toHaveLength(1);
  });

  it("round-trips conference semantics through the CSL boundary", () => {
    const [base] = parseBibtex("@inproceedings{agi, title={A Paper}, booktitle={Artificial General Intelligence}, year={2026}}");
    expect(base).toBeDefined();
    expect(base?.containerTitle).toBe("");
    expect(base?.proceedingsTitle).toBe("Artificial General Intelligence");
    const conference = {
      ...base!,
      conferenceName: "International Conference on Artificial General Intelligence",
      proceedingsTitle: "Artificial General Intelligence",
      place: "Reykjavik, Iceland",
    };
    const [csl] = JSON.parse(exportLiterature([conference], "csl-json"));
    expect(csl).toMatchObject({
      type: "paper-conference",
      "container-title": "Artificial General Intelligence",
      "event-title": "International Conference on Artificial General Intelligence",
      "event-place": "Reykjavik, Iceland",
    });
    expect(exportLiterature([conference], "bibtex")).toContain("booktitle = {Artificial {General} {Intelligence}}");
    expect(exportLiterature([conference], "ris")).toContain("Artificial General Intelligence");
  });

  it("keeps authors and editors in separate CSL creator variables", () => {
    const [base] = parseBibtex("@incollection{chapter, author={Xu, Bowen}, editor={Iklé, Matthew}, title={A Chapter}, booktitle={A Book}, year={2026}}");
    expect(base?.creators.map(({ familyName, role }) => ({ familyName, role }))).toEqual([
      { familyName: "Xu", role: "author" },
      { familyName: "Iklé", role: "editor" },
    ]);
    const [csl] = JSON.parse(exportLiterature([base!], "csl-json"));
    expect(csl.author).toEqual([{ family: "Xu", given: "Bowen" }]);
    expect(csl.editor).toEqual([{ family: "Iklé", given: "Matthew" }]);
  });

  it("formats bibliography and in-text citations through CSL", () => {
    const items = parseBibtex(BIBTEX);
    expect(formatBibliography(items, "apa")).toContain("2026");
    expect(formatBibliography(items, "nature")).toContain("Journal of Tests");
    expect(formatBibliography(items, "ieee")).toContain("Journal of Tests");
    expect(formatInTextCitation(items, "nature")).toMatch(/\d/);
  });
});

it("preserves explicit BibTeX labels across metadata edits and library promotion",()=>{
 const original=parseBibtex("@article{projectPinned2026,title={Original},author={Example, Alice},year={2026}}")[0];
 if(!original)throw new Error("Missing synthetic entry");
 const modified={...original,id:"library-identity",title:"New title",issuedYear:2027,creators:[{familyName:"Other",givenName:"Bob",literalName:"",role:"author"}]};
 expect(parseBibtex(exportLiterature([modified],"bibtex"))[0]?.bibtexKey).toBe("projectPinned2026");
});

it("preserves managed punctuation keys instead of silently regenerating BibTeX labels", () => {
 const original=parseBibtex("@article{xu2026vision,title={Vision},author={Xu},year={2026}}")[0]!;
 const output=exportLiterature([{...original,bibtexKey:"xu2026vision:a"},{...original,bibtexKey:"xu2026vision:b",title:"Vision second"}],"bibtex");
 expect(parseBibtex(output).map(item=>item.bibtexKey)).toEqual(["xu2026vision:a","xu2026vision:b"]);
 expect(output).not.toContain("ResearchAssistantPinnedCitation");
});
