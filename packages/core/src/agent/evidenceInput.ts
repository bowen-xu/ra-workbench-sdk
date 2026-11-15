import { parseSourceLink } from "../sourceNavigation";
import { row, utf8Length } from "./workspaceDecoding";

/** Captured evidence is independent of composer mentions and resource authority. */
export interface AgentEvidenceImage {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp";
  readonly assetId: string;
  readonly captureId: string;
  readonly byteSize: number;
}
interface EvidenceTarget {
  readonly source?: string;
  readonly title: string;
  readonly text: string;
}
export interface AgentEvidenceInput extends EvidenceTarget {
  readonly type: "annotation";
  readonly comment: string;
  readonly image?: AgentEvidenceImage;
  readonly displayText?: string;
}

/** Strip only the obsolete PDF text-capture screenshot; retain quoted text and geometry. */
export function withoutAutomaticTextScreenshot(item: AgentEvidenceInput): AgentEvidenceInput {
  if (!item.image || !item.displayText?.trim() || !item.text.startsWith("{")) return item;
  try {
    const capture: unknown = JSON.parse(item.text);
    if (!capture || typeof capture !== "object") return item;
    const data = capture as Record<string, unknown>;
    if (typeof data.pageNumber !== "number" || !data.rect || typeof data.rect !== "object" || data.selectedText !== item.displayText) return item;
    const {image: _image, ...textAnnotation} = item;
    return textAnnotation;
  } catch {return item;}
}

export function decodeAgentEvidenceInput(value: unknown): AgentEvidenceInput {
  if (!value || typeof value !== "object") throw new Error("引用内容无效");
  // Existing immutable history and saved drafts normalize on read, never rewrite.
  if ((value as {type?: unknown}).type === "selection") {
    const legacy = row(value, ["type", "source", "title", "text"]);
    value = {...legacy, type: "annotation", comment: ""};
  }
  const item = row(value, ["type", "title", "text", "comment", ...["source", "image", "displayText"].filter(key => key in (value as object))]);
  if (item.type !== "annotation") throw new Error("引用类型无效");
  const type = "annotation";
  if (Object.hasOwn(item, "source")) {
    if (typeof item.source !== "string") throw new Error("引用来源无效");
    parseSourceLink(item.source);
  }
  if (typeof item.title !== "string" || !item.title.trim() || utf8Length(item.title) > 1024 || /[\u0000-\u001f]/u.test(item.title)) throw new Error("引用名称无效");
  if (typeof item.text !== "string" || item.text.includes("\0") || utf8Length(item.text) > 262144) throw new Error("引用内容无效或过大");
  if (!Object.hasOwn(item, "source") && (!item.text.trim() || Object.hasOwn(item, "image") || Object.hasOwn(item, "displayText"))) throw new Error("无来源引用必须是非空纯文本");
  const target = {...(typeof item.source === "string" ? {source: item.source} : {}), title: item.title, text: item.text};
  if (typeof item.comment !== "string" || item.comment.includes("\0") || utf8Length(item.comment) > 65536) throw new Error("批注内容无效或过大");
  if (item.displayText !== undefined && (typeof item.displayText !== "string" || item.displayText.includes("\0") || utf8Length(item.displayText) > 262144)) throw new Error("批注预览无效或过大");
  const display = item.displayText === undefined ? {} : {displayText:item.displayText as string};
  if (item.image === undefined) return {type, ...target, comment: item.comment, ...display};
  const image = row(item.image, ["mediaType", "assetId", "captureId", "byteSize"]);
  if (!["image/png", "image/jpeg", "image/webp"].includes(String(image.mediaType)) || typeof image.assetId !== "string" || !/^[a-f0-9]{64}$/u.test(image.assetId) || typeof image.captureId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(image.captureId) || typeof image.byteSize !== "number" || !Number.isSafeInteger(image.byteSize) || image.byteSize < 1 || image.byteSize > 524288) throw new Error("批注图片格式不支持或超过 512 KiB");
  return {type, ...target, comment: item.comment, ...display, image: {mediaType: image.mediaType as AgentEvidenceImage["mediaType"], assetId:image.assetId, captureId:image.captureId, byteSize:image.byteSize}};
}
