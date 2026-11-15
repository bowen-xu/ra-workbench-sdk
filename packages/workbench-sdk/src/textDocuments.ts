import type {AgentResourceScope, AgentSkillIdentity} from "@research-assistant/core/agent";
import type {WorkspaceView} from "./workbench.js";

export type TextDocumentReopen = {readonly kind: "system"; readonly id: string}
  | {readonly kind: "skill"; readonly identity: AgentSkillIdentity; readonly scope?: AgentResourceScope};

export interface TextDocumentRequest {
  /** Reopen through the existing authoritative gateway, not saved callbacks. */
  readonly reopen?: TextDocumentReopen;
  readonly id: string;
  readonly path: string;
  readonly title?: string;
  readonly owner?: WorkspaceView;
  readonly content: string;
  readonly baseline?: string;
  readonly readOnly?: boolean;
  readonly save?: (content: string, baseline: string) => Promise<void>;
}

/** Original cancelable navigation request. True means the destination accepted
 * and revealed its tab; this function does not write or create a resource. */
export declare function openTextDocument(document: TextDocumentRequest): boolean;
