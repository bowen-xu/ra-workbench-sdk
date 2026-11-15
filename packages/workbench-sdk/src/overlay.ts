import type {DialogProps, MenuProps, MenuProviderProps, PopoverProps} from "@ariakit/react";
import type {ComponentProps, JSX, ReactElement, ReactNode, Ref, RefObject} from "react";

export type OverlayKind = "surface" | "popup" | "hint";
export interface OverlayPortalProps {
  readonly children: ReactNode;
  readonly kind?: OverlayKind;
}

export interface ActionMenuProps {
  readonly label: string;
  readonly menuLabel?: string;
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  readonly className: string;
  readonly triggerClassName?: string;
  readonly contentClassName?: string;
  readonly disabled?: boolean;
  readonly hint?: boolean;
  readonly showTitle?: boolean;
  readonly triggerRef?: Ref<HTMLButtonElement>;
  readonly triggerRender?: ReactElement;
  readonly portalElement?: MenuProps["portalElement"];
  readonly open?: boolean;
  readonly setOpen?: (open: boolean) => void;
  readonly autoFocusOnHide?: NonNullable<MenuProps["autoFocusOnHide"]>;
  readonly hideOnEscape?: NonNullable<MenuProps["hideOnEscape"]>;
  readonly placement?: MenuProviderProps["placement"];
  readonly portal?: boolean;
  readonly keepMounted?: boolean;
}
export interface ControlHintProps {
  readonly children: ReactElement;
  readonly content: ReactNode;
  readonly shortcut?: ReactNode;
  readonly wrap?: boolean;
  readonly preferSidePlacement?: boolean;
  readonly tooltipClassName?: string;
}

/** These are Core overlay adapters, not access to a second portal/layer system. */
export declare function ActionMenu(props: ActionMenuProps): JSX.Element;
export declare function ActionMenuItem(props: ComponentProps<"button"> & {readonly hideOnClick?: boolean}): JSX.Element;
export declare function ControlHint(props: ControlHintProps): JSX.Element;
export declare function OverlayPortal(props: OverlayPortalProps): JSX.Element;
export declare function Dialog(props: DialogProps): JSX.Element;
export declare function Popover(props: PopoverProps): JSX.Element;
/** The original Core mount target; the caller keeps its content owner. */
export declare function useOverlayTarget(kind: OverlayKind, anchor: RefObject<HTMLElement | null>): HTMLElement;
