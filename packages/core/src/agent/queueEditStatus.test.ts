import {expect, it} from "vitest";
import {agentQueueEditIntentFromRequest, decodeAgentQueueEditIntent, type AgentQueueEditScope} from "./queueEditIntent";
import {AGENT_INPUT_QUEUE_EDIT_FAMILY, decodeAgentQueueEditStatusResponse} from "./queueEditStatus";
import {decodeAgentQueueState,decodeAgentWritingQueueEditRequest} from "./submission";
import {decodeAgentNoteQueueEditRequest} from "./noteQueue";

// Local contract fixtures; the real Native serde golden is supplied separately.
const c = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const m = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", i = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const epoch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", other = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const text = "  原文 e\u0301\r\n  ", paperId = " 文献 α ";
const base = {conversationId: c, requestId: r, expectedRevision: 0, edit: {type: "add", inputId: i, text}};
const hosts: readonly [Record<string, unknown>, AgentQueueEditScope][] = [
  [{...base, manuscriptId: m}, {kind: "manuscript", manuscriptId: m}],
  [{...base, paperId}, {kind: "paper", paperId}],
  [{...base, scope: {kind: "note", resourceId: m}}, {kind: "note", resourceId: m}],
  [{...base, scope: {kind: "readingNote", resourceId: m}}, {kind: "readingNote", resourceId: m}],
  [base, {kind: "context"}],
];
const proof = () => ({schemaVersion: 1, operationId: r, conversationId: c, family: AGENT_INPUT_QUEUE_EDIT_FAMILY,
  epoch, sqlFence: "18446744073709551615", replayed: true, result: null});
const detail = () => ({operationId: r, epoch: null, sqlFence: null, phase: "read-queue-edit-status",
  sqliteCode: null, sqliteExtendedCode: null, safeCause: "queue_edit_result_deleted"});
function response(request: unknown = base) {
  return {schemaVersion: 1, intent: agentQueueEditIntentFromRequest(request), status: {type: "committed", proof: proof(), queue: {
    schemaVersion: 1, conversationId: c, revision: 1, paused: false, preparingInputId: null, inputs: [{inputId: i, text}],
  }}};
}

it.each(hosts)("matches the full host, defaults and historical receipt %#", (request, scope) => {
  const value = response(request);
  expect(decodeAgentQueueEditStatusResponse(value, request)).toEqual(value);
  expect(value.intent.scope).toEqual(scope);
  expect(value.intent.edit).toMatchObject({userInput: [], text});
});

it("binds guarded paper edits and their receipt to the original data epoch", () => {
  const request = {...base, paperId, expectedEpoch: epoch}, value = response(request);
  expect(decodeAgentQueueEditStatusResponse(value, request)).toEqual(value);
  expect(value.intent.expectedEpoch).toBe(epoch);
  expect(() => decodeAgentQueueEditStatusResponse({...value, status: {...value.status, proof: {...value.status.proof, epoch: other}}}, request)).toThrow();
  expect(() => decodeAgentQueueEditStatusResponse(value, {...request, expectedEpoch: other})).toThrow();
  expect(() => agentQueueEditIntentFromRequest({...request, expectedEpoch: "00000000-0000-0000-0000-000000000000"})).toThrow();
});

it("binds a guarded writing edit and receipt to the original data epoch",()=>{
  const request={...base,manuscriptId:m,expectedEpoch:epoch},value=response(request);
  expect(decodeAgentWritingQueueEditRequest(request)).toEqual(request);
  expect(decodeAgentQueueEditStatusResponse(value,request)).toEqual(value);
  expect(()=>decodeAgentQueueEditStatusResponse({...value,status:{...value.status,proof:{...value.status.proof,epoch:other}}},request)).toThrow();
  expect(()=>decodeAgentWritingQueueEditRequest({...request,expectedEpoch:"00000000-0000-0000-0000-000000000000"})).toThrow();
});

it.each(["note","readingNote"] as const)("binds a guarded %s edit and receipt to the original epoch", kind => {
  const request={...base,scope:{kind,resourceId:m},expectedEpoch:epoch};
  expect(decodeAgentNoteQueueEditRequest(request)).toEqual(request);
  const value=response(request);
  expect(decodeAgentQueueEditStatusResponse(value,request)).toEqual(value);
  expect(()=>decodeAgentQueueEditStatusResponse({...value,status:{...value.status,proof:{...value.status.proof,epoch:other}}},request)).toThrow();
  expect(()=>decodeAgentNoteQueueEditRequest({...request,expectedEpoch:"00000000-0000-0000-0000-000000000000"})).toThrow();
  expect(()=>decodeAgentQueueEditStatusResponse(value,{...request,expectedEpoch:other})).toThrow();
});

