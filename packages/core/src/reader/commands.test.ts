import { describe, expect, it } from "vitest";

import { isReaderCommandEnabled, readerCancellationCommand, readerCommandForKey } from "./commands";

const active = {
  platform: "macos" as const,
  activeLayer: "reader" as const,
  lifecycle: "active" as const,
  tool: "select" as const,
};

describe("reader semantic commands", () => {
  it("leaves application zoom shortcuts unclaimed in the reader and editable content", () => {
    for (const key of ["+", "=", "-", "0"]) for (const editable of [false, true]) {
      expect(readerCommandForKey({key, platform: "macos", metaKey: true, editable})).toBeUndefined();
      expect(readerCommandForKey({key, platform: "other", ctrlKey: true, editable})).toBeUndefined();
    }
  });
  it("maps Shift-modified PDF zoom including actual shifted key values and physical codes", () => {
    for (const platform of ["macos", "other"] as const) {
      const modifiers = platform === "macos" ? {metaKey: true} : {ctrlKey: true};
      for (const [key, code, command] of [
        ["+", "Equal", "reader.zoom.in"], ["_", "Minus", "reader.zoom.out"],
        [")", "Digit0", "reader.zoom.fitWidth"], ["+", "NumpadAdd", "reader.zoom.in"],
        ["-", "NumpadSubtract", "reader.zoom.out"], ["0", "Numpad0", "reader.zoom.fitWidth"],
      ] as const) {
        expect(readerCommandForKey({key, code, platform, ...modifiers, shiftKey: true})).toBe(command);
      }
      for (const [key, command] of [["=", "reader.zoom.in"], ["-", "reader.zoom.out"],
        ["0", "reader.zoom.fitWidth"]] as const) {
        expect(readerCommandForKey({key, platform, ...modifiers, shiftKey: true})).toBe(command);
      }
    }
  });
  it("keeps shifted PDF zoom out of editable content and unrelated modifier combinations", () => {
    for (const platform of ["macos", "other"] as const) {
      const modifiers = platform === "macos" ? {metaKey: true} : {ctrlKey: true};
      for (const options of [{editable: true}, {altKey: true}, {metaKey: true, ctrlKey: true}]) {
        expect(readerCommandForKey({key: "+", code: "Equal", platform, ...modifiers,
          shiftKey: true, ...options})).toBeUndefined();
      }
      expect(readerCommandForKey({key: "+", code: "Equal", platform, shiftKey: true})).toBeUndefined();
    }
  });
  it("maps platform keys while preserving editable input", () => {
    expect(readerCommandForKey({ key: "f", platform: "macos", metaKey: true, editable: true }))
      .toBe("reader.find.open");
    expect(readerCommandForKey({ key: "g", platform: "macos", metaKey: true, editable: true }))
      .toBeUndefined();
    expect(readerCommandForKey({ key: "[", platform: "macos", metaKey: true }))
      .toBe("reader.history.back");
    expect(readerCommandForKey({ key: "w", platform: "macos", metaKey: true, hasClosableReaderTab: true }))
      .toBe("reader.tab.close");
    expect(readerCommandForKey({ key: "w", platform: "macos", metaKey: true }))
      .toBe("reader.window.close");
    expect(readerCommandForKey({ key: "q", platform: "macos", metaKey: true }))
      .toBe("app.quit");
  });

  it("enforces lifecycle, read-only, history, and annotation availability", () => {
    expect(isReaderCommandEnabled("reader.find.open", active)).toBe(true);
    expect(isReaderCommandEnabled("reader.history.back", { ...active, canNavigateBack: false })).toBe(false);
    expect(isReaderCommandEnabled("reader.history.back", { ...active, canNavigateBack: true })).toBe(true);
    expect(isReaderCommandEnabled("annotation.createHighlight", { ...active, hasSelection: true })).toBe(true);
    expect(isReaderCommandEnabled("annotation.createHighlight", {
      ...active,
      hasSelection: true,
      readOnly: true,
    })).toBe(false);
    expect(isReaderCommandEnabled("reader.find.open", { ...active, lifecycle: "suspended" })).toBe(false);
    expect(isReaderCommandEnabled("app.quit", { ...active, lifecycle: "suspended" })).toBe(true);
    expect(isReaderCommandEnabled("app.quit", { ...active, lifecycle: "disposed" })).toBe(false);
    expect(isReaderCommandEnabled("annotation.undo", { ...active, canUndoAnnotation: true })).toBe(true);
    expect(isReaderCommandEnabled("annotation.redo", { ...active, canRedoAnnotation: true, readOnly: true })).toBe(false);
    expect(isReaderCommandEnabled("annotation.trash", active)).toBe(false);
    expect(isReaderCommandEnabled("annotation.trash", { ...active, selectedAnnotationCount: 1, readOnly: true })).toBe(false);
  });

  it("maps annotation history and deletion keys without consuming text edits", () => {
    expect(readerCommandForKey({ key: "z", platform: "macos", metaKey: true })).toBe("annotation.undo");
    expect(readerCommandForKey({ key: "Z", platform: "macos", metaKey: true, shiftKey: true })).toBe("annotation.redo");
    expect(readerCommandForKey({ key: "z", platform: "other", ctrlKey: true })).toBe("annotation.undo");
    expect(readerCommandForKey({ key: "z", platform: "other", ctrlKey: true, shiftKey: true })).toBe("annotation.redo");
    expect(readerCommandForKey({ key: "y", platform: "other", ctrlKey: true })).toBe("annotation.redo");
    for (const key of ["Delete", "Backspace"]) {
      expect(readerCommandForKey({ key, platform: "macos" })).toBe("annotation.trash");
      expect(readerCommandForKey({ key, platform: "other", editable: true })).toBeUndefined();
      expect(readerCommandForKey({ key, platform: "macos", altKey: true })).toBeUndefined();
    }
    expect(readerCommandForKey({ key: "z", platform: "macos", metaKey: true, editable: true })).toBeUndefined();
    expect(readerCommandForKey({ key: "y", platform: "other", ctrlKey: true, editable: true })).toBeUndefined();
    expect(readerCommandForKey({ key: "z", platform: "macos", metaKey: true, altKey: true })).toBeUndefined();
  });

  it("resolves Escape from the topmost interaction layer down to view focus", () => {
    expect(readerCancellationCommand({ ...active, popupOpen: true, findOpen: true, selectedAnnotationCount: 1 }))
      .toBe("reader.popup.cancel");
    expect(readerCancellationCommand({ ...active, findOpen: true, selectedAnnotationCount: 1 }))
      .toBe("reader.find.close");
    expect(readerCancellationCommand({ ...active, hasSelection: true }))
      .toBe("reader.selection.cancel");
    expect(readerCancellationCommand({ ...active, selectedAnnotationCount: 1 }))
      .toBe("reader.annotation.clearSelection");
    expect(readerCancellationCommand({ ...active, tool: "hand" }))
      .toBe("reader.tool.reset");
    expect(readerCancellationCommand({ ...active, editable: true })).toBeUndefined();
    expect(readerCancellationCommand(active)).toBe("reader.view.focus");
  });
});
