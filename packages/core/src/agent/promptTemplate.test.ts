import { describe, expect, it } from "vitest";
import { PromptTemplate, PromptTemplateError } from "./promptTemplate";

describe("Codex strict prompt template contract", () => {
  it("reuses parsed templates with repeated, adjacent and multiline variables", () => {
    const template = PromptTemplate.parse("{{b}}{{ a }}\n{{ b }}");
    expect(template.placeholders()).toEqual(["a", "b"]);
    expect(template.render([["a", "世界"], ["b", "Hello"]])).toBe("Hello世界\nHello");
    expect(template.render([["a", ""], ["b", "Hi"]])).toBe("Hi\nHi");
  });

  it("supports literal delimiters without expanding variable contents", () => {
    const template = PromptTemplate.parse("{{{{ literal }}}}: {{ value }}");
    expect(template.render([["value", "{{ unknown }}\n</source> $&"]]))
      .toBe("{{ literal }}: {{ unknown }}\n</source> $&");
  });

  it.each([
    ["Hello, {{   }}.", "emptyPlaceholder", 7],
    ["Hello, {{ name.", "unterminatedPlaceholder", 7],
    ["Hello, {{ outer {{ inner }} }}.", "nestedPlaceholder", 7],
    ["Hello, }} world.", "unmatchedClosingDelimiter", 7],
    ["中😀{{ }}", "emptyPlaceholder", 7],
  ])("rejects malformed template %s with UTF-8 byte location", (source, kind, start) => {
    expect(() => PromptTemplate.parse(source as string)).toThrow(PromptTemplateError);
    try { PromptTemplate.parse(source as string); } catch (error) {
      expect(error).toMatchObject({ kind, start });
    }
  });

  it.each([
    [[], "missingValue", "name"],
    [[["name", "Codex"], ["unused", "extra"]], "extraValue", "unused"],
    [[["name", "Codex"], ["name", "other"]], "duplicateValue", "name"],
  ] as const)("rejects incorrect variable bindings %j", (values, kind, variableName) => {
    const template = PromptTemplate.parse("Hello, {{ name }}.");
    expect(() => template.render(values)).toThrow(PromptTemplateError);
    try { template.render(values); } catch (error) {
      expect(error).toMatchObject({ kind, variableName });
    }
  });

  it("renders static text and accepts only placeholders declared by the template", () => {
    expect(PromptTemplate.parse("plain { JSON } text").render([])).toBe("plain { JSON } text");
    expect(PromptTemplate.parse("{{\u0085name\u0085}}").render([["name", "ok"]])).toBe("ok");
  });
});
