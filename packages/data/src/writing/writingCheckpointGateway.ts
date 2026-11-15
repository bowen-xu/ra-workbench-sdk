/** Public domain contract. No platform adapter or UI implementation imports. */
import type { WritingCheckpointRecord, WritingCheckpointWrite } from "@research-assistant/writing";

export interface WritingCheckpointGateway {
  save(write: WritingCheckpointWrite): Promise<WritingCheckpointRecord>;
  list(manuscriptId: string): Promise<readonly WritingCheckpointRecord[]>;
}
