import type {AgentContextResource, AgentEvidenceImage, AgentEvidenceInput} from "@research-assistant/core/agent";
import type {ComponentPropsWithoutRef, ForwardRefExoticComponent, JSX, RefAttributes} from "react";

/** Submission to the existing Core canvas; the caller does not own its draft,
 * conversation, evidence handles or lifetime. */
export interface AgentCanvasMessage {
  readonly text: string;
  readonly options?: AgentCanvasMessageOptions;
  readonly resources?: readonly AgentContextResource[];
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

export interface AgentCanvasMessageOptions {
  readonly evidence?: readonly AgentEvidenceInput[];
  readonly mode?: "draft";
  /** Preserve the original draft capture's optional non-revealing behavior. */
  readonly reveal?: false;
}

export type SelectionAnnotationIntent = "send" | "silent";

type AgentCanvasSubmission = (
  text: string,
  resources?: AgentCanvasMessage["resources"],
  options?: AgentCanvasMessageOptions,
) => Promise<void>;

export declare const SelectionAskAiButton: ForwardRefExoticComponent<
  Omit<ComponentPropsWithoutRef<"button">, "children" | "type" | "aria-label"> & RefAttributes<HTMLButtonElement>
>;

export declare function SelectionAskAiEditor(props: {
  readonly title: string;
  readonly disabled?: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (comment: string, intent?: SelectionAnnotationIntent) => Promise<void>;
}): JSX.Element;

/** Core captures and releases evidence through its existing resource owner.
 * Rejection retains the original error; discard runs after submission succeeds. */
export declare function submitEvidenceAnnotation(request: {
  readonly capture: () => Promise<readonly AgentEvidenceInput[]>;
  readonly resources: AgentCanvasMessage["resources"];
  readonly comment: string;
  readonly intent?: SelectionAnnotationIntent;
  readonly submit: AgentCanvasSubmission;
  readonly discard: () => void;
}): Promise<void>;

/** Navigate using the existing Core conversation owner; rejects if unavailable. */
export declare function openAgentConversation(id: string): Promise<void>;

/** Uses the mounted Core canvas and rejects when that owner is unavailable. */
export declare function useAgentCanvasMessage(): AgentCanvasSubmission;

/** Import into the existing Core content-addressed asset/evidence lifecycle.
 * Original image validation and failures remain in Core. */
export declare function captureEvidenceImage(bytes: readonly number[], mediaType: string, title: string): Promise<AgentEvidenceImage>;
