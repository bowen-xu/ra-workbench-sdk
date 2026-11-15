import type {ComponentPropsWithoutRef, ComponentType, ForwardRefExoticComponent, HTMLAttributes, JSX, PointerEvent, Ref, RefAttributes, RefObject} from "react";

export type ReorderAxis = "horizontal" | "vertical";
export type ReorderPlacement = "before" | "after" | "inside";
export interface ReorderDrop { readonly source: string; readonly target: string; readonly placement: ReorderPlacement }
export interface ReorderChange {
  readonly source: string;
  readonly target: string;
  readonly after: boolean;
  readonly order: readonly string[];
}
export interface ReorderTreeItem { readonly parentId?: string; readonly depth: number; readonly canNest: boolean }
export interface PointerReorderOptions {
  readonly presentation?: "displacement" | "indicator";
  readonly treeItem?: (id: string) => ReorderTreeItem;
  readonly canDrop?: (drop: ReorderDrop) => boolean;
  readonly onDrop?: (drop: ReorderDrop) => void | Promise<void>;
  readonly ids: readonly string[];
  readonly axis?: ReorderAxis;
  readonly disabled?: boolean;
  readonly scrollContainer?: RefObject<HTMLElement | null>;
  readonly onReorder?: (change: ReorderChange) => void | boolean | Promise<void | boolean>;
}
export interface ReorderPreview {
  readonly id: string;
  readonly target: string;
  readonly placement?: ReorderPlacement | undefined;
  readonly offsets: ReadonlyMap<string, number>;
}
export interface PointerReorder {
  readonly rows: RefObject<Map<string, HTMLElement>>;
  readonly drag: ReorderPreview | undefined;
  readonly order: readonly string[];
  readonly pending: boolean;
  offsetFor(id: string): number;
  start(id: string, event: PointerEvent<HTMLElement>): void;
  consumeClick(): boolean;
}
export interface ReorderGroupProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "ol";
  readonly motion?: "default" | "none";
  readonly axis?: ReorderAxis;
  readonly order: readonly string[];
  readonly dragging?: boolean;
  readonly containerRef?: RefObject<HTMLElement | null>;
}
export interface ReorderItemProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "li";
  readonly ref?: Ref<HTMLElement>;
  readonly itemId: string;
  readonly axis?: ReorderAxis;
  readonly dragging?: boolean;
  readonly offset?: number;
  readonly fixed?: boolean;
}

/** Core retains the real gesture owner and motion implementation. */
export declare function usePointerReorder(options: PointerReorderOptions): PointerReorder;
/** Class internals are deliberately absent from the component contract. */
export declare const ReorderGroup: ComponentType<ReorderGroupProps>;
export declare function ReorderItem(props: ReorderItemProps): JSX.Element;
export type ReorderableListRowProps = Omit<ReorderItemProps, "as"> & {readonly dropTarget?: boolean};
export type ReorderDragHandleProps = ComponentPropsWithoutRef<"button"> & {readonly compact?: boolean};
export declare function ReorderableListRow(props: ReorderableListRowProps): JSX.Element;
export declare const ReorderDragHandle: ForwardRefExoticComponent<ReorderDragHandleProps & RefAttributes<HTMLButtonElement>>;
