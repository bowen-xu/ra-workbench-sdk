import { expect, it, vi } from "vitest";
import { createAgentCatalogGateway } from "./index";
import { createAgentSearchGateway } from "./search";

const row = {id: "11111111-1111-4111-8111-111111111111", title: "结构化阅读", internal: true,
  archived: false, durableCount: 5, createdAt: "2026-10-17T00:00:00.000Z", updatedAt: "2026-10-17T00:00:00.000Z"};
const scope = {archived: false, limit: 50, before: null};

it("passes an explicit internal catalog scope and rejects results from the other catalog", async () => {
  const invoke = vi.fn(async () => ({schemaVersion: 1, conversations: [row], next: null}));
  const gateway = createAgentCatalogGateway(invoke);
  await expect(gateway.list({...scope, internal: true})).resolves.toMatchObject({conversations: [row]});
  expect(invoke).toHaveBeenCalledWith("agent_list_conversations", {request: {...scope, internal: true}});
  await expect(gateway.list(scope)).rejects.toThrow();
});

it("keeps search in its selected catalog", async () => {
  const invoke = vi.fn(async () => ({schemaVersion: 1, hits: [{conversation: row, excerpt: row.title,
    itemId: null, turnId: null, startSeq: null, completed: true}], next: null}));
  const gateway = createAgentSearchGateway(invoke);
  await expect(gateway.search({term: "结构化", scope: {...scope, internal: true}})).resolves.toMatchObject({hits: [{conversation: row}]});
  await expect(gateway.search({term: "结构化", scope})).rejects.toThrow();
});
