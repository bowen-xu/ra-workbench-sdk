import type {LlmConfiguration, LlmModelRouteDraft, LlmModelSelection, LlmProviderId, LlmProviderModels} from "@research-assistant/core/ai";
import type {JSX} from "react";

/** Original three-method selection port, without credentials or provider setup. */
export interface LlmRouteGateway {
  getLlmConfiguration(): Promise<LlmConfiguration>;
  fetchLlmProviderModels(providerId: LlmProviderId, refresh?: boolean): Promise<LlmProviderModels>;
  saveLlmModelRoutes(drafts: readonly LlmModelRouteDraft[]): Promise<LlmConfiguration>;
}

export interface LlmRoutePickerProps {
  readonly disabled?: boolean;
  readonly description?: string;
  readonly gateway?: LlmRouteGateway;
  readonly legend?: string;
  readonly onSelection: (selection: LlmModelSelection | undefined) => void;
  readonly taskKind: string;
}

/** Core retains the model catalog, route configuration and selection lifecycle. */
export declare function LlmRoutePicker(props: LlmRoutePickerProps): JSX.Element;
