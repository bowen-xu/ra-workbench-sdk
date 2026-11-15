import {expect, it, vi} from "vitest";
import {agentQueueEditIntentFromRequest, type AgentQueueState} from "@research-assistant/core/agent";
import {createAgentInputQueueGateway} from "./inputQueue";
import {createAgentPaperQueueGateway} from "./paperQueue";
import {createAgentNoteQueueGateway} from "./noteQueue";
import {createAgentContextQueueGateway} from "./contextQueue";
import type {AgentMetadataInvoke} from "./index";
import type {AgentQueueEditInspection} from "./queueEditInspection";

const c = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", r = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const m = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", i = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const epoch = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const request = {conversationId: c, requestId: r, expectedRevision: 0, edit: {type: "add" as const, inputId: i, text: " Original e\u0301\r\n "}};
type QueueUnderTest = AgentQueueEditInspection<unknown> & {edit(request: unknown): Promise<AgentQueueState>};
const hosts: readonly {name: string; request: Record<string, unknown>; create(invoke: AgentMetadataInvoke): QueueUnderTest}[] = [
  {name: "writing", request: {...request, manuscriptId: m}, create: createAgentInputQueueGateway},
  {name: "paper", request: {...request, paperId: " opaque paper α "}, create: createAgentPaperQueueGateway},
  {name: "note", request: {...request, scope: {kind: "note", resourceId: m}}, create: createAgentNoteQueueGateway},
  {name: "readingNote", request: {...request, scope: {kind: "readingNote", resourceId: m}}, create: createAgentNoteQueueGateway},
  {name: "context", request, create: createAgentContextQueueGateway},
];
const command = (name: string) => `agent_read_${name === "readingNote" ? "note" : name}_input_queue_edit_status`;
function result(input: unknown) {
  const intent = agentQueueEditIntentFromRequest(input);
  return {schemaVersion: 1, intent, status: {type: "committed", queue: {
    schemaVersion: 1, conversationId: c, revision: 1, paused: false, preparingInputId: null, inputs: [{inputId: i, text: "text" in intent.edit ? intent.edit.text : request.edit.text}],
  }, proof: {schemaVersion: 1, operationId: r, conversationId: c, family: "agent.input_queue.edit", epoch,
    sqlFence: "18446744073709551615", replayed: true, result: null}}};
}

it.each(hosts)("$name inspects only the original edit and returns the historical generic Q", async host => {
  const value = result(host.request), invoke = vi.fn(async (_command: string, _args: Record<string, unknown>) => value), gateway = host.create(invoke);
  expect(await gateway.inspectEdit(host.request)).toEqual(value);
  expect(invoke).toHaveBeenCalledExactlyOnceWith(command(host.name), {request: host.request});
  expect(host.request).not.toHaveProperty("scope.kind", "context");
  expect(host.request.edit).not.toHaveProperty("userInput");
  expect(value.intent.edit).toMatchObject({userInput: []});
  expect(invoke.mock.calls.every(call => !String(call[0]).includes("agent_edit_"))).toBe(true);
});

it.each(hosts.filter(host=>["writing","note","readingNote"].includes(host.name)))("$name carries the epoch through edit and exact status lookup", async host=>{
  const original={...host.request,expectedEpoch:epoch}, value=result(original);
  const response=host.name==="writing"?{...value.status.queue,manuscriptId:m}:{...value.status.queue,scope:host.request.scope};
  const invoke=vi.fn(async (name:string,_args:Record<string,unknown>)=>name.startsWith("agent_edit_")?response:value),gateway=host.create(invoke);
  await gateway.edit(original);expect(await gateway.inspectEdit(original)).toEqual(value);
  expect(invoke.mock.calls.map(([name])=>name)).toEqual([`agent_edit_${host.name==="readingNote"?"note":host.name}_input_queue`,command(host.name)]);
  expect(invoke.mock.calls.every(([,args])=>(args as {request:{expectedEpoch:string}}).request.expectedEpoch===epoch)).toBe(true);
  await expect(host.create(async()=>({...value,status:{...value.status,proof:{...value.status.proof,epoch:foreign}}})).inspectEdit(original)).rejects.toThrow();
});

it.each(hosts)("$name freezes the full request before awaiting status I/O", async host => {
  const input = structuredClone(host.request), expected = structuredClone(input), value = result(expected);
  let release!: (value: unknown) => void;
  const invoke = vi.fn((_command: string, _args: Record<string, unknown>) => new Promise(resolve => {release = resolve;}));
  const pending = host.create(invoke).inspectEdit(input);
  (input.edit as {text: string}).text = "Later draft must not alter the original command";
  input.expectedRevision = 9;
  expect(invoke).toHaveBeenCalledExactlyOnceWith(command(host.name), {request: expected});
  release(value);
  expect(await pending).toEqual(value);
  expect(invoke).toHaveBeenCalledOnce();
});

it.each(hosts)("$name gives transport an owned copy without allowing it to rewrite the comparison intent", async host => {
  const input = structuredClone(host.request), expected = structuredClone(input), value = result(expected);
  const invoke = vi.fn(async (_command: string, args: Record<string, unknown>) => {
    const wire = args.request as Record<string, unknown>;
    wire.conversationId = foreign;
    (wire.edit as {text: string}).text = "Transport cannot mutate the caller's draft or frozen comparison";
    return value;
  });
  expect(await host.create(invoke).inspectEdit(input)).toEqual(value);
  expect(input).toEqual(expected);
  expect(invoke).toHaveBeenCalledOnce();
});

