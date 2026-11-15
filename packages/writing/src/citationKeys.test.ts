import { expect, it } from "vitest";
import { planCitationKeys, rewriteCitationKeys, citationSuffix } from "./citationKeys";
import type { ProjectBibliographyEntry } from "./citationBinding";
import { emptyLiteratureDraft } from "@research-assistant/core/literature";

const entry = (id: string, key: string): ProjectBibliographyEntry => ({id,manuscriptId:"m",citationKey:key,baseKey:"xu2026vision",originalKey:key,originalBibtex:"",bibtexEntry:"",imported:emptyLiteratureDraft(),current:emptyLiteratureDraft(),libraryItem:null,paths:[]});
it("suffixes every colliding live identity and restores the singleton name", () => {
  const first = entry("A","xu2026vision"), second = entry("B","xu2026vision2");
  expect(planCitationKeys([second,first],new Set(["A","B"])).map(row => row.to)).toEqual(["xu2026vision:b","xu2026vision:a"]);
  const renamed = [entry("A","xu2026vision:a"),entry("B","xu2026vision:b")];
  expect(planCitationKeys(renamed,new Set(["B"])).map(row => row.to)).toEqual(["xu2026vision:a","xu2026vision"]);
  expect(citationSuffix(26)).toBe("aa");
});
it("renames exact citation ranges while preserving whitespace and literal examples", () => {
  const source = "文字 \\citep*[see]{ key,other }\n% \\cite{key}\n\\verb|\\cite{key}|\n\\begin{verbatim}\n\\cite{key}\n\\end{verbatim}\n\\cite{key";
  const result = rewriteCitationKeys(source,new Map([["key","key:a"]]));
  expect(result).toBe(source.replace("{ key,other }","{ key:a,other }").replace(/\\cite\{key$/u,"\\cite{key:a"));
});
it("does not misinterpret an imported literal suffix as an automatically assigned suffix", () => {
  const first = entry("A","xu2026vision"), literal = {...entry("C","xu2026vision:a"),baseKey:"xu2026vision:a"};
  const second = entry("B","xu2026vision2");
  const planned = planCitationKeys([first,second,literal],new Set(["A","B","C"]));
  expect(new Set(planned.map(row => row.to)).size).toBe(3);
  expect(planned[2]?.to).toBe("xu2026vision:a");
});

it("recognizes imported suffix families and refuses ambiguous legacy source keys", () => {
  const a={...entry("A","xu2026vision:a"),baseKey:undefined,originalKey:"xu2026vision:a"};
  const b={...entry("B","xu2026vision:b"),baseKey:undefined,originalKey:"xu2026vision:b"};
  const {baseKey:_a,...first}=a;const {baseKey:_b,...second}=b;
  expect(planCitationKeys([first,second],new Set(["A"])).find(row=>row.referenceId==="A")?.to).toBe("xu2026vision");
  expect(()=>planCitationKeys([entry("A","duplicate"),entry("B","duplicate")],new Set(["A","B"]))).toThrow("无法确定旧引用归属");
});

it("folds legacy bases before disambiguation without merging reference identities", () => {
  const first = {...entry("A", "Xu2026Vision"), baseKey: "Xu2026Vision"};
  const second = {...entry("B", "xu2026vision"), baseKey: "xu2026vision"};
  const planned = planCitationKeys([second, first], new Set(["A", "B"]));
  expect(planned.map(row => [row.referenceId, row.baseKey, row.to])).toEqual([
    ["B", "xu2026vision", "xu2026vision:b"],
    ["A", "xu2026vision", "xu2026vision:a"],
  ]);
  expect(rewriteCitationKeys("\\cite{Xu2026Vision,xu2026vision}", new Map(planned.map(row => [row.from, row.to]))))
    .toBe("\\cite{xu2026vision:a,xu2026vision:b}");
  const inactive = planCitationKeys([first, second], new Set(["B"]));
  expect(inactive.find(row => row.referenceId === "B")?.to).toBe("xu2026vision");
  expect(inactive.every(row => row.to === row.to.toLowerCase())).toBe(true);
});

it("recognizes imported suffix families irrespective of historical casing", () => {
  const {baseKey: _first, ...first} = {...entry("A", "Xu2026Vision:A"), originalKey: "Xu2026Vision:A"};
  const {baseKey: _second, ...second} = {...entry("B", "xu2026vision:b"), originalKey: "xu2026vision:b"};
  expect(planCitationKeys([first, second], new Set(["A", "B"])).map(row => row.to))
    .toEqual(["xu2026vision:a", "xu2026vision:b"]);
  expect(planCitationKeys([first, second], new Set(["A"])).find(row => row.referenceId === "A")?.to)
    .toBe("xu2026vision");
});
