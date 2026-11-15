export const NOTE_CATALOG_COLLATION_VERSION = "icu4x-2.3.1/zh-CN/kn-primary/v1";
/** Pure projection port. Adapters persist the versions beside derived indexes;
 * these versions never replace document revisions or confer resource access. */
export interface NoteCatalogRuntime {
  readonly collationVersion: string;
  readonly normalizationVersion: string;
  sortKey(text: string): Uint8Array;
  reverseKey(key: Uint8Array): Uint8Array;
  fold(text: string): string;
  terms(text: string): readonly string[];
  displayTitle(body: string, quote: string, fallback: string): string;
}
