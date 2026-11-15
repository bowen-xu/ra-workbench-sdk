import type {ConceptRetrievalPreview} from "@research-assistant/core/ai";
import type {JSX} from "react";

export interface PendingConceptRetrieval {
  readonly text: string;
  readonly preview?: ConceptRetrievalPreview;
  readonly isLoading: boolean;
}

/** Original Core presentation. The host owns query execution, cancellation,
 * source confirmation and the existing trace identity. */
export declare function PaperConceptRetrievalControl(props: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly pending?: PendingConceptRetrieval;
  readonly onCancel: () => void;
  readonly onChange: (checked: boolean) => void;
  readonly onConfirm: () => void;
}): JSX.Element;
