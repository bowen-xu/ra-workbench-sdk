import { describe, expect, it } from "vitest";

import { createStableCitationKey, isValidCitationKey } from "./citationKey";

describe("citation keys", () => {
  it("normalizes a legal imported key to lowercase", () => {
    expect(createStableCitationKey({ importedKey: "Knuth1984" }, new Set())).toBe("knuth1984");
    expect(createStableCitationKey({ importedKey: "Xu2026Vision:A" }, new Set())).toBe("xu2026vision:a");
    expect(createStableCitationKey({ importedKey: "Xu2026Vision" }, new Set(["XU2026VISION"]))).toBe("xu2026vision2");
  });

  it("generates deterministic keys and resolves collisions", () => {
    const seed = { firstAuthor: "García", issuedYear: 2024, title: "A useful result" };
    expect(createStableCitationKey(seed, new Set())).toBe("garcia2024useful");
    expect(createStableCitationKey(seed, new Set(["garcia2024Useful", "garcia2024useful2"]))).toBe(
      "garcia2024useful3",
    );
  });

  it("rejects keys that cannot safely appear in a citation command", () => {
    expect(isValidCitationKey("2024 paper")).toBe(false);
    expect(isValidCitationKey("paper:2024-a")).toBe(true);
  });
});

it("keeps collision suffixes inside the citation-key length limit",()=>{
 const original="a".repeat(128);const key=createStableCitationKey({importedKey:original},new Set([original,"a".repeat(127)+"2"]));
 expect(key).toBe("a".repeat(127)+"3");expect(isValidCitationKey(key)).toBe(true);
});
