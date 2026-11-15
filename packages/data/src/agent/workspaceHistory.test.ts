import { expect, it, vi } from "vitest";
import { decodeAgentWorkspaceHistory } from "@research-assistant/core/agent";
import { createAgentWorkspaceReviewGateway } from "./workspaceReview";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const request = { conversationId:id, manuscriptId:id, cursor:null, limit:1 };
const entry = { scope:{conversationId:id, manuscriptId:id, requestId:id, contextSnapshotId:id}, turnId:id, createdAt:"2026-09-09T00:00:00.000Z" };
const page = {schemaVersion:1, entries:[entry], nextCursor:id};
it("restores a published identity without body data and keeps older pages compatible", () => {
  expect(decodeAgentWorkspaceHistory(page, request)).toEqual(page);
  const persisted = {...page, entries:[{...entry, publishedProposalId: other}]};
  expect(decodeAgentWorkspaceHistory(persisted, request)).toEqual(persisted);
  for (const publishedProposalId of [null, "invalid", 42]) {
    expect(() => decodeAgentWorkspaceHistory({...page, entries:[{...entry, publishedProposalId}]}, request)).toThrow();
  }
  expect(() => decodeAgentWorkspaceHistory({...page, entries:[{...entry, before:"private body"}]}, request)).toThrow();
});
it("routes and freezes a scoped history query", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise<unknown>((resolve) => { finish=resolve; }));
  const input = {...request}; const promise = createAgentWorkspaceReviewGateway(invoke).list(input);
  input.conversationId=other; input.limit=20;
  finish(page);
  expect(await promise).toEqual(page);
  expect(invoke).toHaveBeenCalledWith("agent_list_writing_workspace_reviews",{request});
});
it("rejects cross-scope, malformed, duplicate, unordered and non-progressing pages", () => {
  for (const value of [ {...page,schemaVersion:2}, {...page,extra:true}, {...page,nextCursor:other},
    {...page,entries:[]}, {...page,entries:[entry,entry]},
    {...page,entries:[{...entry,scope:{...entry.scope,manuscriptId:other}}]},
    {...page,entries:[{...entry,createdAt:"2026-02-30T00:00:00.000Z"}]},
    {...page,entries:[{...entry,turnId:"invalid"}]},
  ]) expect(() => decodeAgentWorkspaceHistory(value,request)).toThrow();
  expect(() => decodeAgentWorkspaceHistory(page,{...request,cursor:id})).toThrow();
  expect(() => decodeAgentWorkspaceHistory(page,{...request,limit:101})).toThrow();
  const newer={...entry,scope:{...entry.scope,requestId:other},turnId:other};
  expect(() => decodeAgentWorkspaceHistory({...page,entries:[entry,newer],nextCursor:null},{...request,limit:2})).toThrow();
  expect(decodeAgentWorkspaceHistory({...page,entries:[newer,entry],nextCursor:null},{...request,limit:2}).entries).toHaveLength(2);
  expect(decodeAgentWorkspaceHistory({schemaVersion:1,entries:[],nextCursor:null},request).entries).toEqual([]);
});
