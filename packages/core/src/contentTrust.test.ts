import { describe, expect, it } from "vitest";

import {
  aggregateContentTrust,
  confirmableContentTrustIds,
  nextPendingContentTrustNode,
  summarizeContentTrust,
  type ContentTrustNode,
} from "./contentTrust";

const tree: ContentTrustNode = {
  id: "paper",
  label: "文献",
  directStatus: "trusted",
  children: [
    {
      id: "metadata",
      label: "基础信息",
      children: [
        { id: "title", label: "标题", directStatus: "trusted", confirmable: true },
        { id: "doi", label: "DOI", directStatus: "reviewable", confirmable: true },
      ],
    },
    {
      id: "reading",
      label: "结构化阅读",
      children: [
        { id: "result", label: "关键结果", directStatus: "untrusted", confirmable: true },
        { id: "empty", label: "局限", directStatus: "neutral", confirmable: true },
      ],
    },
  ],
};

describe("content trust tree", () => {
  it("uses the least-trusted descendant and ignores neutral content", () => {
    expect(aggregateContentTrust(tree)).toBe("untrusted");
    expect(aggregateContentTrust({
      id: "neutral-root",
      label: "空内容",
      children: [{ id: "empty", label: "空字段", directStatus: "neutral" }],
    })).toBe("neutral");
  });

  it("summarizes pending and confirmable descendants", () => {
    expect(summarizeContentTrust(tree)).toMatchObject({
      status: "untrusted",
      untrustedCount: 1,
      reviewableCount: 1,
      trustedCount: 2,
      neutralCount: 3,
      pendingCount: 2,
      confirmablePendingCount: 2,
    });
    expect(confirmableContentTrustIds(tree)).toEqual(["doi", "result"]);
  });

  it("moves through actionable pending nodes in stable depth-first order", () => {
    expect(nextPendingContentTrustNode(tree)?.id).toBe("doi");
    expect(nextPendingContentTrustNode(tree, "doi")?.id).toBe("result");
    expect(nextPendingContentTrustNode(tree, "result")?.id).toBe("doi");
  });
});
