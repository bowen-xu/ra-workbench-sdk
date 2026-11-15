import type {WritingNoteCatalogGateway} from "@research-assistant/data/notes";
import type {LiteratureGateway} from "@research-assistant/data/literature";

/** Optional provider lookup neither initializes an owner nor grants authority. */
export declare function getOptionalWritingNoteCatalog(): WritingNoteCatalogGateway | undefined;
export type LiteratureInteroperability = Pick<LiteratureGateway, "get" | "list" | "save" | "updateMetadataField">;
export declare function getOptionalLiteratureGateway(): LiteratureInteroperability | undefined;
