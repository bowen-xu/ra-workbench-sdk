/** Initial workbench contracts; persisted identities and callback semantics are unchanged. */
export type WorkspacePresentation = "workspace" | "document";

/** Stable navigation identity. Runtime IDs are admitted by the view registry;
 * this type alone neither registers a view nor grants permission to open it. */
export type WorkspaceView = string;

export interface WorkspaceLocation {
  readonly view: WorkspaceView;
  readonly presentation?: "document";
  /** Research context is independent of the document's editor/storage owner. */
  readonly workspaceView?: WorkspaceView;
  readonly tabId?: string;
  readonly notePageId?: string;
}

export interface WorkspaceTab {
  readonly id: string;
  readonly owner: WorkspaceView;
  readonly destination?: string;
  readonly presentation?: WorkspacePresentation;
  readonly title: string;
  readonly active: boolean;
  readonly home?: boolean;
  readonly preview?: boolean;
  readonly dirty?: boolean;
  readonly pending?: boolean;
  readonly icon?: "pdf" | "code" | "text";
  readonly select: () => void;
  readonly close?: () => void;
  readonly pin?: () => void;
}

/** A host-owned save/close boundary; closing a view does not cancel its background tasks. */
export interface WorkspaceClosePort { prepareClose(requireSaved?: boolean): Promise<boolean>; }

export interface ReaderCloseBoundary {
  readonly isActive: () => boolean;
  readonly prepare: () => Promise<boolean>;
  readonly prepareClose?: () => Promise<boolean>;
  readonly commit: () => void;
}
/** The existing shared close barrier, never a second coordinator instance. */
export interface ReaderClosePort {
  register(id: string, boundary: ReaderCloseBoundary): () => void;
  close(id: string): Promise<boolean>;
  prepareAll(): Promise<boolean>;
}
export declare function getReaderCloseCoordinator(): ReaderClosePort;
export declare function useWorkspacePresentation(): WorkspacePresentation;
/** Publish into the existing Core tab registry; false keeps the host's local
 * tabs when no shell registry is present or publication is disabled. */
export declare function usePublishWorkspaceTabs(group: string, tabs: readonly WorkspaceTab[], enabled?: boolean): boolean;
