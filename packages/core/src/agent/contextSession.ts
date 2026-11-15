import { decodeAgentSubmissionInput, type AgentSubmissionInput, type AgentModelSelection } from "./submission";
import { decodeAgentContextSelection, type AgentContextResource, type AgentContextSelection } from "./contextSelection";
export interface AgentContextConversation {
    readonly conversationId: string;
    readonly title: string;
}
export interface AgentContextPrepareRequest {
    readonly conversationId: string;
    readonly requestId: string;
    readonly text: string;
    readonly resources: readonly AgentContextResource[];
    readonly userInput?: readonly import("./userInput").AgentUserInput[];
    readonly retrieval?: {readonly traceId:string;readonly query:string};
    readonly model?: AgentModelSelection;
    readonly queue?: AgentContextQueueConfirmation;
}
export interface AgentContextQueueConfirmation {
    readonly inputId: string;
    readonly expectedRevision: number;
}
export interface AgentContextReceipt {
    readonly conversationId: string;
    readonly requestId: string;
}
export interface AgentContextPreview extends AgentContextReceipt {
    readonly schemaVersion: 1;
    readonly turnId: string;
    readonly contextSnapshotId: string;
    readonly input: AgentSubmissionInput;
    readonly queue?: AgentContextQueueConfirmation;
}
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("上下文响应无效");
    return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
        throw new Error("上下文会话身份无效");
    return value.toLowerCase();
}
export function decodeAgentContextPreview(value: unknown): AgentContextPreview {
    const r = record(value);
    if (r.schemaVersion !== 1 || Object.keys(r).some(k => !["schemaVersion", "conversationId", "requestId", "turnId", "contextSnapshotId", "input", "queue"].includes(k)))
        throw new Error("上下文预览无效");
    return { schemaVersion: 1, conversationId: uuid(r.conversationId), requestId: uuid(r.requestId), turnId: uuid(r.turnId), contextSnapshotId: uuid(r.contextSnapshotId), input: decodeAgentSubmissionInput(r.input), ...(r.queue === undefined ? {} : {queue: decodeAgentContextQueueConfirmation(r.queue)}) };
}
export function decodeAgentContextQueueConfirmation(value: unknown): AgentContextQueueConfirmation {
    const row = record(value);
    if (Object.keys(row).length !== 2 || !Number.isSafeInteger(row.expectedRevision) || (row.expectedRevision as number) < 0)
        throw new Error("上下文队列身份无效");
    return {inputId: uuid(row.inputId), expectedRevision: row.expectedRevision as number};
}
export function decodeAgentContextConversations(value: unknown): readonly AgentContextConversation[] {
    if (!Array.isArray(value) || value.length > 500)
        throw new Error("对话列表无效");
    const result = value.map(v => { const r = record(v); if (typeof r.title !== "string" || r.title.length > 1024)
        throw new Error("对话标题无效"); return { conversationId: uuid(r.conversationId), title: r.title }; });
    if (new Set(result.map(r => r.conversationId)).size !== result.length)
        throw new Error("对话身份重复");
    return result;
}
export function decodeAgentContextResources(value: unknown): readonly AgentContextSelection[] {
    if (!Array.isArray(value) || value.length > 180)
        throw new Error("材料列表无效");
    return value.map(decodeAgentContextSelection);
}
