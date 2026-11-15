import { expect, it, vi } from "vitest";
import { AgentNoteContextDecodeError, decodeAgentNoteContextPreview, decodeAgentNoteContextRequest } from "@research-assistant/core/agent";
import { createAgentNoteContextGateway } from "./noteContext";

const pageId = "a1111111-1111-4111-8111-111111111111";
const otherId = "b1111111-1111-4111-8111-111111111111";
const request = { pageId, expectedRevision: 2, blockId: "root" };
const block = (id: string) => ({ id, type: "paragraph", props: {},
  content: { kind: "inline", items: [{type:"text",text:"Synthetic evidence",styles:[]}] }, children: [] });
function preview(selection: string | null = "root") {
  return { schemaVersion: 1, source: {
    sourceId: `note:${"a".repeat(64)}`, kind: "note", resourceId: pageId,
    revision: `revision:2:sha256:${"b".repeat(64)}`,
    anchor: JSON.stringify({schemaVersion:1,pageId,pageRevision:2,blockId:selection}),
    text: JSON.stringify({schemaVersion:1,pageId,title:"Synthetic",pageRevision:2,blocks:[block("root")]}),
  } };
}

it("uses the native local-preview command and retains exact structured evidence", async () => {
  const result = preview(); const invoke = vi.fn().mockResolvedValue(result);
  expect(await createAgentNoteContextGateway(invoke).preview(request)).toEqual(result);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_preview_note_context", {request});
  const whole = preview(null);
  expect(decodeAgentNoteContextPreview(whole, {pageId:pageId.toUpperCase(),expectedRevision:2})).toEqual(whole);
  expect(decodeAgentNoteContextRequest({...request,blockId:undefined}).blockId).toBeNull();
});

it("freezes selection before IPC and isolates mutation of the transport argument", async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn((_command, args) => {
    (args.request as {pageId:string}).pageId = otherId;
    return new Promise(done => { finish = done; });
  });
  const mutable = {...request};
  const pending = createAgentNoteContextGateway(invoke).preview(mutable);
  mutable.pageId = otherId; mutable.blockId = "different"; mutable.expectedRevision = 7;
  finish(preview());
  expect(await pending).toEqual(preview());
});

it("rejects invalid or broader requests before reading native data", async () => {
  for (const invalid of [
    {...request,allowAllNotes:true}, {...request,pageId:""}, {...request,pageId:"00000000-0000-0000-0000-000000000000"},
    {...request,expectedRevision:-1}, {...request,expectedRevision:2.5}, {...request,expectedRevision:Number.MAX_SAFE_INTEGER+1},
    {...request,blockId:""}, {...request,blockId:"\0"}, {...request,blockId:"\ud800"}, {...request,blockId:"界".repeat(43)},
  ]) {
    const invoke = vi.fn();
    await expect(createAgentNoteContextGateway(invoke).preview(invalid)).rejects.toBeInstanceOf(AgentNoteContextDecodeError);
    expect(invoke).not.toHaveBeenCalled();
  }
  expect(decodeAgentNoteContextRequest({...request,blockId:"😀".repeat(32)}).blockId).toBe("😀".repeat(32));
});

it("rejects stale or mismatched identities at each nested boundary", () => {
  for (const patch of [ {kind:"paper"}, {resourceId:otherId}, {sourceId:"note:unversioned"},
    {revision:`revision:3:sha256:${"b".repeat(64)}`}, {anchor:null},
    {anchor:JSON.stringify({schemaVersion:1,pageId:otherId,pageRevision:2,blockId:"root"})},
    {anchor:JSON.stringify({schemaVersion:1,pageId,pageRevision:2,blockId:null})},
    {text:JSON.stringify({schemaVersion:1,pageId:otherId,title:"Synthetic",pageRevision:2,blocks:[block("root")]})},
    {text:JSON.stringify({schemaVersion:1,pageId,title:"Synthetic",pageRevision:3,blocks:[block("root")]})},
    {text:JSON.stringify({schemaVersion:1,pageId,title:"Synthetic",pageRevision:2,blocks:[block("other")]})},
    {text:JSON.stringify({schemaVersion:1,pageId,title:"Synthetic",pageRevision:2,blocks:[block("root"),block("sibling")]})},
  ]) {
    const result = preview();
    expect(() => decodeAgentNoteContextPreview({...result,source:{...result.source,...patch}},request)).toThrow(AgentNoteContextDecodeError);
  }
});

it("rejects unfamiliar envelopes, malformed structures and oversized text without leaking content", () => {
  const result = preview();
  for (const invalid of [ null, {...result,schemaVersion:2}, {...result,permission:"granted"},
    {...result,source:{...result.source,extra:true}}, {...result,source:{...result.source,text:"private broken JSON"}},
    {...result,source:{...result.source,text:"界".repeat(2_796_203)}},
    {...result,source:{...result.source,text:JSON.stringify({schemaVersion:1,pageId,title:"Synthetic",pageRevision:2,blocks:[block("root"),block("root")]})}},
  ]) {
    expect(() => decodeAgentNoteContextPreview(invalid,request)).toThrow("Invalid or mismatched note context preview");
  }
});

it("propagates native failure without converting it to an empty preview or retrying", async () => {
  const invoke = vi.fn().mockRejectedValue("conflict");
  await expect(createAgentNoteContextGateway(invoke).preview(request)).rejects.toBe("conflict");
  expect(invoke).toHaveBeenCalledOnce();
});
