import { expect, it, vi } from "vitest";
import { decodeAgentProposalReview, type AgentWorkspaceReview } from "@research-assistant/core/agent";
import { createAgentProposalGateway } from "./proposals";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const binding = { scope: {conversationId:id,manuscriptId:id,requestId:id,contextSnapshotId:id}, turnId:id,leaseId:id,manifestHash:"a".repeat(64) };
const change = {path:"new.tex",kind:"added" as const,before:null,after:{sha256:"b".repeat(64),byteSize:1,executable:false},hasEditorBuffer:false};
const review: AgentWorkspaceReview = {schemaVersion:1,binding,changes:[change]};
const proposal = {schemaVersion:1,proposalId:id,status:"pending",review};
const request = {conversationId:id,manuscriptId:id,proposalId:id};
const file = {schemaVersion:1,proposalId:id,file:{schemaVersion:1,binding,change,before:null,after:{kind:"text",text:"x"}}};
it("routes publication and frozen reads with only the expected file versions", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(proposal).mockResolvedValueOnce(proposal).mockResolvedValueOnce(file);
  const gateway = createAgentProposalGateway(invoke);
  expect(await gateway.publish(review)).toEqual(proposal);
  expect(invoke).toHaveBeenNthCalledWith(1,"agent_publish_writing_proposal",{request:{binding,changes:[{path:change.path,before:null,after:change.after}]}});
  expect(await gateway.review(request)).toEqual(proposal);
  expect(await gateway.readFile({proposal:request,path:"new.tex"})).toEqual(file);
});
it("rejects unknown lifecycle states, extra fields and empty frozen inventories", () => {
  for (const value of [{...proposal,status:"unknown"},{...proposal,extra:true},{...proposal,proposalId:"bad"},{...proposal,review:{...review,changes:[]}}]) {
    expect(() => decodeAgentProposalReview(value)).toThrow();
  }
});
it("rejects mismatched proposals, scope, file paths and publication inventories", async () => {
  for (const response of [{...proposal,proposalId:other},{...proposal,review:{...review,binding:{...binding,scope:{...binding.scope,manuscriptId:other}}}}]) {
    await expect(createAgentProposalGateway(vi.fn().mockResolvedValue(response)).review(request)).rejects.toThrow();
  }
  await expect(createAgentProposalGateway(vi.fn().mockResolvedValue({...proposal,review:{...review,changes:[{...change,path:"other.tex"}]}})).publish(review)).rejects.toThrow();
  await expect(createAgentProposalGateway(vi.fn().mockResolvedValue({...file,file:{...file.file,change:{...change,path:"other.tex"}}})).readFile({proposal:request,path:"new.tex"})).rejects.toThrow();
});
it("retains request identity while the caller changes its object", async () => {
  let resolve!: (value: unknown) => void;
  const gateway = createAgentProposalGateway(() => new Promise(r => {resolve=r;}));
  const mutable = {...request}; const pending = gateway.review(mutable); mutable.proposalId=other;
  resolve(proposal); expect(await pending).toEqual(proposal);
});
it("discovers the latest persisted proposal only for the exact submission", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(proposal);
  const gateway = createAgentProposalGateway(invoke);
  expect(await gateway.latest(binding.scope)).toBeNull();
  expect(await gateway.latest(binding.scope)).toEqual(proposal);
  expect(invoke).toHaveBeenLastCalledWith("agent_latest_writing_proposal",{request:binding.scope});
  invoke.mockResolvedValue({...proposal,review:{...review,binding:{...binding,scope:{...binding.scope,requestId:other}}}});
  await expect(gateway.latest(binding.scope)).rejects.toThrow();
});
it("rejects only the requested proposal and requires a confirmed rejected state", async () => {
  const rejected = {...proposal,status:"rejected"};
  const invoke = vi.fn().mockResolvedValue(rejected);
  const gateway = createAgentProposalGateway(invoke);
  expect(await gateway.reject(request)).toEqual(rejected);
  expect(invoke).toHaveBeenCalledWith("agent_reject_writing_proposal",{request});
  for (const response of [proposal,{...rejected,proposalId:other},{...rejected,review:{...review,binding:{...binding,scope:{...binding.scope,conversationId:other}}}}]) {
    invoke.mockResolvedValue(response);
    await expect(gateway.reject(request)).rejects.toThrow();
  }
});
