import { expect, it, vi } from "vitest";
import {
  AgentNoteSubmissionDecodeError, decodeAgentNoteSubmissionPreview, decodeAgentSubmissionInput,
  type AgentNotePrepareRequest, type AgentNoteSubmissionPreview,
} from "@research-assistant/core/agent";
import { createAgentNoteSubmissionGateway } from "./noteSubmission";

const conversationId = "a1111111-1111-4111-8111-111111111111";
const requestId = "b1111111-1111-4111-8111-111111111111";
const pageId = "c1111111-1111-4111-8111-111111111111";
const turnId = "d1111111-1111-4111-8111-111111111111";
const contextSnapshotId = "e1111111-1111-4111-8111-111111111111";
const receipt = { conversationId, requestId, pageId };
const model = { providerId: "deepseek", modelId: "deepseek-v4-pro", revision: null };
function preview(revision = 2): AgentNoteSubmissionPreview {
  return { schemaVersion: 1, ...receipt, turnId, contextSnapshotId, input: {
    text: "Explain this note", model: { ...model }, reasoningEffort: null,
    context: [{ kind: "note", sourceId: `note:${"a".repeat(64)}`, resourceId: pageId,
      revision: `revision:${revision}:sha256:${"b".repeat(64)}`,
      anchor: JSON.stringify({schemaVersion:1,pageId,pageRevision:revision,blockId:"selected"}),
      text: JSON.stringify({schemaVersion:1,pageId,pageRevision:revision,title:"Synthetic",blocks:[{
        id:"selected",type:"paragraph",props:{},content:{kind:"inline",items:[{type:"text",text:"Frozen evidence",styles:[]}]},children:[],
      }]}),
    }],
  } };
}
function request(): AgentNotePrepareRequest {
  return { conversationId, requestId, text: "Explain this note", context: {pageId,expectedRevision:2,blockId:"selected"},
    model: {providerId:model.providerId,modelId:model.modelId,reasoningEffort:null} };
}
function admission() { return {schemaVersion:1,conversationId,requestId,turnId,alreadyStarted:false,outcome:null}; }

it("prepares and restores exact evidence without starting or substituting current revisions", async () => {
  const original = preview();
  const invoke = vi.fn().mockResolvedValue(original);
  const gateway = createAgentNoteSubmissionGateway(invoke);
  expect(await gateway.prepare(request())).toEqual(original);
  expect(invoke).toHaveBeenLastCalledWith("agent_prepare_note_submission", {request:request()});
  invoke.mockResolvedValue(preview(1));
  expect(await gateway.restore(receipt)).toEqual(preview(1));
  expect(invoke).toHaveBeenLastCalledWith("agent_restore_note_submission", {request:receipt});
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(decodeAgentSubmissionInput(original.input)).toEqual(original.input);
});

it("allows native default model resolution and retains exact source bytes", async () => {
  const original = preview();
  const source = original.input.context[0]!;
  const result = {...original,input:{...original.input,model:{...model,modelId:"native-default"},reasoningEffort:"medium",
    context:[{...source,text:`\n${source.text}\n`}],instructions:[],instructionConfigs:[],skills:[]}};
  const invoke = vi.fn().mockResolvedValue(result);
  const {model: _model, ...input} = request();
  expect(await createAgentNoteSubmissionGateway(invoke).prepare(input)).toEqual(result);
  expect(invoke.mock.calls[0]?.[1].request.model).toBeNull();
});

it("starts only the reviewed identity and verifies the returned turn", async () => {
  const invoke = vi.fn().mockResolvedValue(admission());
  const gateway = createAgentNoteSubmissionGateway(invoke);
  expect(await gateway.start(preview(), "deepSeekNonThinking")).toEqual(admission());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_start_note_submission", {request:{...receipt,contextSnapshotId,model,mode:"deepSeekNonThinking"}});
  for (const patch of [{conversationId:pageId}, {requestId:pageId}, {turnId:pageId}]) {
    invoke.mockResolvedValue({...admission(),...patch});
    await expect(gateway.start(preview(), "deepSeekNonThinking")).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
  }
  invoke.mockResolvedValue({...admission(),alreadyStarted:true,outcome:"canceled"});
  expect((await gateway.start(preview(), "deepSeekNonThinking")).outcome).toBe("canceled");
});

it("rejects changed content, selected subtree, explicit model and response envelope identities", async () => {
  const mutations = [
    (p: AgentNoteSubmissionPreview) => ({...p,conversationId:pageId}),
    (p: AgentNoteSubmissionPreview) => ({...p,requestId:pageId}),
    (p: AgentNoteSubmissionPreview) => ({...p,pageId:conversationId}),
    (p: AgentNoteSubmissionPreview) => ({...p,input:{...p.input,text:"Changed question"}}),
    (p: AgentNoteSubmissionPreview) => ({...p,input:{...p.input,model:{...model,modelId:"different"}}}),
    (p: AgentNoteSubmissionPreview) => ({...p,input:{...p.input,reasoningEffort:"medium"}}),
    () => preview(3),
    (p: AgentNoteSubmissionPreview) => ({...p,input:{...p.input,context:p.input.context.map(source => ({...source,
      anchor:JSON.stringify({schemaVersion:1,pageId,pageRevision:2,blockId:null})}))}}),
  ];
  for (const mutate of mutations) {
    const invoke = vi.fn().mockResolvedValue(mutate(preview()));
    await expect(createAgentNoteSubmissionGateway(invoke).prepare(request())).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
    expect(invoke).toHaveBeenCalledOnce();
  }
});

