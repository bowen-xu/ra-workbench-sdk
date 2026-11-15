import { describe, expect, it } from "vitest";
import { dictionaryEditDistance, stripDictionaryWord } from "./dictionaryMatching";

describe("offline dictionary candidate matching", () => {
  it("uses ECDICT strip-word equivalence without choosing a meaning", () => {
    expect(["long-time", "long time", "longtime"].map(stripDictionaryWord)).toEqual(["longtime", "longtime", "longtime"]);
    expect(stripDictionaryWord("(COVID-19)")).toBe("covid19");
  });
  it.each([
    ["work", "wrok", 1], ["catt", "cat", 1], ["perceve", "perceive", 1], ["modle", "model", 1],
    ["recogniton", "recognition", 1], ["recongition", "recognition", 1], ["abcdef", "abqdef", 1],
    ["abcdef", "abqdez", 2], ["abcdef", "uvwxyz", 3], ["", "ab", 2],
  ])("validates bounded distance %s → %s", (left, right, distance) => {
    expect(dictionaryEditDistance(left, right, 2)).toBe(distance);
    expect(dictionaryEditDistance(right, left, 2)).toBe(distance);
  });
});
