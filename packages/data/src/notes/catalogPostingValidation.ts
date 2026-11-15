import {NotesGatewayError} from "./errors";

export function invalidNotePosting(): never {
  throw new NotesGatewayError("index_failed", "note_search_postings_invalid：搜索投影损坏，请保留原始笔记并重建索引。");
}

/** Internal shared boundary for component vectors and query ordinals. */
export function validatePostingValues(values: Uint32Array, minimum: number): void {
  if (!(values instanceof Uint32Array)) invalidNotePosting();
  let previous = minimum - 1;
  for (const value of values) {if (value <= previous) invalidNotePosting(); previous = value;}
}
