import { describe, expect, it } from "vitest";
import { dictionaryWordForms, isDictionaryQuery, normalizeDictionaryQuery, wordExplanationForSelection, isStoredWordExplanation, type StoredWordExplanation } from "./dictionary";

describe("dictionary query boundary", () => {
  it("restores the same occurrence while keeping equal words in other positions independent", () => {
    const record: StoredWordExplanation = { id:"word",attachmentId:"pdf",contentSha256:"a".repeat(64),context:{word:"work",before:"In this ",after:""},
      segments:[{pageIndex:0,text:"work",prefix:"In this ",suffix:"",rects:[{x:.1,y:.2,width:.1,height:.02}]}],explanation:{translation:"本研究",explanation:"指研究工作。",providerId:"test",modelId:"test"} };
    expect(isStoredWordExplanation(record)).toBe(true);
    expect(wordExplanationForSelection([record],record.segments)).toBe(record);
    expect(wordExplanationForSelection([record],[{...record.segments[0]!,pageIndex:1}])).toBeUndefined();
    expect(wordExplanationForSelection([record],[{...record.segments[0]!,rects:[{x:.2,y:.2,width:.1,height:.02}]}])).toBeUndefined();
    expect(isStoredWordExplanation({...record,segments:[{...record.segments[0]!,rects:[{x:0,y:0,width:-1,height:.02}]}]})).toBe(false);
  });
  it("normalizes PDF ligatures, surrounding punctuation and line-break hyphenation", () => {
    expect(normalizeDictionaryQuery(" “Efﬁcient,” ")).toBe("efficient");
    expect(normalizeDictionaryQuery("per-\n  ceived")).toBe("perceived");
    expect(normalizeDictionaryQuery("State‑of‑the‑art")).toBe("state-of-the-art");
    expect(normalizeDictionaryQuery("get   away\nwith")).toBe("get away with");
  });
  it("accepts words and short phrases but does not treat a sentence as one word", () => {
    for (const query of ["perceived", "children", "get away with", "non-axiomatic", "author's"]) expect(isDictionaryQuery(query)).toBe(true);
    for (const query of ["", "中文", "The model consists of components which provide evidence.", "a".repeat(101)]) expect(isDictionaryQuery(query)).toBe(false);
  });
  it("keeps irregular and ambiguous forms without inventing a linguistic interpretation", () => {
    expect(dictionaryWordForms("p:went/d:gone/i:going/3:goes/1:s/bad"))
      .toEqual([{ label: "过去式", word: "went" }, { label: "过去分词", word: "gone" },
        { label: "现在分词", word: "going" }, { label: "第三人称单数", word: "goes" }]);
  });
});
