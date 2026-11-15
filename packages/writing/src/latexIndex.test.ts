import { describe, expect, it } from "vitest";

import { findLatexCompletionContext, indexLatexSource } from "./latexIndex";

describe("LaTeX source indexing", () => {
  it("indexes visible sections and labels without treating comments as structure", () => {
    const source = [
      "\\section{Introduction}\\label{sec:intro}",
      "% \\section{Hidden}\\label{hidden}",
      "\\subsection*{Prior work}",
      "escaped \\% \\label{sec:visible}",
    ].join("\n");
    const index = indexLatexSource(source);

    expect(index.outline.map((entry) => [entry.title, entry.line, entry.depth])).toEqual([
      ["Introduction", 1, 2],
      ["Prior work", 3, 3],
    ]);
    expect(index.labels).toEqual(["sec:intro", "sec:visible"]);
  });

  it("classifies completion contexts and preserves replacement offsets", () => {
    const cases = [
      ["\\sec", "command", "sec"],
      ["\\begin{ite", "environment", "ite"],
      ["\\ref{sec:i", "label", "sec:i"],
      ["\\cite{smith, wang", "citation", "wang"],
      ["\\includegraphics[width=1cm]{figures/pl", "file", "figures/pl"],
    ] as const;
    for (const [source, kind, prefix] of cases) {
      expect(findLatexCompletionContext(source, source.length)).toEqual({
        kind,
        prefix,
        from: source.length - prefix.length,
      });
    }
  });
});
