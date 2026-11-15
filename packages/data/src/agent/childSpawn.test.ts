import { describe, expect, it, vi } from "vitest";
import { createAgentChildSpawnGateway } from "./childSpawn";

const parent = "11111111-1111-4111-8111-111111111111";
const turn = "22222222-2222-4222-8222-222222222222";
const page = "33333333-3333-4333-8333-333333333333";
const response = {
  schemaVersion: 1,
  childConversationId: "44444444-4444-4444-8444-444444444444",
  requestId: "55555555-5555-4555-8555-555555555555",
  turnId: "66666666-6666-4666-8666-666666666666",
  contextSnapshotId: "77777777-7777-4777-8777-777777777777",
};

describe("agent child spawn gateway", () => {
  it("keeps paper and note commands separate and validates responses", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("agent_spawn_paper_child");
      return response;
    });
    const gateway = createAgentChildSpawnGateway(invoke);
    await expect(gateway.spawnPaper({
      parentConversationId: parent,
      parentTurnId: turn,
      paperId: "paper-1",
      paperContextSnapshotId: "snapshot-1",
      expectedContextHash: "hash-1",
      prompt: "compare the methods",
    })).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledWith("agent_spawn_paper_child", expect.anything());
  });

  it("rejects unbounded prompts before invoking native", async () => {
    const invoke = vi.fn();
    const gateway = createAgentChildSpawnGateway(invoke);
    await expect(gateway.spawnNote({
      parentConversationId: parent,
      parentTurnId: turn,
      pageId: page,
      prompt: " ",
    })).rejects.toThrow("Invalid child prompt");
    expect(invoke).not.toHaveBeenCalled();
  });
});
