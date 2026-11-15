// Adapted from OpenAI Codex codex-rs/utils/template/src/lib.rs at
// e363b08c9175ac1cbe5893615dd2cb9ddf95043b (Apache-2.0).
// Copyright 2025 OpenAI. See packages/agent-core/third-party/codex/LICENSE and NOTICE.
// TypeScript adapter: throws typed errors instead of returning Rust Result.

type Segment = { readonly kind: "literal" | "placeholder"; readonly text: string };
type ParseErrorKind = "emptyPlaceholder" | "nestedPlaceholder" | "unmatchedClosingDelimiter" | "unterminatedPlaceholder";
type RenderErrorKind = "duplicateValue" | "extraValue" | "missingValue";

export class PromptTemplateError extends Error {
  constructor(
    readonly kind: ParseErrorKind | RenderErrorKind,
    readonly start?: number,
    readonly variableName?: string,
  ) {
    super(variableName === undefined ? `prompt template ${kind} at byte ${start}` : `prompt template ${kind}: ${variableName}`);
    this.name = "PromptTemplateError";
  }
}

/** Strict, reusable text interpolation. Values are inserted literally, never re-parsed or escaped. */
export class PromptTemplate {
  private constructor(private readonly segments: readonly Segment[], private readonly names: readonly string[]) {}

  static parse(source: string): PromptTemplate {
    const segments: Segment[] = [];
    const names = new Set<string>();
    let cursor = 0;
    let literalStart = 0;
    function fail(kind: ParseErrorKind, start: number): never {
      throw new PromptTemplateError(kind, utf8Offset(source, start));
    }
    while (cursor < source.length) {
      if (source.startsWith("{{{{", cursor) || source.startsWith("}}}}", cursor)) {
        segments.push({ kind: "literal", text: source.slice(literalStart, cursor) + source.slice(cursor, cursor + 2) });
        cursor += 4;
        literalStart = cursor;
      } else if (source.startsWith("{{", cursor)) {
        segments.push({ kind: "literal", text: source.slice(literalStart, cursor) });
        const start = cursor;
        const nameStart = cursor + 2;
        cursor = nameStart;
        while (cursor < source.length && !source.startsWith("}}", cursor)) {
          if (source.startsWith("{{", cursor)) fail("nestedPlaceholder", start);
          cursor += 1;
        }
        if (cursor === source.length) fail("unterminatedPlaceholder", start);
        const name = source.slice(nameStart, cursor).replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
        if (name.length === 0) fail("emptyPlaceholder", start);
        names.add(name);
        segments.push({ kind: "placeholder", text: name });
        cursor += 2;
        literalStart = cursor;
      } else if (source.startsWith("}}", cursor)) {
        fail("unmatchedClosingDelimiter", cursor);
      } else {
        cursor += 1;
      }
    }
    segments.push({ kind: "literal", text: source.slice(literalStart) });
    return new PromptTemplate(segments, [...names].sort());
  }

  placeholders(): readonly string[] {
    return [...this.names];
  }

  render(variables: Iterable<readonly [string, string]>): string {
    const values = new Map<string, string>();
    for (const [name, value] of variables) {
      if (values.has(name)) throw new PromptTemplateError("duplicateValue", undefined, name);
      values.set(name, value);
    }
    for (const name of this.names) {
      if (!values.has(name)) throw new PromptTemplateError("missingValue", undefined, name);
    }
    for (const name of [...values.keys()].sort()) {
      if (!this.names.includes(name)) throw new PromptTemplateError("extraValue", undefined, name);
    }
    return this.segments.map(segment => {
      if (segment.kind === "literal") return segment.text;
      const value = values.get(segment.text);
      if (value === undefined) throw new PromptTemplateError("missingValue", undefined, segment.text);
      return value;
    }).join("");
  }
}

// Keep diagnostic locations compatible with Rust byte offsets, including non-ASCII text.
function utf8Offset(source: string, end: number): number {
  let bytes = 0;
  for (const char of source.slice(0, end)) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
