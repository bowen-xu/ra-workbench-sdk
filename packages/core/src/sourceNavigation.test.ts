import addresses from "../../../tests/fixtures/source-addresses.json";
import { expect, it, vi } from "vitest";
import { formatSourceLink, parseSourceLink, resolveSourcePath, sourcePath, type SourceDirectoryNode } from "./sourceNavigation";

it("normalizes paths inside a namespace and preserves exact encoded identities", () => {
  expect(parseSourceLink("source://library/paper/./a/../file").path).toEqual(["library", "paper", "file"]);
  expect(sourcePath("writings", "project", "引言.tex")).toBe("source://writings/project/%E5%BC%95%E8%A8%80.tex");
  const link = {path: ["writings", "project", "sections/引言.tex"], locator: {kind: "line" as const, range: {startLine: 2, startColumn: 3, endLine: 4, endColumn: 8}}};
  expect(parseSourceLink(formatSourceLink(link))).toEqual(link);
  expect(sourcePath("writings", "project", "a)b!.tex")).toBe("source://writings/project/a%29b%21.tex");
});
it.each(["source://paper", "source://system/structured-task", "source://library/../notes/id", "source://notes/%2E%2E/library/id", "source:///notes/id", "source://notes//id", "source://notes/%00", "source://notes/%zz", "source://notes/id?x=y", "file:///tmp/a"])("rejects old addresses and invalid namespace paths %s", href => {
  expect(() => parseSourceLink(href)).toThrow();
});
it("resolves each exact child without inferring a type from its ID", async () => {
  const note: SourceDirectoryNode<string> = {value: "note", child: vi.fn(async () => undefined)};
  const notes: SourceDirectoryNode<string> = {value: "notes", child: vi.fn(async id => id === "id" ? note : undefined)};
  const root: SourceDirectoryNode<string> = {value: "root", child: vi.fn(async id => id === "notes" ? notes : undefined)};
  expect(await resolveSourcePath(root, parseSourceLink("source://notes/id"))).toBe(note);
  await expect(resolveSourcePath(root, parseSourceLink("source://notes/other"))).rejects.toThrow();
});
it("preserves page, block and line locators", () => {
  const range = {startLine: 2, startColumn: 3, endLine: 4, endColumn: 5};
  for (const link of [{path: ["library", "paper", "file"], locator: {kind: "line" as const, range, pageNumber: 7}}, {path: ["notes", "note"], locator: {kind: "block" as const, blockId: "b", range}}]) {
    expect(parseSourceLink(formatSourceLink(link))).toEqual(link);
  }
  for (const fragment of ["line{0:2-1:2-2}", "block{b}#line{3:2-1:2-2}", "block{b}#line{4-1:2-1}", "line{1-1:2-2}#block{b}", "block{}", "line{1-1:9007199254740993-1}"]) {
    expect(() => parseSourceLink(`source://notes/note:#${fragment}`)).toThrow();
  }
});

it("matches the native shared namespace and encoding contract", () => {
  for (const entry of addresses.valid) expect(parseSourceLink(entry.uri).path).toEqual(entry.path);
  for (const uri of addresses.invalid) expect(() => parseSourceLink(uri)).toThrow();
});
