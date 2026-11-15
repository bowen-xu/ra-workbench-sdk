/** Canonical Rust i64 decimal text. Never convert a provider index to Number. */
export type AgentReasoningSummaryIndex = string;
export interface AgentReasoningSummaryPart {
  readonly index: AgentReasoningSummaryIndex;
  readonly startByte: number;
  readonly lenByte: number;
}
export interface AgentReasoningSummaryTextPart {
  readonly index: AgentReasoningSummaryIndex;
  readonly text: string;
}
export const AGENT_REASONING_SUMMARY_MAX_BYTES = 16 * 1024 * 1024;

export function decodeAgentReasoningSummaryIndex(value: unknown): AgentReasoningSummaryIndex {
  if (typeof value !== "string" || value.length > 20 || !/^(?:0|-?[1-9][0-9]*)$/u.test(value)) throw new Error("Invalid reasoning summary index");
  const index = BigInt(value);
  if (index < -9223372036854775808n || index > 9223372036854775807n) throw new Error("Invalid reasoning summary index");
  return value;
}

export function decodeAgentReasoningSummaryParts(value: unknown): readonly AgentReasoningSummaryPart[] {
  if (!Array.isArray(value)) throw new Error("Invalid reasoning summary parts");
  return value.map((part: unknown) => {
    if (!part || typeof part !== "object" || Array.isArray(part) || Object.keys(part).length !== 3
      || !("index" in part) || !("startByte" in part) || !("lenByte" in part)
      || typeof part.startByte !== "number" || !Number.isSafeInteger(part.startByte) || part.startByte < 0
      || typeof part.lenByte !== "number" || !Number.isSafeInteger(part.lenByte) || part.lenByte < 0) throw new Error("Invalid reasoning summary parts");
    return { index: decodeAgentReasoningSummaryIndex(part.index), startByte: part.startByte, lenByte: part.lenByte };
  });
}

/** Validate contiguous UTF-8 spans and recover public parts without decoding native JSON.
 * Empty parts retain their position. This walks the body once, including surrogate pairs. */
export function agentReasoningSummaryParts(text: string, parts: readonly AgentReasoningSummaryPart[]): readonly AgentReasoningSummaryTextPart[] {
  const result: AgentReasoningSummaryTextPart[] = [];
  const indices = new Set<string>();
  let byteOffset = 0, charOffset = 0;
  for (const part of parts) {
    const index = decodeAgentReasoningSummaryIndex(part.index);
    if (indices.has(index) || part.startByte !== byteOffset || !Number.isSafeInteger(part.lenByte) || part.lenByte < 0
      || !Number.isSafeInteger(part.startByte + part.lenByte)) throw new Error("Invalid reasoning summary span");
    indices.add(index);
    const start = charOffset, end = part.startByte + part.lenByte;
    while (byteOffset < end && charOffset < text.length) {
      const point = text.codePointAt(charOffset)!;
      if (point >= 0xd800 && point <= 0xdfff) throw new Error("Invalid reasoning summary UTF-8");
      byteOffset += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      charOffset += point > 0xffff ? 2 : 1;
    }
    if (byteOffset !== end) throw new Error("Invalid reasoning summary span");
    result.push({ index: part.index, text: text.slice(start, charOffset) });
  }
  if (charOffset !== text.length) throw new Error("Invalid reasoning summary coverage");
  return result;
}
