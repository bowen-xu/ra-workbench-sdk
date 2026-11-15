import type {
  DictionaryGateway, WordExplanation, WordExplanationGateway, WordExplanationRequest, WordExplanationStore,
} from "@research-assistant/core/dictionary";
import type {JSX} from "react";

/** Existing Core-selected contextual generation port; caller cancellation and
 * model metadata retain their original meanings. */
export declare function getWordExplanationGateway(): WordExplanationGateway<AbortSignal>;

/** Reuses the original local lexicon factory and its bounded per-owner cache. */
export declare function createDictionaryGateway(fetchAsset?: typeof fetch, baseUrl?: string): DictionaryGateway<AbortSignal>;

export declare function DictionaryLookup(props: {
  readonly text: string;
  readonly gateway: DictionaryGateway<AbortSignal>;
  readonly explanation?: WordExplanation;
  readonly explaining?: boolean;
  readonly context: WordExplanationRequest;
  readonly explanationGateway?: WordExplanationGateway<AbortSignal>;
  readonly onDeleteExplanation?: () => Promise<void>;
  readonly deleteDisabled?: boolean;
}): JSX.Element;

export declare function WordContextExplanation(props: {
  readonly explanation: WordExplanation;
  readonly context: WordExplanationRequest;
  readonly gateway?: WordExplanationGateway<AbortSignal>;
  readonly onDelete?: () => Promise<void>;
  readonly deleteDisabled?: boolean;
}): JSX.Element;

/** Original public list/save/remove port; no storage, client or cache replica. */
export declare function getWordExplanationStore(): WordExplanationStore;
