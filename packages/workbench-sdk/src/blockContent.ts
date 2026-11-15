import type {
  BlockConfig, BlockNoteEditorOptions, BlockSchema, CustomBlockNoteSchema,
  DefaultBlockSchema, DefaultInlineContentSchema, DefaultStyleSchema,
  Extension, ExtensionFactoryInstance, InlineContentSchema, StyleSchema,
} from "@blocknote/core";
import type {zh} from "@blocknote/core/locales";
import type {DefaultReactSuggestionItem} from "@blocknote/react";
import type {EditorView} from "@tiptap/pm/view";
import type {PortableEditorBlock} from "@research-assistant/core/notes";
import type {SourceLineRange} from "@research-assistant/core/source";
import type {JSX, MouseEventHandler, ReactNode} from "react";

type BaseBlockSchema = DefaultBlockSchema & {
  heading: {
    type: "heading";
    content: "inline";
    propSchema: DefaultBlockSchema["heading"]["propSchema"] & {
      isToggleable: {readonly default: false; readonly optional: true};
    };
  };
  formulaBlock: BlockConfig<"formulaBlock", {readonly source: {readonly default: ""}}, "none">;
  table: {
    type: "table";
    content: "table";
    propSchema: DefaultBlockSchema["table"]["propSchema"] & {
      caption: {default: string};
      textAlignment: {default: "left"; values: readonly ["left", "center", "right"]};
    };
  };
  blockCaption: BlockConfig<"blockCaption", {readonly ownerId: {readonly default: ""}}, "inline">;
};
type BaseInlineContentSchema = DefaultInlineContentSchema & {
  inlineFormula: {
    readonly type: "inlineFormula";
    readonly propSchema: {readonly source: {readonly default: ""}};
    readonly content: "none";
  };
};
type BaseStyleSchema = DefaultStyleSchema & {textColor: {readonly type: "textColor"; readonly propSchema: "string"}};

/** The existing Core schema, using the pinned BlockNote class and native types. */
export declare const baseBlockEditorSchema: CustomBlockNoteSchema<BaseBlockSchema, BaseInlineContentSchema, BaseStyleSchema>;

type NativePasteContext = Parameters<NonNullable<BlockNoteEditorOptions<BlockSchema, InlineContentSchema, StyleSchema>["pasteHandler"]>>[0];
type PasteContext = Pick<NativePasteContext, "defaultPasteHandler" | "event"> & {
  readonly editor: Pick<NativePasteContext["editor"], "pasteHTML"> & {
    readonly getTextCursorPosition?: () => {readonly block: {readonly type: string}};
  };
};
export declare const blockEditorDefaults: {
  tables: {headers: boolean};
  links: {onClick: () => boolean; HTMLAttributes: {draggable: string}};
  dictionary: typeof zh;
  dropCursor: {color: string; width: number};
  pasteHandler: (context: PasteContext) => boolean | undefined;
};

export declare function withCaptionBlocks(blocks: readonly PortableEditorBlock[]): PortableEditorBlock[];
export declare function withoutCaptionBlocks(blocks: readonly PortableEditorBlock[]): PortableEditorBlock[];

export interface AssetInsertion {
  readonly blockId: string;
  readonly placement: "before" | "after" | "replaceEmpty";
}
interface AssetEditor {
  readonly domElement: HTMLElement | undefined;
  readonly prosemirrorView: EditorView;
  readonly isEditable: boolean;
  getTextCursorPosition(): {readonly block: {readonly id: string}};
  getBlock(id: string): {readonly id: string} | undefined;
  onMount(callback: () => void): () => void;
}
export declare function ManagedAssetIngress(props: {
  readonly editor: AssetEditor;
  readonly onFiles: (files: readonly File[], insertion: AssetInsertion) => void;
}): null;

interface BlockTreeNode {
  readonly id: string;
  readonly type?: string;
  readonly children: readonly BlockTreeNode[];
}
interface BlockEditorInstance<Block extends BlockTreeNode> {
  readonly document: readonly Block[];
  readonly domElement: HTMLElement | undefined;
  readonly prosemirrorView: EditorView;
  isEditable: boolean;
  getBlock(id: string): Block | undefined;
  removeBlocks(ids: string[]): unknown;
  insertBlocks(blocks: NoInfer<Block>[], anchor: string, placement: "before" | "after"): unknown;
  updateBlock(id: string, update: {children: NoInfer<Block>[]}): unknown;
  transact(callback: () => void): unknown;
  setTextCursorPosition(id: string, placement: "start"): void;
  focus(): void;
  onChange(callback: () => void): () => void;
  onSelectionChange(callback: () => void): () => void;
  registerExtension(extension: Extension | ExtensionFactoryInstance): void;
  unregisterExtension(extension: string): void;
}
interface NoteEditingSource {
  readonly schema: {
    readonly blockSchema: {readonly formulaBlock: unknown};
    readonly inlineContentSchema: {readonly inlineFormula: unknown};
  };
}
export interface BlockSourceNavigation {
  readonly blockId: string;
  readonly token: number;
  readonly range?: SourceLineRange;
  readonly onLocated?: (location: {readonly getAnchorRect: () => DOMRect | null}) => void;
  readonly onError?: (reason: unknown) => void;
}
export declare function NoteEditorSurface<Block extends BlockTreeNode>(props: {
  readonly editor: BlockEditorInstance<Block> & NoteEditingSource;
  readonly onChange: () => void;
  readonly onCompositionChange?: (composing: boolean) => void;
  readonly readOnly?: boolean;
  readonly movePolicy?: {
    readonly maxDepth?: number;
    readonly canContain?: (block: BlockTreeNode) => boolean;
    readonly canNest?: (block: BlockTreeNode) => boolean;
  };
  readonly defaultFormattingToolbar?: boolean;
  readonly defaultLinkToolbar?: boolean;
  readonly children?: ReactNode;
  readonly beforeEditor?: ReactNode;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly onClickCapture?: MouseEventHandler<HTMLDivElement>;
  readonly onAuxClickCapture?: MouseEventHandler<HTMLDivElement>;
  readonly additionalSlashItems?: readonly DefaultReactSuggestionItem[];
  readonly blockSourcePath?: readonly string[];
  readonly sourceNavigation?: BlockSourceNavigation | undefined;
  readonly onOpenSourceLink?: (href: string) => void;
}): JSX.Element;

export type ImageAlignment = "left" | "center" | "right";
export interface MediaBlockEditor {
  readonly prosemirrorView: EditorView;
  readonly isEditable: boolean;
}
export interface ImageResizeSource {
  readonly blockId: string;
  readonly editor: {readonly domElement: HTMLElement | undefined; readonly isEditable: boolean};
  readonly onScaleChange: (scale: number) => void;
}
export declare function ImageBlockPresentation(props: {
  readonly src?: string | undefined;
  readonly alt: string;
  readonly caption: string;
  readonly alignment?: ImageAlignment;
  readonly error?: string | undefined;
  readonly onError?: (() => void) | undefined;
  readonly onAlignmentChange?: ((alignment: ImageAlignment) => void) | undefined;
  readonly className?: string;
  readonly assetId?: string;
  readonly previewWidth?: number | undefined;
  readonly previewScale?: number | undefined;
  readonly resize?: ImageResizeSource | undefined;
  readonly captionSource?: {readonly blockId: string; readonly editor: MediaBlockEditor} | undefined;
}): JSX.Element;
