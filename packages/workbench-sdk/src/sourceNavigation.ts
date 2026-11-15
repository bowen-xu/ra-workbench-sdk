import type { ReadingNoteSource } from "@research-assistant/core/notes";
import type { SourceLocator, SourceLineRange } from "@research-assistant/core/source";
import type {AgentEvidenceInput} from "@research-assistant/core/agent";

export interface SourceNavigationLocation { readonly getAnchorRect: () => DOMRect | null; }
export interface WritingSourceNavigation {
  readonly manuscriptId: string;
  readonly path: string;
  readonly locator?: SourceLocator;
  readonly locate?: boolean;
  readonly token: number;
  readonly resolve: (location?: SourceNavigationLocation) => void;
  readonly reject: (error: unknown) => void;
}
export interface NoteSourceNavigation {
  readonly pageId: string;
  readonly blockId: string;
  readonly token: number;
  readonly range?: SourceLineRange;
  readonly onLocated?: (location?: SourceNavigationLocation) => void;
  readonly onError?: (error: unknown) => void;
}
/** Ephemeral UI locator; not a persisted reading-note source selector. */
export interface ReaderSourceNavigation extends ReadingNoteSource {
  readonly navigationLineRange?: SourceLineRange;
  readonly navigationOnLocated?: (location?: SourceNavigationLocation) => void;
  readonly navigationOnError?: (error: unknown) => void;
}

export interface SourceNavigationOptions {
  readonly presentation?: "document";
  readonly locate?: boolean;
  readonly annotation?: AgentEvidenceInput;
}
/** Core resolves existing object paths and owns completion/positioning errors. */
export declare function navigateSource(href: string, options?: SourceNavigationOptions): Promise<SourceNavigationLocation | undefined>;
export declare function openSourceLink(href: string): void;
