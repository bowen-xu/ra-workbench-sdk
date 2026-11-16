import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps reusable HBS independent of the experiment and runtime/editor frameworks", () => {
  for (const name of readdirSync("packages/core/src/hbs", { recursive: true }).filter(name => typeof name === "string" && name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
    const source = readFileSync(`packages/core/src/hbs/${name}`, "utf8");
    expect(source).not.toMatch(/from ["'][^"']*(?:experiments|@codemirror|react|tauri|node:)/u);
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, "");
    expect(code).not.toMatch(/\b(?:window|document|localStorage)\s*\.|crypto\.randomUUID/u);
  }
  for (const name of readdirSync("packages/data/src/hbs").filter(name => !name.includes(".test."))) {
    expect(readFileSync(`packages/data/src/hbs/${name}`, "utf8")).not.toMatch(/from ["'][^"']*experiments/u);
  }
});

it("prevents business hosts from importing the frozen experiment", () => {
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== "experiments") visit(path); }
      else if (/\.tsx?$/u.test(entry.name) && !entry.name.includes(".test.")) {
        expect(readFileSync(path, "utf8"), path).not.toMatch(/(?:from\s*|import\s*\()\s*["'][^"']*(?:experiments\/sync-model|references\/projects\/bowen-xu-hbs-sync-model)/u);
      }
    }
  };
  visit("packages/core/src"); visit("packages/data/src");
});