it.each(["0", "18446744073709551615"])("preserves a U64 fence without numeric coercion (%s)", sqlFence => {
  const value = response(); value.status.proof.sqlFence = sqlFence;
  expect(decodeAgentQueueEditStatusResponse(value, base).status).toMatchObject({proof: {sqlFence}});
  const max = {...base, expectedRevision: Number.MAX_SAFE_INTEGER - 1};
  const boundary = response(max); boundary.status.queue.revision = Number.MAX_SAFE_INTEGER;
  expect(decodeAgentQueueEditStatusResponse(boundary, max).intent.expectedRevision).toBe(max.expectedRevision);
});

it.each([
  {conversationId: other}, {requestId: other}, {expectedRevision: 1},
  {scope: {kind: "paper", paperId}}, {scope: {kind: "manuscript", manuscriptId: other}},
  {edit: {...base.edit, text: text.normalize("NFC")}},
  {edit: {...base.edit, text: text.trim()}},
  {edit: {...base.edit, inputId: other}},
])("rejects a foreign full echo even when R and its proof otherwise match %#", patch => {
  const request = hosts[0]![0], value = response(request);
  expect(() => decodeAgentQueueEditStatusResponse({...value, intent: {...value.intent, ...patch}}, request)).toThrow();
});

it.each([
  {operationId: other}, {conversationId: other}, {family: "agent.queue.preview.cancel"},
  {epoch: "invalid"}, {sqlFence: 1}, {sqlFence: "01"}, {sqlFence: "18446744073709551616"},
  {replayed: "true"}, {result: {}}, {schemaVersion: 2},
])("rejects mismatched or invalid SQL proof %#", patch => {
  const value = response();
  expect(() => decodeAgentQueueEditStatusResponse({...value, status: {...value.status, proof: {...proof(), ...patch}}}, base)).toThrow();
});

it.each([{conversationId: other}, {revision: 0}, {revision: 2}])("rejects current/foreign Q in a committed result %#", patch => {
  const value = response();
  expect(() => decodeAgentQueueEditStatusResponse({...value, status: {...value.status, queue: {...value.status.queue, ...patch}}}, base)).toThrow();
});

it("keeps deleted proof separate from a queue and does not upgrade uncertain states", () => {
  const value = response();
  const deleted = {...value, status: {type: "deleted", proof: proof(), detail: detail()}};
  expect(decodeAgentQueueEditStatusResponse(deleted, base)).toEqual(deleted);
  expect(() => decodeAgentQueueEditStatusResponse({...deleted, status: {...deleted.status, queue: value.status.queue}}, base)).toThrow();
  for (const status of [{type: "notFound"}, {type: "unconfirmed", detail: detail()}]) {
    expect(decodeAgentQueueEditStatusResponse({...value, status}, base).status).toEqual(status);
    expect(() => decodeAgentQueueEditStatusResponse({...value, status: {...status, proof: proof()}}, base)).toThrow();
    expect(() => decodeAgentQueueEditStatusResponse({...value, status: {...status, queue: value.status.queue}}, base)).toThrow();
  }
});

it.each([
  {operationId: other}, {operationId: "invalid"}, {epoch: "invalid"}, {sqlFence: "01"},
  {phase: "private provider body"}, {safeCause: "SELECT private body"}, {sqliteCode: "Bearer private-token"},
  {sqliteExtendedCode: -1}, {extra: "private request"},
])("does not copy invalid or unsafe seven-field diagnostics %#", patch => {
  const value = response();
  expect(() => decodeAgentQueueEditStatusResponse({...value, status: {type: "unconfirmed", detail: {...detail(), ...patch}}}, base)).toThrow();
});

it("requires all diagnostic fields, including explicit null options", () => {
  const value = response();
  for (const key of Object.keys(detail())) {
    const incomplete: Record<string, unknown> = {...detail()}; delete incomplete[key];
    expect(() => decodeAgentQueueEditStatusResponse({...value, status: {type: "deleted", proof: proof(), detail: incomplete}}, base)).toThrow();
  }
});

