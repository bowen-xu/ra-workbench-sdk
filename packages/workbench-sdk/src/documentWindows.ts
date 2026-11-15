import type {JSX, ReactNode, RefObject} from "react";

export interface NoteWindowSession {
  readonly prepareClose: () => Promise<boolean>;
  readonly openTab: (accepted: () => void) => Promise<boolean | void>;
  readonly dismiss: () => void;
  readonly reportError: (reason: unknown) => void;
  readonly beginOperation?: () => boolean;
  readonly endOperation?: () => void;
}

/** Core window presentation retains the caller's existing document owner. */
export declare function NoteFloatingWindow(props: {
  readonly open?: boolean;
  readonly identity: string;
  readonly title: string;
  readonly label: string;
  readonly closeLabel: string;
  readonly resizeLabel: string;
  readonly session: NoteWindowSession;
  readonly panelRef?: RefObject<HTMLElement | null>;
  readonly canExpand?: boolean;
  readonly className?: string;
  readonly children: ReactNode | ((state: {readonly busy: boolean}) => ReactNode);
}): JSX.Element | null;
