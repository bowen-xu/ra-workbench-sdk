/** Public domain contract. No platform adapter or UI implementation imports. */
import type { CitationKeyAssignment, ManuscriptFileContent, WritingCheckpointRecord } from "@research-assistant/writing";

export interface CitationKeyMigration {
  readonly assignments: readonly CitationKeyAssignment[];
  readonly files: readonly ManuscriptFileContent[];
  readonly checkpoints: readonly WritingCheckpointRecord[];
}
