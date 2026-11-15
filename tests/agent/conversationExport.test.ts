import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AgentExportDecodeError, decodeAgentConversationExport } from "../../packages/core/src/agent";
import { createAgentConversationExportGateway } from "../../packages/data/src/agent";

const rawFixture: unknown = JSON.parse(readFileSync(new URL("../fixtures/agent/conversation-export.json", import.meta.url), "utf8"));
const fixture = decodeAgentConversationExport(rawFixture);
const owner = "00000000-0000-0000-0000-000000000001";

describe("portable conversation export", () => {
  it("exports native item metadata without continuation material or an invented assistant body", () => {
    const turn = fixture.turns[0]!;
    const native = { ...turn.items[0]!, kind: { type: "providerNative", itemType: "reasoning" }, text: "", completed: true, interrupted: false };
    const value = { ...fixture, turns: [{ ...turn, items: [native] }] };
    expect(decodeAgentConversationExport(value).turns[0]?.items[0]?.kind).toEqual(native.kind);
    for (const patch of [{ text: "opaque" }, { providerDataJson: "opaque" }, { completed: false }]) {
      expect(() => decodeAgentConversationExport({ ...value, turns: [{ ...turn, items: [{ ...native, ...patch }] }] })).toThrow();
    }
  });
  it("downloads by identity only and rejects invalid or mismatched receipts without retry", async () => {
    const receipt = { schemaVersion: 1, conversationId: owner, watermark: 19, destinationPath: "/Downloads/研究对话 (1).json", byteSize: 512 };
    const invoke = vi.fn().mockResolvedValue(receipt);
    const gateway = createAgentConversationExportGateway(invoke);
    expect(await gateway.download(owner)).toEqual(receipt);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_download_conversation", { request: { conversationId: owner } });
    for (const patch of [{ conversationId: "00000000-0000-0000-0000-000000000099" }, { byteSize: 0 }, { destinationPath: "relative.json" }, { watermark: -1 }, { schemaVersion: 2 }]) {
      invoke.mockClear().mockResolvedValue({ ...receipt, ...patch });
      await expect(gateway.download(owner)).rejects.toBeInstanceOf(AgentExportDecodeError);
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("decodes the actual Rust serializer contract without merging partial output", async () => {
    const invoke = vi.fn().mockResolvedValue(rawFixture);
    const value = await createAgentConversationExportGateway(invoke).snapshot(owner);
    expect(value).toEqual(rawFixture);
    expect(value.turns[0]?.items[3]).toMatchObject({ text: "回答 🧪", completed: false, interrupted: false });
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_export_conversation_snapshot", { request: { conversationId: owner } });
    expect(value).not.toBe(rawFixture);
  });

  it("does not accept another conversation, invalid requests, or retry native failures", async () => {
    const invoke = vi.fn().mockResolvedValue(fixture);
    const gateway = createAgentConversationExportGateway(invoke);
    await expect(gateway.snapshot("invalid")).rejects.toBeInstanceOf(AgentExportDecodeError);
    await expect(gateway.snapshot("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(AgentExportDecodeError);
    expect(invoke).not.toHaveBeenCalled();
    await expect(gateway.snapshot("00000000-0000-0000-0000-000000000099")).rejects.toBeInstanceOf(AgentExportDecodeError);
    invoke.mockClear().mockRejectedValue("tooLarge");
    await expect(gateway.snapshot(owner)).rejects.toBe("tooLarge");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("preserves empty and archived exports", () => {
    const empty = { ...fixture, conversation: { ...fixture.conversation, archived: true }, watermark: 0, turns: [] };
    expect(decodeAgentConversationExport(empty)).toEqual(empty);
  });

  it("rejects unknown private fields, unsupported versions and malformed nested data", () => {
    const turn = fixture.turns[0];
    const invalidTurns = [
      { ...turn, items: turn.items.map((item, i) => i === 1 ? { ...item, kind: { ...item.kind, providerCallId: "private" } } : item) },
      { ...turn, attempts: [{ ...turn.attempts[0], responseId: "private" }] },
      { ...turn, outcome: undefined },
      { ...turn, items: [...turn.items, turn.items[0]] },
      { ...turn, items: [{ ...turn.items[0], interrupted: true }] },
      { ...turn, inputTokens: Number.MAX_SAFE_INTEGER + 1 },
    ];
    const values: unknown[] = [
      { ...fixture, schemaVersion: 2 }, { ...fixture, format: "other" },
      { ...fixture, checkpoint: "private" }, { ...fixture, watermark: 0 },
      { ...fixture, conversation: { ...fixture.conversation, createdAt: "invalid" } },
      { ...fixture, conversation: { ...fixture.conversation, title: " " } },
      ...invalidTurns.map((turn) => ({ ...fixture, turns: [turn] })),
    ];
    for (const value of values) {
      expect(() => decodeAgentConversationExport(value)).toThrow(AgentExportDecodeError);
    }
  });
});
