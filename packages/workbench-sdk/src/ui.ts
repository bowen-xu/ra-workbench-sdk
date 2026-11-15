import type {CitationStyle} from "@research-assistant/core/citation";
import type {ContentTrustNode, ContentTrustStatus} from "@research-assistant/core/content-trust";
import type {ComponentPropsWithRef, ElementType, JSX, ReactNode, Ref} from "react";

export interface ContentTrustIndicatorProps {
  readonly status: ContentTrustStatus;
  readonly subjectLabel?: string;
  readonly statusLabel?: string;
  readonly onActivate?: (() => void) | undefined;
  readonly size?: "small" | "medium";
  readonly showLabel?: boolean;
  readonly showHint?: boolean;
  readonly className?: string;
}

export interface ContentTrustGroupControlsProps {
  readonly tree: ContentTrustNode;
  readonly currentId?: string | undefined;
  readonly onConfirmPending?: ((ids: readonly string[]) => void) | undefined;
  readonly onNavigate?: ((node: ContentTrustNode) => void) | undefined;
  readonly compact?: boolean;
  readonly hideResolvedIndicator?: boolean;
}

/** Existing Core presentation. Hosts retain review decisions and persistence. */
export declare function ContentTrustIndicator(props: ContentTrustIndicatorProps): JSX.Element;
export declare function ContentTrustGroupControls(props: ContentTrustGroupControlsProps): JSX.Element;
export declare function CitationStyleSelect(props: {
  readonly value: CitationStyle;
  readonly onChange: (value: CitationStyle) => void;
}): JSX.Element;
export declare function MouseLeftShortcut(props: {readonly modifier: "⌘" | "⌥"}): JSX.Element;
interface InlineReferencePresentation {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly truncate?: boolean;
  readonly tone?: "accent" | "inherit";
  readonly underline?: "none" | "dashed";
  readonly labelRef?: Ref<HTMLSpanElement>;
  readonly labelContent?: ReactNode;
}
export declare function InlineReference<T extends ElementType = "span">(props:
  InlineReferencePresentation & {readonly as?: T}
  & Omit<ComponentPropsWithRef<T>, keyof InlineReferencePresentation | "as" | "children">,
): JSX.Element;
