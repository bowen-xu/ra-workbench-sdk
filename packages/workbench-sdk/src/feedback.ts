import type {Dispatch, ReactNode, SetStateAction} from "react";
import type {ExternalToast} from "sonner";

export type NotificationKind = "error" | "info" | "loading" | "success" | "warning";
export interface NotificationAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void | Promise<void>;
}
export interface NotificationOptions extends ExternalToast { readonly actions?: readonly NotificationAction[] }
export interface NotificationUpdate extends NotificationOptions { readonly message?: string }
export interface NotificationPort {
  dismiss(id: string | number): void;
  hide(id: string | number): void;
  showHidden(): void;
  update(id: string | number, update: NotificationUpdate): void;
  error(message: string, options?: NotificationOptions): string | number;
  info(message: string, options?: NotificationOptions): string | number;
  loading(message: string, options?: NotificationOptions): string | number;
  success(message: string, options?: NotificationOptions): string | number;
  warning(message: string, options?: NotificationOptions): string | number;
}

/** The existing Core notification owner; no Sonner instance is constructed here. */
export declare const notify: NotificationPort;
/** Uses the same notification owner while retaining the caller's local state. */
export declare function useNotificationState(kind?: "error" | "info"): [string | undefined, Dispatch<SetStateAction<string | undefined>>];
export declare function NotificationEffect(props: {
  readonly id: string;
  readonly message: string | undefined;
  readonly kind?: "warning" | "error" | "info";
}): null;
