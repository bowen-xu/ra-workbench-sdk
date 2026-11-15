import type {StructuredStartupImportResult} from "@research-assistant/core/structured-resources";

/** A frozen Core-owned view. Only a view returned by getRuntimeEnvironment is
 * accepted by the startup barrier; cloning these fields does not copy ownership. */
export interface RuntimeEnvironment {
  readonly mode: "desktop" | "browser" | "preview";
  readonly hasStructuredResourceGateway: boolean;
}

export interface NativePreviewCapabilities {
  readonly generation: string;
  readonly supportsManualCompaction: boolean;
  readonly supportsOwnerIntent: boolean;
}

/** Read the startup-selected Core environment without selecting adapters or
 * exposing its gateway registry, native transport or storage owner. */
export declare function isAppPreview(): boolean;
export declare function isDesktopRuntime(): boolean;
export declare function hasPlatformCapabilities(): boolean;
export declare function getRuntimeEnvironment(): RuntimeEnvironment;
/** Return the original Storage captured by this view, even if Core separately
 * selects another global Storage or another runtime. */
export declare function getRuntimeStorage(environment: RuntimeEnvironment): Storage;
/** Read the current finite support of this captured owner, including after its
 * native preview resets. Absence and unsupported capabilities remain distinct. */
export declare function getNativePreviewCapabilities(environment: RuntimeEnvironment): Readonly<NativePreviewCapabilities> | undefined;
/** Capture synchronously before asynchronous preparation. Reuse the returned
 * original writer when rebasing or retrying a request. */
export declare function captureNewPreviewOwnerIntent(environment: RuntimeEnvironment,
  conversationId: string): ((requestId: string) => Promise<void>) | undefined;
export declare function freezeNewPreviewOwnerIntent(environment: RuntimeEnvironment,
  conversationId: string, requestId: string): Promise<void>;
/** Use the owner captured by this view, even after another runtime is selected.
 * Forged or cloned views fail before starting any work. */
export declare function ensureRuntimeStructuredResources(environment: RuntimeEnvironment): Promise<StructuredStartupImportResult>;
