import type {WritingCheckpointGateway, WritingGateway, WritingNoteAssetGateway} from "@research-assistant/data/writing";

/** Core selects the original runtime gateway; browser domain fallback stays with its caller. */
export declare function resolveWritingRuntimeGateway(browserFallback: WritingGateway): WritingGateway;
export declare function resolveWritingCheckpointRuntimeGateway(browserFallback: WritingCheckpointGateway): WritingCheckpointGateway;
export declare function getWritingNoteAssetNativeGateway(): WritingNoteAssetGateway;