it("isolates request and transport object mutations during preparation", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn((_command, args) => {
    args.request.context.pageId = conversationId;
    args.request.model.modelId = "transport changed";
    return new Promise(done => { finish = done; });
  });
  const mutable = JSON.parse(JSON.stringify(request()));
  const pending = createAgentNoteSubmissionGateway(invoke).prepare(mutable);
  mutable.text = "new input"; mutable.context.expectedRevision = 3; mutable.model.modelId = "caller changed";
  finish(preview());
  expect(await pending).toEqual(preview());
});

it("isolates receipt and confirmation mutations while preserving response checks", async () => {
  for (const mode of ["restore", "start"] as const) {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn((_command, args) => {
      args.request.requestId = pageId;
      if (args.request.model) args.request.model.modelId = "transport changed";
      return new Promise(done => { finish = done; });
    });
    const gateway = createAgentNoteSubmissionGateway(invoke);
    const mutable = JSON.parse(JSON.stringify(mode === "restore" ? receipt : preview()));
    const pending = mode === "restore" ? gateway.restore(mutable) : gateway.start(mutable,"deepSeekNonThinking");
    mutable.requestId = pageId;
    if (mutable.input) mutable.input.model.modelId = "caller changed";
    finish(mode === "restore" ? preview() : admission());
    expect(await pending).toEqual(mode === "restore" ? preview() : admission());
  }
});

it("rejects malformed or expanded requests before native invocation", async () => {
  const base = request();
  for (const invalid of [{...base,tools:[]}, {...base,conversationId:""}, {...base,text:" "}, {...base,text:"\ud800"},
    {...base,text:"界".repeat(349526)}, {...base,context:{...base.context,expectedRevision:-1}},
    {...base,model:{providerId:"deepseek",modelId:"valid",credential:"do not send"}}, {...base,model:{providerId:"deepseek",modelId:"x".repeat(257)}},
    {...base,model:{providerId:"deepseek",modelId:"valid",reasoningEffort:"\ud800"}},
  ]) {
    const invoke = vi.fn();
    await expect(createAgentNoteSubmissionGateway(invoke).prepare(invalid)).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
    expect(invoke).not.toHaveBeenCalled();
  }
  const invoke = vi.fn();
  await expect(createAgentNoteSubmissionGateway(invoke).restore({...receipt,pageId:"00000000-0000-0000-0000-000000000000"})).rejects.toBeInstanceOf(AgentNoteSubmissionDecodeError);
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects unexpected note input sources and bad evidence without echoing source text", () => {
  const p = preview(); const source = p.input.context[0]!;
  for (const invalid of [ {...p,schemaVersion:2}, {...p,permission:"granted"}, {...p,turnId:"00000000-0000-0000-0000-000000000000"},
    {...p,input:{...p.input,context:[]}}, {...p,input:{...p.input,context:[source,source]}},
    {...p,input:{...p.input,images:[]}}, {...p,input:{...p.input,context:[{...source,kind:"paper"}]}},
    {...p,input:{...p.input,instructions:[{environmentId:"note",scopeId:"note",sourceId:"rule",revision:"1",originalBytes:1,text:"x",disposition:"included"}]}},
    {...p,input:{...p.input,context:[{...source,text:"private malformed JSON"}]}},
    {...p,input:{...p.input,context:[{...source,resourceId:conversationId}]}},
  ]) expect(() => decodeAgentNoteSubmissionPreview(invalid)).toThrow("Invalid or mismatched note submission");
});

it("keeps native errors and never silently retries a possibly started turn", async () => {
  const error = {code:"recoveryRequired"}; const invoke = vi.fn().mockRejectedValue(error);
  const gateway = createAgentNoteSubmissionGateway(invoke);
  await expect(gateway.prepare(request())).rejects.toBe(error);
  await expect(gateway.restore(receipt)).rejects.toBe(error);
  await expect(gateway.start(preview(),"deepSeekNonThinking")).rejects.toBe(error);
  expect(invoke).toHaveBeenCalledTimes(3);
});

function withProfile() {
  const value = preview();
  const scope = `note:${pageId}`, source = "agent/config.toml#profiles.note", revision = "a".repeat(64);
  return {...value,input:{...value.input,
    instructions:[{environmentId:scope,scopeId:scope,sourceId:source,revision,originalBytes:7,text:"界A",disposition:"truncated"}],
    instructionConfigs:[{environment_id:scope,layers:[{origin:{tier:"user",source_id:source,revision},instructions:{max_bytes:4,fallback_filenames:null}}]}],
  }};
}
it("preserves the native scoped profile, budget and frozen text",()=>{
  const value = withProfile();
  expect(decodeAgentNoteSubmissionPreview(value).input).toEqual(value.input);
});
it("rejects mismatched profile scope, config version and extra grants",()=>{
  const mutations = [
    (v:ReturnType<typeof withProfile>)=>{v.input.instructions[0]!.scopeId="another-note";},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructions[0]!.sourceId="AGENTS.md";},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.origin.revision="b".repeat(64);},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.instructions.max_bytes=3;},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs=[];},
    (v:ReturnType<typeof withProfile>)=>{v.input.instructionConfigs[0]!.layers[0]!.origin.tier="workspace";},
  ];
  for(const mutate of mutations){const value=withProfile();mutate(value);expect(()=>decodeAgentNoteSubmissionPreview(value)).toThrow();}
});
