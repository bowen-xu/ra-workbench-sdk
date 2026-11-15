/** Minimal boundary for the pinned, browser-compatible daff 1.4.2 entry. */
declare module "daff/lib/core.js" {
  interface Unit { readonly l: number; readonly r: number }
  interface Alignment { readonly meta: Alignment | null; toOrder(): { getList(): Unit[] } }
  class TableView { constructor(data: readonly (readonly string[])[]); }
  const daff: {
    TableView: typeof TableView;
    compareTables(before: TableView, after: TableView): { align(): Alignment };
  };
  export default daff;
}
