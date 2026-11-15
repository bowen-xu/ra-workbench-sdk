export interface BrowserCaptureEvent {
  readonly kind: "item" | "attachment" | "tags";
}

export interface FileDropPosition {
  readonly x: number;
  readonly y: number;
}

export type WindowFileDropEvent =
  | {readonly type: "leave"}
  | {readonly type: "over"; readonly position: FileDropPosition}
  | {readonly type: "enter" | "drop"; readonly position: FileDropPosition; readonly paths: readonly string[]};

/** Original fixed capture signal; the caller owns unsubscription, including
 * subscriptions that resolve after its view has already stopped. */
export declare function listenBrowserCaptures(listener: (event: BrowserCaptureEvent) => void): Promise<() => void>;
/** Window-local file drop only. This is not an arbitrary native event port. */
export declare function subscribeWindowFileDrop(listener: (event: WindowFileDropEvent) => void): Promise<() => void>;
/** Reuse Core's existing platform/zoom coordinate conversion. */
export declare function desktopDropClientPosition(position: FileDropPosition): FileDropPosition;
