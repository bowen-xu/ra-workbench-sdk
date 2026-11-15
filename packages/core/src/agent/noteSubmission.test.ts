import { expect, it } from "vitest";
import { decodeAgentNoteSubmissionPreview } from "./noteSubmission";

it("decodes prepared and restored note evidence with frozen application skills", () => {
  const pageId = "a1111111-1111-4111-8111-111111111111";
  const skill = { descriptor: {
    identity: { environment_id: "application", source_id: ".agents/skills/review/SKILL.md", revision: "a".repeat(64) },
    name: "review", description: "Review prose", allow_implicit_invocation: false,
  }, explicit: true };
  const response = {
    schemaVersion: 1, pageId, conversationId: pageId, requestId: pageId, turnId: pageId, contextSnapshotId: pageId,
    input: { text: "$review", model: { providerId: "fixture", modelId: "fixture", revision: null },
      reasoningEffort: null, skills: [skill], context: [{
        sourceId: `note:${"a".repeat(64)}`, kind: "note", resourceId: pageId,
        revision: `revision:3:sha256:${"a".repeat(64)}`,
        anchor: JSON.stringify({ schemaVersion: 1, pageId, pageRevision: 3, blockId: null }),
        text: JSON.stringify({ schemaVersion: 1, pageId, title: "Frozen note", pageRevision: 3, blocks: [] }),
      }],
    },
  };
  expect(decodeAgentNoteSubmissionPreview(response).input.skills).toEqual([skill]);
  expect(decodeAgentNoteSubmissionPreview(JSON.parse(JSON.stringify(response))).input.skills).toEqual([skill]);
  skill.descriptor.identity.environment_id = "manuscript:other";
  expect(() => decodeAgentNoteSubmissionPreview(response)).toThrow();
});

it("accepts one global retrieval source alongside the frozen note", () => {
  const pageId = "a1111111-1111-4111-8111-111111111111";
  const note = { sourceId: `note:${"a".repeat(64)}`, kind: "note", resourceId: pageId,
    revision: `revision:3:sha256:${"a".repeat(64)}`, anchor: JSON.stringify({schemaVersion: 1, pageId, pageRevision: 3, blockId: null}),
    text: JSON.stringify({schemaVersion: 1, pageId, title: "Frozen note", pageRevision: 3, blocks: []}) };
  const response = { schemaVersion: 1, pageId, conversationId: pageId, requestId: pageId, turnId: pageId, contextSnapshotId: pageId,
    input: { text: "Explain", model: {providerId: "fixture", modelId: "fixture", revision: null}, reasoningEffort: null, context: [note, {
      sourceId: "retrieval:t1", kind: "retrieval", resourceId: pageId, revision: "trace:t1", anchor: JSON.stringify({pageId, traceId: "t1", query: "autonomy"}), text: "retrieved" }] } };
  expect(decodeAgentNoteSubmissionPreview(response).input.context).toHaveLength(2);
});
