/** Application object paths. These paths never name native filesystem files. */
export interface SourceLineRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}
export type SourceLocator = { readonly kind: "line"; readonly range: SourceLineRange; readonly pageNumber?: number }
  | { readonly kind: "block"; readonly blockId: string; readonly range?: SourceLineRange };
export interface SourceLink {
  readonly path: readonly string[];
  readonly locator?: SourceLocator;
}
export const SOURCE_ROOTS = ["library", "notes", "writings", "agents", "assets"] as const;
export type SourceRoot = typeof SOURCE_ROOTS[number];
export function sourcePath(root: SourceRoot, ...segments: string[]): string {
  return formatSourceLink({path: [root, ...segments]});
}
/** Object-reference kinds are metadata; their addresses use the same directory. */
export function referenceSourcePath(kind: string, id: string): string {
  if (kind === "paper") return sourcePath("library", id);
  if (kind === "manuscript") return sourcePath("writings", id);
  if (kind === "claim") return sourcePath("assets", "claims", id);
  return sourcePath("notes", id);
}
export class SourceLinkError extends Error {
  constructor(message = "来源链接格式无效") { super(message); this.name = "SourceLinkError"; }
}
function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { throw new SourceLinkError(); }
}
function identifier(value: string): string {
  if (!value || [...value].length > 1024 || /[\u0000-\u001f\u007f-\u009f\\]/u.test(value)) throw new SourceLinkError();
  return value;
}
function positive(value: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new SourceLinkError();
  return number;
}
function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
export function parseSourceLink(href: string): SourceLink {
  if (utf8Length(href) > 8192 || !href.startsWith("source://")) throw new SourceLinkError();
  const hash = href.indexOf("#"), prefix = hash < 0 ? href.slice(9) : href.slice(9, hash).replace(/:$/u, "");
  if (!prefix || prefix.includes("?") || prefix.startsWith("/") || prefix.includes("//")) throw new SourceLinkError();
  const segments = prefix.replace(/\/$/u, "").split("/");
  if (segments.length > 32) throw new SourceLinkError();
  if (!SOURCE_ROOTS.includes(segments[0] as SourceRoot)) throw new SourceLinkError("找不到文件对象");
  const path: string[] = [];
  for (const segment of segments) {
    const id = identifier(decode(segment));
    if (id === ".") continue;
    if (id === "..") {
      if (path.length <= 1) throw new SourceLinkError("来源路径超出所属根目录");
      path.pop();
    } else path.push(id);
  }
  if (!path.length) throw new SourceLinkError();
  if (hash < 0) return { path };
  const fragment = decode(href.slice(hash + 1));
  function lineLocator(fragment: string): Extract<SourceLocator, {kind: "line"}> {
    const line = /^line\{(?:(\d+):)?(\d+)-(\d+):(\d+)-(\d+)\}$/u.exec(fragment);
    if (!line) throw new SourceLinkError("来源行列定位格式无效");
    const range = { startLine: positive(line[2]!), startColumn: positive(line[3]!), endLine: positive(line[4]!), endColumn: positive(line[5]!) };
    if (range.startLine > range.endLine || range.startLine === range.endLine && range.startColumn > range.endColumn) throw new SourceLinkError();
    return { kind: "line", range, ...(line[1] ? { pageNumber: positive(line[1]) } : {}) };
  }
  if (fragment.startsWith("line{")) return { path, locator: lineLocator(fragment) };
  const block = /^block\{([^{}]+)\}(?:#(line\{[^{}]+\}))?$/u.exec(fragment);
  if (block) {
    const line = block[2] ? lineLocator(block[2]) : undefined;
    if (line?.pageNumber !== undefined) throw new SourceLinkError("笔记块内行列不能带 PDF 页码");
    return { path, locator: { kind: "block", blockId: identifier(block[1]!), ...(line ? { range: line.range } : {}) } };
  }
  throw new SourceLinkError("来源定位格式无效");
}
export function formatSourceLink(link: SourceLink): string {
  const base = `source://${link.path.map(id => encodeSegment(identifier(id))).join("/")}`;
  const locator = link.locator;
  const href = !locator ? base : locator.kind === "block"
    ? `${base}:#block{${encodeSegment(locator.blockId)}}${locator.range ? `#line{${locator.range.startLine}-${locator.range.startColumn}:${locator.range.endLine}-${locator.range.endColumn}}` : ""}`
    : `${base}:#line{${locator.pageNumber === undefined ? "" : `${locator.pageNumber}:`}${locator.range.startLine}-${locator.range.startColumn}:${locator.range.endLine}-${locator.range.endColumn}}`;
  parseSourceLink(href);
  return href;
}
export interface SourceDirectoryNode<T> {
  readonly value: T;
  readonly child: (id: string) => Promise<SourceDirectoryNode<T> | undefined>;
}
/** Resolve each child under its actual parent; resource types are adapter concerns. */
export async function resolveSourcePath<T>(root: SourceDirectoryNode<T>, link: SourceLink): Promise<SourceDirectoryNode<T>> {
  let node = root;
  for (const id of link.path) {
    const child = await node.child(id);
    if (!child) throw new SourceLinkError("找不到文件对象");
    node = child;
  }
  return node;
}
