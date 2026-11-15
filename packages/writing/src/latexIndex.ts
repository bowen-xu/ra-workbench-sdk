export type LatexOutlineLevel =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "subparagraph";

export interface LatexOutlineEntry {
  readonly command: LatexOutlineLevel;
  readonly title: string;
  readonly line: number;
  readonly offset: number;
  readonly depth: number;
}

export interface LatexSourceIndex {
  readonly outline: readonly LatexOutlineEntry[];
  readonly labels: readonly string[];
}

export type LatexCompletionKind = "command" | "environment" | "label" | "citation" | "file";

export interface LatexCompletionContext {
  readonly kind: LatexCompletionKind;
  readonly from: number;
  readonly prefix: string;
}

const OUTLINE_DEPTH: Readonly<Record<LatexOutlineLevel, number>> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const OUTLINE_PATTERN = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{([^{}]*)\}/gu;
const LABEL_PATTERN = /\\label\{([^{}]+)\}/gu;

export function indexLatexSource(source: string): LatexSourceIndex {
  const outline: LatexOutlineEntry[] = [];
  const labels = new Set<string>();
  let lineStart = 0;
  let lineNumber = 1;
  for (const lineWithNewline of source.match(/.*(?:\n|$)/gu) ?? []) {
    if (lineWithNewline.length === 0) continue;
    const line = stripLatexComment(lineWithNewline.replace(/\n$/u, ""));
    for (const match of line.matchAll(OUTLINE_PATTERN)) {
      const command = match[1] as LatexOutlineLevel;
      const title = match[2]?.trim();
      if (title) {
        outline.push({
          command,
          title,
          line: lineNumber,
          offset: lineStart + (match.index ?? 0),
          depth: OUTLINE_DEPTH[command],
        });
      }
    }
    for (const match of line.matchAll(LABEL_PATTERN)) {
      const label = match[1]?.trim();
      if (label) labels.add(label);
    }
    lineStart += lineWithNewline.length;
    lineNumber += 1;
  }
  return { outline, labels: [...labels].sort() };
}

export function findLatexCompletionContext(
  source: string,
  offset: number,
): LatexCompletionContext | undefined {
  const boundedOffset = Math.min(Math.max(offset, 0), source.length);
  const before = source.slice(Math.max(0, boundedOffset - 600), boundedOffset);
  return matchArgument(before, boundedOffset, "environment", /\\(?:begin|end)\{([^{}]*)$/u)
    ?? matchArgument(before, boundedOffset, "label", /\\(?:ref|eqref|pageref|autoref|cref|Cref)\{(?:[^,{}]*,\s*)*([^,{}]*)$/u)
    ?? matchArgument(before, boundedOffset, "citation", /\\(?:cite|citep|citet|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{(?:[^,{}]*,\s*)*([^,{}]*)$/u)
    ?? matchArgument(before, boundedOffset, "file", /\\(?:input|include|includegraphics|bibliography|addbibresource)\*?(?:\[[^\]]*\])?\{([^{}]*)$/u)
    ?? matchArgument(before, boundedOffset, "command", /\\([A-Za-z@]*)$/u);
}

function matchArgument(
  before: string,
  offset: number,
  kind: LatexCompletionKind,
  pattern: RegExp,
): LatexCompletionContext | undefined {
  const match = pattern.exec(before);
  const prefix = match?.[1];
  if (prefix === undefined) return undefined;
  return { kind, prefix, from: offset - prefix.length };
}

function stripLatexComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return line.slice(0, index);
  }
  return line;
}
