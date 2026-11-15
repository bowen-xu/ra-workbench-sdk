import { expect, it } from "vitest";
import { scanLatexEnvironments } from "./latexEnvironments";

it("indexes nested/repeated environments and declarations with exact source positions", () => {
  const source = "\\newenvironment{custom-box}{}{}\n\\begin{enumerate}\n\\begin{enumerate}\n\\end{enumerate}\n\\newtheorem{lemma}{Lemma}";
  const {tokens} = scanLatexEnvironments(source);
  expect(tokens.map(token => [token.kind, token.name])).toEqual([
    ["definition", "custom-box"], ["begin", "enumerate"], ["begin", "enumerate"], ["end", "enumerate"], ["definition", "lemma"],
  ]);
  for (const token of tokens) expect(source.slice(token.from, token.to)).toMatch(new RegExp(`\\{${token.name}\\}$`, "u"));
});

it("ignores commented, escaped and inline literal examples", () => {
  const source = "% \\begin{hidden}\n\\\\begin{escaped}\n\\verb|\\begin{literal}|\n\\% \\begin{visible}\n\\renewenvironment{custom}{}{}";
  const {tokens, excluded} = scanLatexEnvironments(source);
  expect(tokens.map(token => token.name)).toEqual(["visible", "custom"]);
  expect(excluded.map(range => source.slice(range.from, range.to))).toEqual(["% \\begin{hidden}", "\\verb|\\begin{literal}|"]);
});

it.each(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted"])("ignores nested-looking examples in %s", name => {
  const source = `\\begin{${name}}\n\\begin{hidden}\n\\end{${name}}\n\\begin{visible}`;
  const {tokens} = scanLatexEnvironments(source);
  expect(tokens.map(token => [token.kind, token.name])).toEqual([["begin", name], ["end", name], ["begin", "visible"]]);
});

it("keeps unfinished literal content excluded through EOF", () => {
  const source = "\\begin{verbatim}\n\\begin{hidden}";
  const {tokens, excluded} = scanLatexEnvironments(source);
  expect(tokens).toHaveLength(1);
  expect(excluded[0]?.to).toBe(source.length);
});
