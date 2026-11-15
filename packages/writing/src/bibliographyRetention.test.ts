import {expect, it} from "vitest";
import {retainedBibliographyKeys} from "./bibliographyRetention";
import type {CitationBinding} from "./citationBinding";
const binding = (citationKey: string, bibtexEntry = `@book{${citationKey},title={Synthetic}}`): CitationBinding => ({
  manuscriptId: "m", literatureItemId: citationKey, citationKey, bibtexEntry, state: "active", pinnedAt: "now", updatedAt: "now",
});
it("keeps imports, retains automatic entries used by any source and restores the same identity", () => {
  const imports = [{citationKey: "local", bibtexEntry: "@book{local,title={Import}}"}];
  const automatic = [binding("auto")];
  expect([...retainedBibliographyKeys([], automatic, imports)]).toEqual(["local"]);
  expect([...retainedBibliographyKeys([], automatic, imports, false)]).toEqual([]);
  expect(retainedBibliographyKeys(["", "\\cite{auto}"], automatic, imports).has("auto")).toBe(true);
  expect(retainedBibliographyKeys(["% \\cite{auto}"], automatic, imports).has("auto")).toBe(false);
  expect(retainedBibliographyKeys(["\\nocite{*}"], automatic, imports).has("auto")).toBe(true);
  expect(retainedBibliographyKeys(["\\cite{auto}"], automatic, imports).has("auto")).toBe(true);
  expect(retainedBibliographyKeys(["\\cites{local}{auto}"], automatic, imports).has("auto")).toBe(true);
  expect(retainedBibliographyKeys(["\\myreference{auto}"], automatic, imports).has("auto")).toBe(true);
});
it("keeps transitive bibliography dependencies and conservatively preserves unresolved relations", () => {
  const automatic = [binding("parent", "@book{parent,xdata={extra}}"), binding("extra"), binding("unused")];
  expect(retainedBibliographyKeys([], automatic, [{citationKey: "local", bibtexEntry: "@book{local,crossref={parent}}"}]))
    .toEqual(new Set(["local", "parent", "extra"]));
  expect(retainedBibliographyKeys([], automatic, [{citationKey: "local", bibtexEntry: "@book{local,crossref=unknownMacro}"}]).size).toBe(4);
});
