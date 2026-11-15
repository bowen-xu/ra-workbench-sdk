import type {JSX, ReactNode} from "react";
import type {AgentCanvasMessage, AgentCanvasMessageOptions} from "./agentUi.js";

/** Retains the existing Core canvas registration and the host's original sessions. */
export declare function AgentCanvasHost(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onNewConversation: () => void;
  readonly conversations: ReactNode;
  readonly workspaceId?: string;
  readonly selectedId?: string | null;
  readonly onSelect?: (id: string, archived: boolean) => void;
  readonly onArchive?: (id: string, archived: boolean) => void;
  readonly onDeleted?: (id: string) => void;
  readonly enabled?: boolean;
  readonly children: (controls: {readonly headerControls: ReactNode; readonly showLauncher: boolean}) => ReactNode;
}): JSX.Element;
export declare function useAgentCanvasExternalSubmission(handler: (
  text: string,
  resources?: AgentCanvasMessage["resources"],
  options?: AgentCanvasMessageOptions,
) => Promise<void>): void;
