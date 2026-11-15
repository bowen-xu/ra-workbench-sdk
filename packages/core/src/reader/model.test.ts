import { describe, expect, it } from "vitest";

import {
  DEFAULT_READER_UI_SESSION_STATE,
  decodeReaderUiSessionState,
  decodeReaderViewStateV2,
  decodeSourceSelectorV2,
  normalizeReaderLocation,
  normalizeReaderSourcePosition,
  upgradeLegacyReaderViewState,
} from "./model";

describe("reader model contracts", () => {
  it("normalizes a complete reader location without losing explicit zero offsets", () => {
    expect(normalizeReaderLocation({
      pageIndex: 4,
      scale: { kind: "numeric", value: 1.5 },
      top: 0,
      left: 0,
      behavior: "instant",
      ifNeeded: true,
      visibilityMargin: 12,
      history: "hard",
    })).toEqual({
      pageIndex: 4,
      scale: { kind: "numeric", value: 1.5 },
      top: 0,
      left: 0,
      behavior: "instant",
      ifNeeded: true,
      visibilityMargin: 12,
      history: "hard",
    });
    expect(normalizeReaderLocation({ pageIndex: -1 })).toBeUndefined();
    expect(normalizeReaderLocation({ scale: { kind: "page-fit" } })).toBeUndefined();
  });

  it("accepts one page or two adjacent source segments and rejects wider selections", () => {
    const segment = (pageIndex: number) => ({
      pageIndex,
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      exactText: `page ${pageIndex}`,
    });
    expect(normalizeReaderSourcePosition({ segments: [segment(1)] })?.segments).toHaveLength(1);
    expect(normalizeReaderSourcePosition({ segments: [segment(1), segment(2)] })?.segments).toHaveLength(2);
    expect(normalizeReaderSourcePosition({ segments: [segment(1), segment(3)] })).toBeUndefined();
    expect(normalizeReaderSourcePosition({ segments: [segment(1), segment(2), segment(3)] })).toBeUndefined();
  });

  it("decodes SourceSelectorV2 without changing the V1-compatible segment facts", () => {
    const selector = {
      schemaVersion: 2,
      anchorId: "anchor-1",
      attachmentSha256: "a".repeat(64),
      segments: [
        { pageIndex: 3, rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }], exactText: "first" },
        { pageIndex: 4, rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.04 }], exactText: "second" },
      ],
    };
    expect(decodeSourceSelectorV2(selector)).toEqual(selector);
    expect(decodeSourceSelectorV2({ ...selector, schemaVersion: 1 })).toBeUndefined();
  });

  it("decodes only finite version-two view states", () => {
    const state = {
      schemaVersion: 2,
      pageIndex: 8,
      scale: { kind: "page-width" },
      top: 220.5,
      left: 12,
      scrollMode: "vertical",
      spreadMode: "none",
    };
    expect(decodeReaderViewStateV2(state)).toEqual(state);
    expect(decodeReaderViewStateV2({ ...state, schemaVersion: 1 })).toBeUndefined();
    expect(decodeReaderViewStateV2({ ...state, top: Number.NaN })).toBeUndefined();
    expect(decodeReaderViewStateV2({ ...state, scale: { kind: "numeric", value: 0 } })).toBeUndefined();
    expect(decodeReaderViewStateV2({ ...state, scale: { kind: "numeric", value: 197.75 } })).toBeUndefined();
  });

  it("upgrades legacy attachment positions without inventing exact offsets", () => {
    expect(upgradeLegacyReaderViewState({ pageIndex: 3, zoom: 1.25 })).toEqual({
      schemaVersion: 2,
      pageIndex: 3,
      scale: { kind: "numeric", value: 1.25 },
      scrollMode: "vertical",
      spreadMode: "none",
    });
    expect(upgradeLegacyReaderViewState({ pageIndex: -1, zoom: 0 }).scale).toEqual({ kind: "page-fit" });
    expect(upgradeLegacyReaderViewState({ pageIndex: 0, zoom: 197.75 }).scale).toEqual({
      kind: "numeric",
      value: 1.9775,
    });
    expect(upgradeLegacyReaderViewState({ pageIndex: 0, zoom: 2500 }).scale).toEqual({
      kind: "numeric",
      value: 3,
    });
  });

  it("decodes bounded reader UI session preferences without treating responsive hiding as a preference", () => {
    expect(decodeReaderUiSessionState(DEFAULT_READER_UI_SESSION_STATE)).toEqual(DEFAULT_READER_UI_SESSION_STATE);
    expect(decodeReaderUiSessionState({
      ...DEFAULT_READER_UI_SESSION_STATE,
      navigationSidebar: { open: true, width: 80, view: "thumbnails" },
    })).toBeUndefined();
    expect(decodeReaderUiSessionState({
      ...DEFAULT_READER_UI_SESSION_STATE,
      notesSidebar: { open: false, width: 700 },
    })).toBeUndefined();
  });

  it("defaults missing structured overlay preferences to closed for older saved sessions", () => {
    const legacySession = {
      schemaVersion: DEFAULT_READER_UI_SESSION_STATE.schemaVersion,
      navigationSidebar: { open: true, width: 190, view: "thumbnails" },
      notesSidebar: { open: true, width: 300 },
    };

    expect(decodeReaderUiSessionState(legacySession)).toEqual(DEFAULT_READER_UI_SESSION_STATE);
    expect(decodeReaderUiSessionState({
      ...legacySession,
      structuredOverlay: { open: true },
    })?.structuredOverlay).toEqual({ open: true });
  });
});
