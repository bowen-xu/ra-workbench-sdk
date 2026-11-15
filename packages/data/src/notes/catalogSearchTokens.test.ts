import {expect, it} from "vitest";
import {filterNoteIndexRecords, notePageId, type NoteIndexRecord} from "@research-assistant/core/notes";
import {intersectNoteSearchCandidates, noteSearchCandidateOrdinals, noteSearchGramDelta, noteSearchGrams, noteSearchQueryGrams, updateNoteSearchPosting} from "./catalogSearchTokens";

it("keeps literal Unicode, punctuation and cross-field candidates equivalent to existing search", () => {
  const texts = ["核心概念与研究", "👩‍🔬 研究问题", "A-B/C% literal*", "İSTANBUL ΟΣ", "prefixabc-suffixabcd", "AAABBB", "line\nsecond", "\u0085literal", "x\u0000y"];
  const records: NoteIndexRecord[] = texts.map((text, index) => ({id: `page:${index + 1}`,title: `笔记${index + 1}`, snippet: "",searchText: `来源${index + 1} ${text}`,category: "independent",status: "active",updatedAt: "2026-10-23T00:00:00Z",isFavorite: false,target: {kind: "page",pageId: notePageId(String(index + 1))}}));
  const postings = new Map<string, Uint32Array>();
  records.forEach((record, index) => {
    for (const [part, text] of [texts[index]!, `来源${index + 1}`].entries()) for (const gram of noteSearchGrams(text.toLowerCase())) {
      postings.set(gram, updateNoteSearchPosting(postings.get(gram) ?? new Uint32Array(), 2 * (index + 1) + part, true));
    }
  });
  for (const query of ["核心", "念", "👩‍🔬", "来源2 研究", "A-B/C%", "literal*", "İSTANBUL", "ος", "prefixabcd", "second", "\u0085literal", "x\u0000y", "missing", "研究 missing"]) {
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const selected = terms.map(term => noteSearchQueryGrams(term).map(gram => postings.get(gram) ?? new Uint32Array()).sort((a, b) => a.length - b.length)[0]!);
    const candidates = [...intersectNoteSearchCandidates(selected.map(noteSearchCandidateOrdinals))];
    const actual = candidates.map(id => records[id - 1]!).filter(record => terms.every(term => record.searchText.toLowerCase().includes(term))).map(record => record.id);
    expect(actual, query).toEqual(filterNoteIndexRecords(records, {category: "all",view: "recent",search: query}).map(record => record.id));
  }
});

it("does not create a term across query whitespace or split surrogate pairs", () => {
  expect(noteSearchGrams("a\u00a0b\tc\u2029d")).toEqual(new Set(["a", "b", "c", "d"]));
  expect(noteSearchQueryGrams("👩‍🔬x")).toEqual(["👩‍🔬", "‍🔬x"]);
  expect([...noteSearchGrams("😀")]).toEqual(["😀"]);
});

it("updates only changed membership and leaves unchanged posting arrays intact", () => {
  const before = noteSearchGrams("alpha beta"), after = noteSearchGrams("beta alpha");
  expect(noteSearchGramDelta(before, after)).toEqual({added: [],removed: []});
  const changed = noteSearchGramDelta(noteSearchGrams("核心概念"), noteSearchGrams("核心机制"));
  expect(changed.removed).toContain("概念"); expect(changed.added).toContain("机制");
  expect(changed.removed).not.toContain("核心"); expect(changed.added).not.toContain("核心");
  const values = Uint32Array.of(2, 5, 8);
  expect(updateNoteSearchPosting(values, 5, true)).toBe(values);
  expect(updateNoteSearchPosting(values, 6, false)).toBe(values);
  expect([...updateNoteSearchPosting(values, 6, true)]).toEqual([2, 5, 6, 8]);
  expect([...updateNoteSearchPosting(values, 5, false)]).toEqual([2, 8]);
  expect([...values]).toEqual([2, 5, 8]);
});

it("collapses body/metadata components and preserves the unsigned ordinal boundary", () => {
  expect([...noteSearchCandidateOrdinals(Uint32Array.of(2, 3, 6, 0xffff_fffe, 0xffff_ffff))]).toEqual([1, 3, 0x7fff_ffff]);
  const left = Uint32Array.of(1, 3, 9), right = Uint32Array.of(3, 8, 9);
  expect([...intersectNoteSearchCandidates([left, right])]).toEqual([3, 9]);
  expect([...left]).toEqual([1, 3, 9]); expect([...right]).toEqual([3, 8, 9]);
});

it.each([Uint32Array.of(0), Uint32Array.of(3, 2), Uint32Array.of(2, 2)])("rejects malformed persistent postings instead of false matches", values => {
  expect(() => noteSearchCandidateOrdinals(values)).toThrow("note_search_postings_invalid");
});
