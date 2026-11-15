import type {ChangeSet, EditorState, Extension, StateField, TransactionSpec} from "@codemirror/state";
import type {DecorationSet, EditorView} from "@codemirror/view";
import type {JSX, ReactNode} from "react";
import type {EditorDiffHighlightAppearance} from "./hbs.js";

export type {EditorDiffHighlightAppearance} from "./hbs.js";

/** Presentation and transaction planning use the host's original editor history. */
export declare function EditorDiffControls(props: {
  readonly count: number;
  readonly active: number;
  readonly disabled?: boolean;
  readonly showBulk?: boolean;
  readonly onMove: (direction: "previous" | "next") => void;
  readonly onResolve: (action: "keep" | "undo", scope: "current" | "all") => void;
}): JSX.Element | null;
export declare function EditorDiffHighlight(props: {
  readonly appearance?: EditorDiffHighlightAppearance | undefined;
  readonly children: ReactNode;
}): JSX.Element;
export declare function chunkActionDecorations(
  resolve: (view: EditorView, position: number, action: "keep" | "undo") => void,
  disabled?: boolean,
  incoming?: readonly {readonly from: number; readonly to: number}[],
  labels?: {readonly undo?: string; readonly keep?: string},
): StateField<DecorationSet>;
export declare function textChanges(before: string, after: string): ChangeSet;
export declare function resolveTextChunk(view: EditorView, position: number, action: "keep" | "undo"): boolean;
export declare function resolveTextDiff(view: EditorView, action: "keep" | "undo"): boolean;
export declare function textDiffResolution(state: EditorState, action: "keep" | "undo"): TransactionSpec | null;
export declare const textReviewBaseline: Extension[];
