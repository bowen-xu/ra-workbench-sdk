import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const compiler = require.resolve("typescript/bin/tsc");

test("packed presentation and navigation contracts preserve their real Core boundaries", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-presentation-"));
  try {
    for (const name of ["workbench-sdk", "core", "data"]) {
      const archive = path.join(temporary, name + ".tgz");
      execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
        cwd: path.join(root, "packages", name), stdio: "pipe",
      });
      const installed = path.join(temporary, "node_modules/@research-assistant", name);
      mkdirSync(installed, {recursive: true});
      execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    }
    for (const name of ["@types/react", "@ariakit/react", "@tiptap/pm", "sonner"]) {
      const destination = path.join(temporary, "node_modules", name);
      mkdirSync(path.dirname(destination), {recursive: true});
      symlinkSync(realpathSync(path.join(root, "apps/web/node_modules", name)), destination, "dir");
    }
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import {ContentTrustIndicator, ContentTrustGroupControls, CitationStyleSelect, MouseLeftShortcut} from "@research-assistant/workbench-sdk/ui";
      import {readingFieldColor, READING_FIELD_PALETTE} from "@research-assistant/workbench-sdk/structured-field-colors";
      import {openTextDocument, type TextDocumentRequest} from "@research-assistant/workbench-sdk/text-documents";
      import {LlmRoutePicker, type LlmRouteGateway} from "@research-assistant/workbench-sdk/model-route-picker";
      import {SystemDocumentDialog} from "@research-assistant/workbench-sdk/settings";
      import type {ContentTrustNode} from "@research-assistant/core/content-trust";
      import type * as UI from "@research-assistant/workbench-sdk/ui";
      declare const tree: ContentTrustNode;
      declare const gateway: LlmRouteGateway;
      export const trust = ContentTrustIndicator({status: "trusted", onActivate: undefined, size: "small"});
      export const group = ContentTrustGroupControls({tree, currentId: undefined,
        onConfirmPending: ids => {const immutable: readonly string[] = ids; void immutable;},
        onNavigate: node => {const original: ContentTrustNode = node; void original;}});
      export const citation = CitationStyleSelect({value: "nature", onChange: value => {void value;}});
      export const shortcut = MouseLeftShortcut({modifier: "⌘"});
      export const color: string = readingFieldColor("original-field", "#123abc");
      export const palette: readonly string[] = READING_FIELD_PALETTE;
      export const request: TextDocumentRequest = {id: "synthetic", path: "synthetic.md", content: "synthetic",
        reopen: {kind: "system", id: "synthetic"}, owner: "library", save: async (content, baseline) => {void content; void baseline;}};
      export const accepted: boolean = openTextDocument(request);
      export const picker = LlmRoutePicker({taskKind: "structuredReading", gateway,
        onSelection: selection => {if (selection) {const provider: string = selection.providerId; void provider;}}});
      export const documents = SystemDocumentDialog({workflow: "reading", onClose: () => {}});
      // @ts-expect-error Original trust states are a finite domain union.
      ContentTrustIndicator({status: "generated"});
      // @ts-expect-error The original citation selector does not accept an invented style.
      CitationStyleSelect({value: "custom", onChange: () => {}});
      // @ts-expect-error The shortcut glyph retains the original two modifiers.
      MouseLeftShortcut({modifier: "Ctrl"});
      // @ts-expect-error A text-tab save keeps the original asynchronous gateway boundary.
      openTextDocument({...request, save: () => {}});
      // @ts-expect-error Reopen intent never stores a save callback or arbitrary file command.
      openTextDocument({...request, reopen: {kind: "execute", command: "noop"}});
      // @ts-expect-error A route picker does not expose credential/provider setup.
      gateway.saveLlmProviderConfig({});
      // @ts-expect-error Public presentation never provides a raw native transport.
      export type NoInvoke = typeof UI.invoke;
      // @ts-expect-error The original system-document dialog only accepts its finite workflow filter.
      SystemDocumentDialog({workflow: "arbitrary", onClose: () => {}});
    `);
    const options = ["--strict", "--noEmit", "--target", "ES2022", "--lib", "ES2022,DOM,DOM.Iterable", "--module", "ESNext", "--moduleResolution", "Bundler"];
    const files = execFileSync(process.execPath, [compiler, ...options, "--listFiles", "consumer.ts"], {
      cwd: temporary, encoding: "utf8",
    });
    for (const file of files.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
    const groups = [
      ["ui", "ui", ["ContentTrustIndicator", "ContentTrustGroupControls", "CitationStyleSelect", "MouseLeftShortcut"]],
      ["structured-field-colors", "structuredFieldColors", ["readingFieldColor", "READING_FIELD_PALETTE"]],
      ["text-documents", "textEditor", ["openTextDocument"]],
      ["model-route-picker", "modelRoutePicker", ["LlmRoutePicker"]],
      ["settings", "settings", ["SystemDocumentDialog"]],
    ];
    const lines = [];
    for (const [index, [sdk, core, names]] of groups.entries()) {
      lines.push(`import type * as sdk${index} from "@research-assistant/workbench-sdk/${sdk}";`,
        `import type * as core${index} from ${JSON.stringify(path.join(root, "apps/web/src/core/public", core + ".ts"))};`);
      for (const name of names) lines.push(
        `declare const core_${name}: typeof core${index}.${name}; declare const sdk_${name}: typeof sdk${index}.${name};`,
        `const acceptsCore_${name}: typeof sdk${index}.${name} = core_${name}; void acceptsCore_${name};`,
        `const acceptsSdk_${name}: typeof core${index}.${name} = sdk_${name}; void acceptsSdk_${name};`,
      );
    }
    writeFileSync(path.join(temporary, "core-contract.ts"), lines.join("\n"));
    writeFileSync(path.join(temporary, "tsconfig.json"), JSON.stringify({
      extends: path.join(root, "tsconfig.base.json"), compilerOptions: {
        noEmit: true, jsx: "react-jsx", lib: ["ES2022", "DOM", "DOM.Iterable"], allowImportingTsExtensions: true,
      }, files: ["core-contract.ts", path.join(root, "apps/web/src/env.d.ts")],
    }));
    execFileSync(process.execPath, [compiler, "-p", "tsconfig.json", "--pretty", "false"], {cwd: temporary, stdio: "pipe"});
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});
