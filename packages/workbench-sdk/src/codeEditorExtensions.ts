import type {autocompletion} from "@codemirror/autocomplete";
import type {Extension, StateField} from "@codemirror/state";
import type {EditorView, Panel} from "@codemirror/view";

/** Extensions attach to the original host-owned CodeMirror instance. */
export declare const editorSearchScope: StateField<readonly {readonly from: number; readonly to: number}[] | null>;
export declare function createEditorSearchPanel(view: EditorView): Panel;
export declare function latexLanguage(): Extension;
export declare function virtualCompletion(config: NonNullable<Parameters<typeof autocompletion>[0]>): Extension;
