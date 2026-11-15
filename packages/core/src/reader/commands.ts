import type { ReaderLifecycleState } from "./lifecycle";

export type ReaderCommand =
  | "reader.find.open"
  | "reader.find.next"
  | "reader.find.previous"
  | "reader.find.close"
  | "reader.page.focusInput"
  | "reader.page.previous"
  | "reader.page.next"
  | "reader.navigate"
  | "reader.zoom.in"
  | "reader.zoom.out"
  | "reader.zoom.fitWidth"
  | "reader.zoom.fitPage"
  | "reader.history.back"
  | "reader.history.forward"
  | "reader.sidebar.toggleNavigation"
  | "reader.sidebar.toggleNotes"
  | "reader.sidebar.showThumbnails"
  | "reader.sidebar.showOutline"
  | "reader.selection.cancel"
  | "reader.popup.cancel"
  | "reader.cancel"
  | "reader.annotation.clearSelection"
  | "reader.tool.reset"
  | "reader.view.focus"
  | "annotation.createHighlight"
  | "annotation.update"
  | "annotation.select"
  | "annotation.trash"
  | "annotation.restore"
  | "annotation.createPageNote"
  | "annotation.undo"
  | "annotation.redo"
  | "reader.tab.close"
  | "reader.window.close"
  | "app.quit";

export type ReaderFocusOwner = "toolbar" | "view" | "navigation-sidebar" | "notes-sidebar" | "popup";
export type ReaderActiveLayer = "reader" | "find" | "annotation-editor" | "popup";
export type ReaderTool = "select" | "hand" | "highlight";

export interface ReaderCommandContext {
  readonly platform: "macos" | "other";
  readonly activeLayer: ReaderActiveLayer;
  readonly lifecycle: ReaderLifecycleState;
  readonly focusOwner?: ReaderFocusOwner;
  readonly editable?: boolean;
  readonly popupOpen?: boolean;
  readonly findOpen?: boolean;
  readonly hasSelection?: boolean;
  readonly selectedAnnotationCount?: number;
  readonly readOnly?: boolean;
  readonly canNavigateBack?: boolean;
  readonly canNavigateForward?: boolean;
  readonly canUndoAnnotation?: boolean;
  readonly canRedoAnnotation?: boolean;
  readonly hasClosableReaderTab?: boolean;
  readonly tool: ReaderTool;
}

export interface ReaderKeyInput {
  readonly key: string;
  readonly code?: string;
  readonly platform: "macos" | "other";
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly editable?: boolean;
  readonly hasClosableReaderTab?: boolean;
}

const ACTIVE_ONLY_COMMANDS = new Set<ReaderCommand>([
  "reader.find.open",
  "reader.find.next",
  "reader.find.previous",
  "reader.find.close",
  "reader.page.focusInput",
  "reader.page.previous",
  "reader.page.next",
  "reader.navigate",
  "reader.zoom.in",
  "reader.zoom.out",
  "reader.zoom.fitWidth",
  "reader.zoom.fitPage",
  "reader.sidebar.toggleNavigation",
  "reader.sidebar.toggleNotes",
  "reader.sidebar.showThumbnails",
  "reader.sidebar.showOutline",
  "reader.selection.cancel",
  "reader.popup.cancel",
  "reader.cancel",
  "reader.annotation.clearSelection",
  "reader.tool.reset",
  "reader.view.focus",
  "annotation.select",
]);

export function isReaderCommandEnabled(command: ReaderCommand, context: ReaderCommandContext): boolean {
  if (context.lifecycle === "disposed") return false;
  if (command === "app.quit" || command === "reader.window.close") return true;
  if (command === "reader.tab.close") return context.hasClosableReaderTab === true;
  if (context.lifecycle !== "active") return false;
  if (ACTIVE_ONLY_COMMANDS.has(command)) return true;
  if (command === "reader.history.back") return context.canNavigateBack === true;
  if (command === "reader.history.forward") return context.canNavigateForward === true;
  if (command === "annotation.undo") return context.readOnly !== true && context.canUndoAnnotation === true;
  if (command === "annotation.redo") return context.readOnly !== true && context.canRedoAnnotation === true;
  if (command === "annotation.createHighlight") {
    return context.readOnly !== true && context.hasSelection === true;
  }
  if (command === "annotation.createPageNote") return context.readOnly !== true;
  if (command === "annotation.update" || command === "annotation.trash" || command === "annotation.restore") {
    return context.readOnly !== true && (context.selectedAnnotationCount ?? 0) > 0;
  }
  return false;
}

export function readerCancellationCommand(context: ReaderCommandContext): ReaderCommand | undefined {
  if (context.popupOpen === true) return "reader.popup.cancel";
  if (context.findOpen === true) return "reader.find.close";
  if (context.hasSelection === true && context.editable !== true) return "reader.selection.cancel";
  if ((context.selectedAnnotationCount ?? 0) > 0) return "reader.annotation.clearSelection";
  if (context.tool !== "select") return "reader.tool.reset";
  if (context.editable === true) return undefined;
  return "reader.view.focus";
}

export function readerCommandForKey(input: ReaderKeyInput): ReaderCommand | undefined {
  if (input.key === "Escape") return "reader.cancel";
  const modifier = input.platform === "macos" ? input.metaKey === true : input.ctrlKey === true;
  if (!modifier) {
    if (input.editable !== true && input.metaKey !== true && input.ctrlKey !== true && input.altKey !== true && input.shiftKey !== true
      && (input.key === "Delete" || input.key === "Backspace")) return "annotation.trash";
    return undefined;
  }
  const key = input.key.toLocaleLowerCase();

  if (input.platform === "macos" && key === "q") return "app.quit";
  if (input.platform === "macos" && key === "w") {
    return input.hasClosableReaderTab === true ? "reader.tab.close" : "reader.window.close";
  }
  if (key === "f" && input.altKey !== true) return "reader.find.open";
  if (input.editable === true) return undefined;
  if (input.altKey !== true && key === "z") return input.shiftKey === true ? "annotation.redo" : "annotation.undo";
  if (input.platform !== "macos" && input.altKey !== true && input.shiftKey !== true && key === "y") return "annotation.redo";
  if (key === "g" && input.altKey === true) return "reader.page.focusInput";
  if (key === "g") return input.shiftKey === true ? "reader.find.previous" : "reader.find.next";
  // Mod +/-/0 belong to the application; Shift targets only the active PDF.
  // Physical codes also cover Shift+Minus => "_" and Shift+0 => ")".
  if (input.shiftKey === true && input.altKey !== true
    && (input.platform === "macos" ? input.ctrlKey !== true : input.metaKey !== true)) {
    if (input.code === "Equal" || input.code === "NumpadAdd" || key === "+" || key === "=") return "reader.zoom.in";
    if (input.code === "Minus" || input.code === "NumpadSubtract" || key === "-" || key === "_") return "reader.zoom.out";
    if (input.code === "Digit0" || input.code === "Numpad0" || key === "0" || key === ")") return "reader.zoom.fitWidth";
  }
  if (key === "[") return "reader.history.back";
  if (key === "]") return "reader.history.forward";
  return undefined;
}