it("normalizes serde user input defaults and aliases but retains source URL bytes", () => {
  const url = `source://writings/${m}/./%61.tex`;
  const input = [{type: "text", text}, {type: "mention", name: "file", target: {kind: "file", sourceId: "frozen-source", resourceId: m, sourceUrl: url, revision: "legacy"}},
    {type: "selection", source: `source://writings/${m}/a.tex`, title: "Evidence", text: "selected"}];
  const request = {...base, edit: {...base.edit, userInput: input}};
  const value = response(request);
  expect(value.intent.edit).toMatchObject({userInput: [{type: "text", text, textElements: []},
    {type: "mention", target: {sourceUrl: url}}, {type: "annotation", comment: ""}]});
  expect(decodeAgentQueueEditStatusResponse(value, request)).toEqual(value);
  expect(JSON.stringify(value.intent)).not.toContain("legacy");
  const altered = JSON.parse(JSON.stringify(value)) as typeof value, edit = altered.intent.edit;
  if (!('userInput' in edit) || !edit.userInput) throw new Error("fixture");
  altered.intent = agentQueueEditIntentFromRequest({...request, edit: {...request.edit, userInput: [input[0],
    {...input[1], target: {...input[1]!.target, sourceUrl: `source://writings/${m}/a.tex`}}, input[2]]}});
  expect(() => decodeAgentQueueEditStatusResponse(altered, request)).toThrow();
  for (const userInput of [null, [{type: "text", text, textElements: null}], [input[0], {...input[2], comment: null}]])
    expect(() => agentQueueEditIntentFromRequest({...base, edit: {...base.edit, userInput}})).toThrow();
});

it.each([
  {...base, manuscriptId: m, paperId}, {...base, scope: {kind: "context"}}, {...base, kind: "note", resourceId: m},
  {...base, edit: {...base.edit, origin: {kind: "manuscript", resourceId: m}}},
  {...base, edit: {...base.edit, paused: false}},
])("rejects ambiguous hosts and derived edit fields %#", request => {
  expect(() => agentQueueEditIntentFromRequest(request)).toThrow();
});

it("decodes unified context scope only at the wire echo boundary", () => {
  const intent = agentQueueEditIntentFromRequest(base);
  expect(decodeAgentQueueEditIntent(intent)).toEqual(intent);
  expect(() => agentQueueEditIntentFromRequest(intent)).toThrow();
  const foreign = response(hosts[2]![0]);
  expect(() => decodeAgentQueueEditStatusResponse(foreign, hosts[3]![0])).toThrow();
});

it("preserves the opaque paper DTO read contract while keeping other origin IDs constrained", () => {
  // Decoder compatibility does not claim fresh Native Add accepts a non-UUID origin.
  const queue = response({...base, paperId}).status.queue;
  const paper = {...queue, inputs: [{inputId: i, text, origin: {kind: "paper", resourceId: paperId}}]};
  expect(decodeAgentQueueState(paper)).toEqual(paper);
  expect(decodeAgentQueueEditStatusResponse({...response({...base, paperId}), status: {...response().status, queue: paper}}, {...base, paperId}).status).toMatchObject({queue: paper});
  for (const kind of ["manuscript", "note", "readingNote"])
    expect(() => decodeAgentQueueState({...paper, inputs: [{inputId: i, text, origin: {kind, resourceId: paperId}}]})).toThrow();
});

it.each([
  [{type: "add", inputId: i, text}, {type: "add", inputId: other, text}],
  [{type: "update", inputId: i, text}, {type: "update", inputId: i, text: "changed"}],
  [{type: "restore", inputId: i, sourceInputId: m, index: 1, text}, {type: "restore", inputId: i, sourceInputId: other, index: 1, text}],
  [{type: "restore", inputId: i, sourceInputId: m, index: 1, text}, {type: "restore", inputId: i, sourceInputId: m, index: 2, text}],
  [{type: "remove", inputId: i}, {type: "remove", inputId: other}],
  [{type: "pauseInput", inputId: i}, {type: "resumeInput", inputId: i}],
  [{type: "resumeInput", inputId: i}, {type: "resumeInput", inputId: other}],
  [{type: "reorder", inputIds: [i, m]}, {type: "reorder", inputIds: [m, i]}],
  [{type: "pause"}, {type: "resume"}], [{type: "resume"}, {type: "pause"}],
])("matches every original edit variant without lowering provenance or placement %#", (edit, foreign) => {
  const request = {...base, edit}, value = response(request);
  expect(decodeAgentQueueEditStatusResponse(value, request)).toEqual(value);
  const intent = agentQueueEditIntentFromRequest({...request, edit: foreign});
  expect(() => decodeAgentQueueEditStatusResponse({...value, intent}, request)).toThrow();
});
