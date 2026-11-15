import type {ComponentProps, ComponentPropsWithoutRef, ForwardRefExoticComponent, JSX, ReactNode, RefAttributes, RefObject} from "react";
import type {ActionMenu, ActionMenuItem} from "./overlay.js";

/** DOM identity only. The host retains its block tree and move commands. */
export interface BlockDragDom {
  readonly outerSelector: string;
  readonly contentSelector: string;
  readonly owns: (root: HTMLElement, hit: Element) => boolean;
  readonly contentId: (root: HTMLElement, content: HTMLElement, includeFixed?: boolean) => string | undefined;
  readonly idOf: (outer: HTMLElement) => string | undefined;
  readonly fixed: (content: HTMLElement) => boolean;
  readonly attached: (content: HTMLElement) => boolean;
  readonly middlePlacement?: (content: HTMLElement) => "before" | "after" | "inside";
  readonly scope: (root: HTMLElement) => {readonly instance: string; readonly selector: string} | undefined;
  readonly rowSelector: (id: string) => string;
}

export interface BlockDropTarget {
  readonly blockId: string;
  readonly placement: "before" | "after" | "inside";
  readonly line: {readonly left: number; readonly top: number; readonly width: number};
  readonly targetRect?: {readonly left: number; readonly top: number; readonly width: number; readonly height: number};
}

export interface BlockDragCallbacks {
  readonly blockCount?: number;
  readonly sourceIds?: readonly string[];
  readonly canDrop: (target: BlockDropTarget) => boolean;
  readonly move: (target: BlockDropTarget) => void;
  readonly onActivate: () => void;
  readonly onFinish: (result: {readonly click: boolean}) => void;
}

/** These use the existing Core overlay, gutter and gesture owners. */
export declare function BlockControlsProvider(props: {
  readonly root: RefObject<HTMLElement | null>;
  readonly dom: BlockDragDom;
  readonly children: ReactNode;
}): JSX.Element;
export declare function FloatingBlockControls(props: {
  readonly blockId: string;
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element;
export declare function NoteActionMenu(props: ComponentProps<typeof ActionMenu>): JSX.Element;
export declare function NoteActionMenuItem(props: ComponentProps<typeof ActionMenuItem>): JSX.Element;
export declare const BlockAddButton: ForwardRefExoticComponent<ComponentPropsWithoutRef<"button"> & RefAttributes<HTMLButtonElement>>;
export declare const BlockDragButton: ForwardRefExoticComponent<ComponentPropsWithoutRef<"button"> & RefAttributes<HTMLButtonElement>>;
export declare function useBlockControlsRoot(): RefObject<HTMLElement | null>;

/** The returned disposer ends the original gesture; it does not own a document. */
export declare function startBlockPointerDrag(
  source: HTMLElement,
  editor: HTMLElement,
  initial: PointerEvent,
  callbacks: BlockDragCallbacks,
  dom?: BlockDragDom,
): () => void;
export declare function getEditorScrollContainer(editor: HTMLElement): HTMLElement | null;
export declare function useBlockDragAutoScroll(): {
  readonly start: (container: HTMLElement) => void;
  readonly stop: () => void;
};
