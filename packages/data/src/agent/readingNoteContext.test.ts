import { expect, it, vi } from "vitest";
import { decodeAgentReadingNoteContextPreview, decodeAgentNoteContextPreview } from "@research-assistant/core/agent";
import { createAgentReadingNoteContextGateway } from "./readingNoteContext";
const request = {readingNoteId: "a1111111-1111-4111-8111-111111111111", expectedRevision: 3};
function preview() {
  const origin = {anchorId: null, paperId: "paper", paperTitle: "Retained title", attachmentId: "attachment", contentSha256: "a".repeat(64), pageIndex: 2,
    pageLabel: null, rects: [], quoteExact: "Source quote", quotePrefix: "", quoteSuffix: "", selector: null, locatorVersion: 1};
  const anchor = {schemaVersion: 1, readingNoteId: request.readingNoteId, noteRevision: 3, sourceAnchorId: null, paperId: origin.paperId,
    attachmentId: origin.attachmentId, contentSha256: origin.contentSha256, pageIndex: 2, locatorVersion: 1};
  const content = {schemaVersion: 1, readingNoteId: request.readingNoteId, noteRevision: 3, noteType: "annotation", content: {body: "My interpretation", retained: true}, source: origin};
  return {schemaVersion: 1, source: {kind: "note", sourceId: `reading-note:${request.readingNoteId}`, resourceId: request.readingNoteId,
    revision: `revision:3:sha256:${"b".repeat(64)}`, text: JSON.stringify(content), anchor: JSON.stringify(anchor)}};
}
it("freezes request identity across IPC and preserves exact native source bytes", async () => {
  let resolve!: (value: unknown) => void;
  const invoke = vi.fn(() => new Promise(done => {resolve = done;})), mutable = {...request};
  const pending = createAgentReadingNoteContextGateway(invoke).preview(mutable); mutable.expectedRevision = 9;
  expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_preview_reading_note_context", {request});
  resolve(preview()); expect(await pending).toEqual(preview());
});
it("does not treat retained reading evidence as a rewritable Note Page", () => {
  expect(() => decodeAgentReadingNoteContextPreview(preview(), request)).not.toThrow();
  expect(() => decodeAgentNoteContextPreview(preview(), {pageId: request.readingNoteId, expectedRevision: 3})).toThrow();
});
it("refuses changed identities, revisions, mismatched anchors and invalid source metadata", () => {
  for (const patch of [{sourceId: "note:other"}, {resourceId: "other"}, {revision: `revision:4:sha256:${"b".repeat(64)}`}, {anchor: null}]) {
    expect(() => decodeAgentReadingNoteContextPreview({...preview(), source: {...preview().source, ...patch}}, request)).toThrow();
  }
  for (const patch of [{pageIndex: -1}, {paperId: "different"}, {locatorVersion: 2}, {contentSha256: "invalid"}]) {
    const value = preview(), body = JSON.parse(value.source.text); Object.assign(body.source, patch); value.source.text = JSON.stringify(body);
    expect(() => decodeAgentReadingNoteContextPreview(value, request)).toThrow();
  }
});
it("rejects invalid requests before IPC and surfaces read errors without retry or disclosure", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("unavailable")), gateway = createAgentReadingNoteContextGateway(invoke);
  for (const expectedRevision of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) await expect(gateway.preview({...request, expectedRevision})).rejects.toThrow();
  await expect(gateway.preview({...request, allowDisclosure: true} as typeof request)).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled();
  await expect(gateway.preview(request)).rejects.toThrow("unavailable"); expect(invoke).toHaveBeenCalledOnce();
});