it.each(hosts)("$name never turns current state, missing proof or I/O failure into an ACK", async host => {
  const value = result(host.request), cause = Object.freeze({code: "DATA_SQL_RECOVERY_REQUIRED", operationId: r});
  const invoke = vi.fn(async () => {throw cause;});
  await expect(host.create(invoke).inspectEdit(host.request)).rejects.toBe(cause);
  expect(invoke).toHaveBeenCalledOnce();
  for (const invalid of [value.status.queue, {...value, status: {type: "committed", queue: value.status.queue}},
    {...value, intent: {...value.intent, conversationId: foreign}},
    {...value, status: {...value.status, proof: {...value.status.proof, operationId: foreign}}},
    {...value, status: {...value.status, queue: {...value.status.queue, revision: 2}}}]) {
    const invoke = vi.fn(async () => invalid);
    await expect(host.create(invoke).inspectEdit(host.request)).rejects.toThrow();
    expect(invoke).toHaveBeenCalledOnce();
  }
});

it.each(hosts)("$name preserves deleted/notFound/unconfirmed without making another request", async host => {
  const value = result(host.request), detail = {operationId: r, epoch: null, sqlFence: null, phase: "read-queue-edit-status",
    sqliteCode: null, sqliteExtendedCode: null, safeCause: "queue_edit_result_deleted"};
  for (const status of [{type: "deleted", proof: value.status.proof, detail}, {type: "notFound"}, {type: "unconfirmed", detail}]) {
    const invoke = vi.fn(async () => ({...value, status}));
    expect((await host.create(invoke).inspectEdit(host.request)).status).toEqual(status);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command(host.name), {request: host.request});
  }
});

it.each(hosts)("$name rejects a different edit, scope or host before trusting its proof", async host => {
  const value = result(host.request);
  for (const intent of [{...value.intent, edit: {...request.edit, text: "different"}},
    {...value.intent, expectedRevision: 2}, {...value.intent, scope: {kind: "paper", paperId: "foreign"}}])
    await expect(host.create(async () => ({...value, intent})).inspectEdit(host.request)).rejects.toThrow();
  const invoke = vi.fn(async () => value);
  await expect(host.create(invoke).inspectEdit({...host.request, unexpected: true})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it.each(hosts)("$name preserves source URI bytes in both edit and inspection", async host => {
  const text = "file", sourceUrl = `source://writings/${m}/./%61.tex`;
  const input = {...host.request, edit: {...request.edit, text, userInput: [
    {type: "text", text, textElements: []},
    {type: "mention", name: "original", target: {kind: "file", sourceId: "frozen", resourceId: m, sourceUrl}},
  ]}};
  const value = result(input);
  const invoke = vi.fn(async (cmd: string, _args: Record<string, unknown>) => cmd.includes("_edit_status") ? value : {
    ...value.status.queue,
    ...(host.name === "writing" ? {manuscriptId: m} : host.name === "paper" ? {paperId: host.request.paperId}
      : ["note", "readingNote"].includes(host.name) ? {scope: host.request.scope} : {}),
  });
  const gateway = host.create(invoke);
  await gateway.edit(input);
  await gateway.inspectEdit(input);
  expect(invoke.mock.calls).toHaveLength(2);
  for (const call of invoke.mock.calls) expect(JSON.stringify(call)).toContain(sourceUrl);
  expect(input.edit.userInput[1]!.target!.sourceUrl).toBe(sourceUrl);
});

it("context factory keeps its original read/edit command and current-identity validation", async () => {
  const queue = result(request).status.queue, invoke = vi.fn(async () => queue), gateway = createAgentContextQueueGateway(invoke);
  expect(await gateway.read({conversationId: c})).toEqual(queue);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_read_context_input_queue", {request: {conversationId: c}});
  expect(await gateway.edit({...request, edit: {type: "resume"}})).toEqual(queue);
  expect(invoke).toHaveBeenLastCalledWith("agent_edit_context_input_queue", {request: {...request, edit: {type: "resume"}}});
  await expect(createAgentContextQueueGateway(async () => ({...queue, conversationId: foreign})).read({conversationId: c})).rejects.toThrow();
  await expect(createAgentContextQueueGateway(async () => ({...queue, revision: 0})).edit({...request, edit: {type: "resume"}})).rejects.toThrow();
});

it("preserves the context queue data epoch for editing and receipt inspection", async () => {
  const original = {...request, expectedEpoch: epoch}, value = result(original);
  const invoke = vi.fn(async (name: string) => name === "agent_edit_context_input_queue" ? value.status.queue : value);
  const gateway = createAgentContextQueueGateway(invoke);
  await gateway.edit(original);
  expect(invoke).toHaveBeenLastCalledWith("agent_edit_context_input_queue", {request: original});
  expect(await gateway.inspectEdit(original)).toEqual(value);
  expect(invoke).toHaveBeenLastCalledWith("agent_read_context_input_queue_edit_status", {request: original});
  await expect(gateway.edit({...original, expectedEpoch: "invalid"})).rejects.toThrow();
});
