import { catalogOperationId } from "./catalogOperationDecoding";
import { decodeAgentUserInput } from "./userInput";
import { AgentSubmissionDecodeError } from "./submission";

function fail(): never { throw new AgentSubmissionDecodeError(); }
function id(value: unknown): string { try {return catalogOperationId(value);} catch {return fail();} }
function image(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>, names = ["mediaType", "assetId", "captureId", "byteSize"];
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) return fail();
  return row;
}

/** Match native request serde defaults without rewriting frozen source URLs. */
export function decodeAgentRequestUserInput(value: unknown, message: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail();
  const sourceUrls = new Map<number, string>();
  const normalized = value.map((value: unknown, index: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const item = value as Record<string, unknown>;
    if (item.type === "text") return {...item, textElements: item.textElements === undefined ? [] : item.textElements};
    const targetRow = item.target && typeof item.target === "object" && !Array.isArray(item.target) ? item.target as Record<string, unknown> : null;
    if (item.type === "mention" && targetRow?.kind === "file") {
      const {revision: _legacy, sourceUrl, ...target} = targetRow;
      if (_legacy !== undefined && typeof _legacy !== "string") return fail();
      if (typeof sourceUrl === "string") sourceUrls.set(index, sourceUrl);
      return {...item, target: {...target, ...(sourceUrl == null ? {} : {sourceUrl})}};
    }
    if (item.type === "annotation" || item.type === "selection") {
      const {image: captured, displayText, ...rest} = item;
      const evidence = captured == null ? null : image(captured);
      return {...rest, type: "annotation", comment: item.comment === undefined ? "" : item.comment,
        ...(evidence === null ? {} : {image: {...evidence, captureId: id(evidence.captureId)}}),
        ...(displayText == null ? {} : {displayText})};
    }
    return item;
  });
  return decodeAgentUserInput(normalized, message).map((item, index) => {
    const sourceUrl = sourceUrls.get(index);
    return item.type === "mention" && item.target.kind === "file" && sourceUrl !== undefined ? {...item, target: {...item.target, sourceUrl}} : item;
  });
}
