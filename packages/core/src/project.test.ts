import { describe, expect, it } from "vitest";

import { normalizeProjectDraft } from "./project";

describe("normalizeProjectDraft", () => {
  it("trims user input", () => {
    expect(
      normalizeProjectDraft({ title: "  记忆形成机制  ", summary: "  海马体研究  " }),
    ).toEqual({ title: "记忆形成机制", summary: "海马体研究" });
  });

  it("rejects an empty title", () => {
    expect(() => normalizeProjectDraft({ title: "   ", summary: "" })).toThrow(
      "项目名称不能为空",
    );
  });
});
