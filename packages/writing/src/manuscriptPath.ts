declare const manuscriptPathBrand: unique symbol;

export type ManuscriptPath = string & {
  readonly [manuscriptPathBrand]: true;
};

const MAX_PATH_LENGTH = 1024;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function parseManuscriptPath(input: string): ManuscriptPath {
  if (input.length === 0) {
    throw new Error("稿件路径不能为空");
  }
  if (input.length > MAX_PATH_LENGTH) {
    throw new Error(`稿件路径不能超过 ${MAX_PATH_LENGTH} 个字符`);
  }
  if (input.includes("\0")) {
    throw new Error("稿件路径不能包含 NUL 字符");
  }
  if (input.startsWith("/") || input.startsWith("\\") || /^[a-z]:/i.test(input)) {
    throw new Error("稿件路径必须是相对路径");
  }
  if (input.includes("\\")) {
    throw new Error("稿件路径必须使用正斜杠");
  }

  const segments = input.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new Error("稿件路径不能包含空白、`.` 或 `..` 路径段");
    }
    if (WINDOWS_RESERVED_NAME.test(segment) || /[ .]$/.test(segment)) {
      throw new Error(`稿件路径包含不受支持的名称：${segment}`);
    }
  }

  return input as ManuscriptPath;
}

export function parentManuscriptPath(path: ManuscriptPath): ManuscriptPath | null {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? null : (path.slice(0, separator) as ManuscriptPath);
}
