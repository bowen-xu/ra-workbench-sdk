export class AgentWorkspaceDecodeError extends Error {
  constructor() { super("Invalid execution workspace response"); }
}
export function row(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentWorkspaceDecodeError();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) throw new AgentWorkspaceDecodeError();
  return result;
}
export function id(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) || /^0{8}(-0{4}){3}-0{12}$/.test(value)) throw new AgentWorkspaceDecodeError();
  return value.toLowerCase();
}
export function validPath(path: string): boolean {
  const parts = path.split("/");
  const bytes = utf8Length(path);
  return !!path && bytes <= 1024 && parts.length <= 64
    && !/[\\:*?"<>|\u0000-\u001f\u007f-\u009f]/.test(path)
    && parts.every((part) => !!part && part !== "." && part !== ".." && !/[ .]$/.test(part)
      && part.toLowerCase() !== ".git" && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point >= 0xd800 && point <= 0xdfff) throw new AgentWorkspaceDecodeError();
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
