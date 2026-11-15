import {expect, it} from "vitest";
import {decodeAgentPaperStartStatusResponse, sameAgentPaperStartRequest} from "./paperStartStatus";
const id = (n: number) => `abcdef00-1234-5678-abcd-${String(n).padStart(12,"0")}`;
const intent = {conversationId: id(1), requestId: id(2), paperId: "paper", paperContextSnapshotId: "snapshot", contextSnapshotId: id(3),
  model: {providerId: "deepseek", modelId: "fixture", revision: null}, mode: "chatGptDefault" as const};
const result = {schemaVersion: 1, conversationId: id(1), requestId: id(2), turnId: id(4), alreadyStarted: true, outcome: null};
const detail = {operationId: id(2), epoch: id(5), sqlFence: "10", phase: "paper-start-status", sqliteCode: null, sqliteExtendedCode: null, safeCause: "paper_start_worker_unconfirmed"};
it("decodes the read-only started or unconfirmed fact and preserves the full request", () => {
  expect(decodeAgentPaperStartStatusResponse({schemaVersion: 1, intent, status: {type: "started", result}})).toMatchObject({intent, status: {type: "started", result}});
  expect(decodeAgentPaperStartStatusResponse({schemaVersion: 1, intent, status: {type: "unconfirmed", detail}})).toMatchObject({status: {type: "unconfirmed", detail}});
  expect(sameAgentPaperStartRequest(intent, {...intent, conversationId: `{${id(1).toUpperCase()}}`})).toBe(true);
  for (const patch of [{paperId: "other"}, {paperContextSnapshotId: "other"}, {contextSnapshotId: id(9)}, {mode: "deepSeekNonThinking" as const}, {model: {...intent.model, revision: "other"}}])
    expect(sameAgentPaperStartRequest(intent, {...intent, ...patch})).toBe(false);
});
it("refuses absence claims and results or diagnostics from another operation", () => {
  for (const status of [{type: "notFound"}, {type: "prepared"}, {type: "started", result: {...result, requestId: id(9)}},
    {type: "started", result: {...result, alreadyStarted: false}}, {type: "unconfirmed", detail: {...detail, operationId: id(9)}}])
    expect(() => decodeAgentPaperStartStatusResponse({schemaVersion: 1, intent, status})).toThrow();
});
