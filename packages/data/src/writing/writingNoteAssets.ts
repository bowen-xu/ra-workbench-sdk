/** Fixed native asset transport. Business validation, browser persistence and
 * runtime ownership checks stay with the writing note host. */
import type {WritingNoteAsset} from "@research-assistant/writing";

export interface WritingNoteAssetGateway {
  importAsset(request: {readonly manuscriptId: string; readonly displayName: string;
    readonly mimeType: string; readonly bytes: readonly number[]}): Promise<WritingNoteAsset>;
  readAsset(manuscriptId: string, assetId: string): Promise<readonly number[]>;
  exportAsset(request: {readonly manuscriptId: string; readonly assetId: string;
    readonly destinationPath: string}): Promise<{readonly destinationPath: string}>;
}
