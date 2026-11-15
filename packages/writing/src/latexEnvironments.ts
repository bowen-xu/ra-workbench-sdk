export interface LatexEnvironmentToken {
  readonly kind: "begin" | "end" | "definition";
  readonly name: string;
  readonly from: number;
  readonly to: number;
}
export interface LatexEnvironmentScan {
  readonly tokens: readonly LatexEnvironmentToken[];
  readonly excluded: readonly {readonly from: number; readonly to: number}[];
}

/** Lexical completion index, not a TeX interpreter. Literal examples are excluded. */
export function scanLatexEnvironments(source: string): LatexEnvironmentScan {
  const tokens: LatexEnvironmentToken[] = [], excluded: {from: number; to: number}[] = [];
  let offset = 0;
  while (offset < source.length) {
    if (source[offset] === "%") {
      const end = source.indexOf("\n", offset);
      excluded.push({from: offset, to: end < 0 ? source.length : end});
      offset = end < 0 ? source.length : end;
      continue;
    }
    if (source[offset] !== "\\") {offset++; continue;}
    const command = /^\\([A-Za-z]+)\*?/u.exec(source.slice(offset));
    if (!command) {offset += 2; continue;}
    const from = offset, name = command[1];
    offset += command[0].length;
    if (name === "verb") {
      const delimiter = source[offset];
      if (delimiter && !/\s/u.test(delimiter)) {
        const end = source.indexOf(delimiter, offset + 1);
        const newline = source.indexOf("\n", offset + 1);
        offset = end >= 0 && (newline < 0 || end < newline) ? end + 1 : newline < 0 ? source.length : newline;
        excluded.push({from, to: offset});
      }
      continue;
    }
    if (!["begin", "end", "newenvironment", "renewenvironment", "provideenvironment", "newtheorem"].includes(name ?? "")) continue;
    const argument = /^\s*\{([A-Za-z][A-Za-z0-9*@:_-]*)\}/u.exec(source.slice(offset));
    if (!argument) continue;
    offset += argument[0].length;
    const environment = argument[1]!;
    tokens.push({kind: name === "begin" || name === "end" ? name : "definition", name: environment, from, to: offset});
    if (name === "begin" && ["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted"].includes(environment)) {
      const closing = `\\end{${environment}}`, end = source.indexOf(closing, offset);
      excluded.push({from: offset, to: end < 0 ? source.length : end});
      if (end < 0) break;
      tokens.push({kind: "end", name: environment, from: end, to: end + closing.length});
      offset = end + closing.length;
    }
  }
  return {tokens, excluded};
}
