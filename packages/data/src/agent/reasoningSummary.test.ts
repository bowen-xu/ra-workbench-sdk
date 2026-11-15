import { expect, it, vi } from "vitest";
import { createAgentConversationExportGateway } from "./conversationExport";

const conversationId = "11111111-1111-4111-8111-111111111111", turnId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
function wire(completed: boolean) {
  return { format: "research-assistant.conversation", schemaVersion: 1, watermark: 8,
    conversation: { id: conversationId, title: "Synthetic public summary", archived: false, createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z" },
    turns: [{ id: turnId, contextSnapshotId: itemId, model: { providerId: "fixture", modelId: "fixture", revision: null }, phase: "runningModel", outcome: completed ? "completed" : "canceled",
      inputTokens: null, outputTokens: null, attempts: [], items: [{ id: itemId, kind: { type: "reasoningSummary", parts: [
        { index: "-9223372036854775808", startByte: 0, lenByte: 3 }, { index: "9223372036854775807", startByte: 3, lenByte: 4 }] },
      text: "思🦀", completed, interrupted: !completed }] }],
  };
}
it.each([false, true])("keeps public summary parts across the export gateway (completed=%s)", async completed => {
  const value = wire(completed), invoke = vi.fn(async () => value);
  const exported = await createAgentConversationExportGateway(invoke).snapshot(conversationId);
  expect(exported).toEqual(value);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_export_conversation_snapshot", { request: { conversationId } });
});
it("rejects malformed spans and provider continuation smuggled into portable summary records", async () => {
  const value = wire(false);
  const item = value.turns[0]!.items[0]!;
  for (const replacement of [{ ...item, kind: { ...item.kind, parts: [{ index: "0", startByte: 0, lenByte: 2 }, { index: "1", startByte: 2, lenByte: 5 }] } },
    { ...item, providerDataJson: '{"opaque":"do not export"}' }]) {
    const modified = { ...value, turns: [{ ...value.turns[0]!, items: [replacement] }] };
    await expect(createAgentConversationExportGateway(async () => modified).snapshot(conversationId)).rejects.toThrow();
  }
});
