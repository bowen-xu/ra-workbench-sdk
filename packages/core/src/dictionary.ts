export interface DictionaryEntry {
  readonly word: string;
  readonly phonetic: string;
  readonly translation: string;
  readonly definition: string;
  readonly exchange: string;
}

export interface DictionaryResult {
  readonly query: string;
  readonly entries: readonly DictionaryEntry[];
  readonly suggestions?: readonly { readonly word: string; readonly kind: "form" | "spelling" }[];
}
export { stripDictionaryWord, dictionaryEditDistance } from "./dictionaryMatching";

/** Local lexicon port. Lookup never implies a provider or semantic explanation. */
export interface DictionaryGateway<Signal = never> {
  lookup(text: string, signal?: Signal): Promise<DictionaryResult>;
}

/** Explicit contextual generation, independent of offline lexicon lookup. */
export interface WordExplanationRequest {
  readonly word: string;
  readonly before: string;
  readonly after: string;
}

export interface WordExplanation {
  readonly translation: string;
  readonly explanation: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision?: string;
}

export interface WordChatMessage { readonly role: "user" | "assistant"; readonly text: string }
export interface WordFollowUpRequest {
  readonly context: WordExplanationRequest;
  readonly explanation: Pick<WordExplanation, "translation" | "explanation">;
  readonly messages: readonly WordChatMessage[];
}
export interface WordFollowUpReply {
  readonly text: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelRevision?: string;
}

export interface WordExplanationGateway<Signal = never> {
  explain(request: WordExplanationRequest, signal?: Signal): Promise<WordExplanation>;
  followUp(request: WordFollowUpRequest, signal?: Signal): Promise<WordFollowUpReply>;
}

export interface WordExplanationDraft {
  readonly attachmentId: string;
  readonly contentSha256: string;
  readonly segments: readonly import("./pdf-view").PdfSelectionSegment[];
  readonly context: WordExplanationRequest;
  readonly explanation: WordExplanation;
}
export interface StoredWordExplanation extends WordExplanationDraft { readonly id: string }
export interface WordExplanationStore {
  list(attachmentId: string, contentSha256: string): Promise<readonly StoredWordExplanation[]>;
  save(draft: WordExplanationDraft): Promise<StoredWordExplanation>;
  remove(record: StoredWordExplanation): Promise<void>;
}

/** Reuse only the same occurrence; equal spellings elsewhere may have another sense. */
export function wordExplanationForSelection(records: readonly StoredWordExplanation[], segments: readonly import("./pdf-view").PdfSelectionSegment[]): StoredWordExplanation | undefined {
  return records.find(record => record.segments.length === segments.length && record.segments.every((saved, index) => {
    const current = segments[index];
    return current !== undefined && saved.pageIndex === current.pageIndex && saved.text === current.text && saved.rects.length === current.rects.length
      && saved.rects.every((rect, rectIndex) => {
        const box = current.rects[rectIndex];
        return box !== undefined && ["x", "y", "width", "height"].every(key => {
          const coordinate = key as keyof typeof rect;
          return Math.abs(rect[coordinate] - box[coordinate]) <= 0.0001;
        });
      });
  }));
}

/** Validate persisted/IPC reading aids before they can paint on a PDF page. */
export function isStoredWordExplanation(value: unknown): value is StoredWordExplanation {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  const context = data.context as Record<string, unknown> | undefined;
  const explanation = data.explanation as Record<string, unknown> | undefined;
  return typeof data.id === "string" && typeof data.attachmentId === "string" && typeof data.contentSha256 === "string" && /^[a-f0-9]{64}$/.test(data.contentSha256)
    && context !== null && typeof context === "object" && typeof context.word === "string" && isDictionaryQuery(normalizeDictionaryQuery(context.word))
    && typeof context.before === "string" && context.before.length <= 1200 && typeof context.after === "string" && context.after.length <= 1200
    && explanation !== null && typeof explanation === "object" && typeof explanation.translation === "string" && explanation.translation.trim().length > 0 && explanation.translation.length <= 240
    && typeof explanation.explanation === "string" && explanation.explanation.trim().length > 0 && explanation.explanation.length <= 2000
    && typeof explanation.providerId === "string" && typeof explanation.modelId === "string"
    && (explanation.modelRevision === undefined || typeof explanation.modelRevision === "string")
    && Array.isArray(data.segments) && data.segments.length > 0 && data.segments.length <= 2 && data.segments.every((segment: unknown) => {
      if (typeof segment !== "object" || segment === null) return false;
      const item = segment as Record<string, unknown>;
      return Number.isInteger(item.pageIndex) && (item.pageIndex as number) >= 0 && typeof item.text === "string" && item.text.length <= 200
        && typeof item.prefix === "string" && item.prefix.length <= 128 && typeof item.suffix === "string" && item.suffix.length <= 128
        && Array.isArray(item.rects) && item.rects.length > 0 && item.rects.length <= 16 && item.rects.every((rect: unknown) => {
          if (typeof rect !== "object" || rect === null) return false;
          const box = rect as Record<string, unknown>;
          return [box.x, box.y, box.width, box.height].every(number => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1)
            && (box.width as number) > 0 && (box.height as number) > 0 && (box.x as number) + (box.width as number) <= 1.001 && (box.y as number) + (box.height as number) <= 1.001;
        });
    });
}

export function normalizeDictionaryQuery(text: string): string {
  return text.normalize("NFKC")
    .replace(/([a-z])-\s*\n\s*([a-z])/gi, "$1$2")
    .replace(/[‘’]/g, "'").replace(/[‐‑–]/g, "-")
    .trim().replace(/^[\s“”"'([{.,:;!?]+|[\s“”"'\])}.,:;!?]+$/g, "")
    .replace(/\s+/g, " ").toLowerCase();
}

export function isDictionaryQuery(text: string): boolean {
  return text.length > 0 && text.length <= 100 && text.split(" ").length <= 6
    && /^[a-z0-9][a-z0-9 '\-./()]*$/i.test(text);
}

const EXCHANGE_LABELS: Readonly<Record<string, string>> = {
  p: "过去式", d: "过去分词", i: "现在分词", "3": "第三人称单数",
  r: "比较级", t: "最高级", s: "复数", "0": "原形",
};

export function dictionaryWordForms(exchange: string): readonly { readonly label: string; readonly word: string }[] {
  return exchange.split("/").flatMap(part => {
    const colon = part.indexOf(":");
    const label = EXCHANGE_LABELS[part.slice(0, colon)];
    const word = part.slice(colon + 1);
    return colon > 0 && label && word ? [{ label, word }] : [];
  });
}
