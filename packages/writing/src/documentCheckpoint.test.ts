import { expect, it } from "vitest";
import fixture from "../fixtures/document-checkpoint-v1.json";
import receiptFixture from "../fixtures/document-checkpoint-editor-receipt-v1.json";
import { advanceWritingCheckpoint, decodeWritingDocumentCheckpoint, decodeWritingCheckpointRecord } from "./documentCheckpoint";

it("preserves the Rust IPC fixture, D/B, provenance and an older in-flight write intent", () => {
  expect(decodeWritingDocumentCheckpoint(fixture)).toEqual(fixture);
  expect(decodeWritingCheckpointRecord({ revision: 1, checkpoint: fixture })).toEqual({ revision: 1, checkpoint: fixture });
});

it("persists baseline-only confirmation and rejects stale or conflicting same-version bodies", () => {
  const pending = decodeWritingDocumentCheckpoint(fixture);
  const first = advanceWritingCheckpoint(undefined, { expectedRevision: null, checkpoint: pending });
  const keep = { ...pending, version: 4, reviewBaseline: pending.content };
  const kept = advanceWritingCheckpoint(first, { expectedRevision: first.revision, checkpoint: keep });
  expect(kept.checkpoint.content).toBe(first.checkpoint.content);
  expect(advanceWritingCheckpoint(kept, { expectedRevision: 1, checkpoint: keep })).toEqual(kept);
  expect(() => advanceWritingCheckpoint(kept, { expectedRevision: 1, checkpoint: pending })).toThrow("已变化");
  expect(() => advanceWritingCheckpoint(kept, { expectedRevision: 2, checkpoint: { ...keep, content: "stale" } })).toThrow("已变化");
  const ack = { ...keep, savedVersion: 2, savedSha256: "b".repeat(64), saveIntent: null };
  expect(advanceWritingCheckpoint(kept, { expectedRevision: 2, checkpoint: ack }).checkpoint).toEqual(ack);
});

it.each([
  { schemaVersion: 2 }, { version: -1 }, { version: Number.MAX_SAFE_INTEGER + 1 },
  { conversationProjection: true },
  { relativePath: "../main.tex" }, { relativePath: "a//main.tex" }, { content: "\ud800" },
  { relativePath: "中".repeat(342) }, { relativePath: ".agent-before-backup.bak" }, { manuscriptId: "\ud800" },
  { savedSha256: "z".repeat(64) }, { savedVersion: 4 }, { saveIntent: undefined },
  { operations: [fixture.operations[0], fixture.operations[0]] },
  { saveIntent: { ...fixture.saveIntent, version: 4 } },
])("rejects corrupt checkpoint fields: %j", (fields) => {
  expect(() => decodeWritingDocumentCheckpoint({ ...fixture, ...fields })).toThrow();
});

it("retains delivery acknowledgements when text history is undone or a save is acknowledged", () => {
  const checkpoint = decodeWritingDocumentCheckpoint(fixture);
  const stored = advanceWritingCheckpoint(undefined, { expectedRevision: null, checkpoint });
  expect(() => advanceWritingCheckpoint(stored, { expectedRevision: 1, checkpoint: { ...checkpoint, version: 4, operations: [] } })).toThrow("已变化");
  const undo = { ...checkpoint, version: 4, content: checkpoint.reviewBaseline };
  expect(advanceWritingCheckpoint(stored, { expectedRevision: 1, checkpoint: undo }).checkpoint.operations).toEqual(checkpoint.operations);
});

it("checks UTF-8 byte size for both text fields and positive storage revisions", () => {
  expect(() => decodeWritingDocumentCheckpoint({ ...fixture, reviewBaseline: "中".repeat(3 * 1024 * 1024) })).toThrow();
  expect(() => decodeWritingCheckpointRecord({ revision: 0, checkpoint: fixture })).toThrow();
});

it("preserves an immutable original editor receipt when D/B change, replacing it only for a new operation", () => {
  const checkpoint = decodeWritingDocumentCheckpoint(receiptFixture);
  expect(checkpoint).toEqual(receiptFixture);
  const stored = advanceWritingCheckpoint(undefined, { expectedRevision: null, checkpoint });
  const kept = { ...checkpoint, version: 4, content: "later input", reviewBaseline: "later input" };
  const saved = advanceWritingCheckpoint(stored, { expectedRevision: 1, checkpoint: kept });
  expect(saved.checkpoint.editorReceipt).toEqual(receiptFixture.editorReceipt);
  for (const editorReceipt of [undefined, { ...receiptFixture.editorReceipt, revision: "other-version" },
    { ...receiptFixture.editorReceipt, text: "later input" }]) {
    const { editorReceipt: _old, ...withoutReceipt } = kept;
    expect(() => advanceWritingCheckpoint(saved, { expectedRevision: 2, checkpoint: {
      ...withoutReceipt, ...(editorReceipt ? { editorReceipt } : {}),
    } })).toThrow("已变化");
  }
  const later = { ...kept, version: 5, operations: [...kept.operations, { ...kept.operations[0]!, operationId: "operation-b" }],
    editorReceipt: { ...receiptFixture.editorReceipt, operationId: "operation-b", revision: "next-version" } };
  expect(advanceWritingCheckpoint(saved, { expectedRevision: 2, checkpoint: later }).checkpoint).toEqual(later);
});

it.each([
  null, { ...receiptFixture.editorReceipt, operationId: "missing" },
  { ...receiptFixture.editorReceipt, sessionId: "" }, { ...receiptFixture.editorReceipt, revision: "" },
  { ...receiptFixture.editorReceipt, conversationId: "untrusted" },
  { ...receiptFixture.editorReceipt, text: "中".repeat(3 * 1024 * 1024) },
])("rejects an invalid persisted editor observation", (editorReceipt) => {
  expect(() => decodeWritingDocumentCheckpoint({ ...receiptFixture, editorReceipt })).toThrow();
});
it("bounds optional dispatch versions while preserving legacy receipts", () => {
  const value = { ...receiptFixture, editorReceipt: { ...receiptFixture.editorReceipt, stateVersion: receiptFixture.version } };
  expect(decodeWritingDocumentCheckpoint(value)).toEqual(value);
  expect(decodeWritingDocumentCheckpoint(receiptFixture)).toEqual(receiptFixture);
  for (const stateVersion of [null, -1, 0.5, receiptFixture.version + 1, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => decodeWritingDocumentCheckpoint({ ...value, editorReceipt: { ...value.editorReceipt, stateVersion } })).toThrow();
  }
});
