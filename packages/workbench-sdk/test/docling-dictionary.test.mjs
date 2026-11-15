import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const compiler = require.resolve("typescript/bin/tsc");

function installArtifact(name, directory) {
  const archive = path.join(directory, name + ".tgz");
  const installed = path.join(directory, "node_modules/@research-assistant", name);
  execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
    cwd: path.join(root, "packages", name), stdio: "pipe",
  });
  mkdirSync(installed, {recursive: true});
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
  return installed;
}

function withPackedConsumer(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-docling-dictionary-"));
  try {
    const installed = installArtifact("workbench-sdk", directory);
    installArtifact("core", directory);
    mkdirSync(path.join(directory, "node_modules/@types"), {recursive: true});
    symlinkSync(path.dirname(require.resolve("@types/react/package.json")), path.join(directory, "node_modules/@types/react"), "dir");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    run(directory, installed);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

function compile(directory, source, corePublic = false) {
  const input = path.join(directory, "consumer.ts");
  writeFileSync(input, source);
  const config = path.join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    ...(corePublic ? {extends: path.join(root, "tsconfig.base.json")} : {}),
    compilerOptions: {strict: true, exactOptionalPropertyTypes: true, noEmit: true,
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", listFiles: true,
      ...(corePublic ? {allowImportingTsExtensions: true} : {skipLibCheck: false})},
    files: [input, ...(corePublic ? [path.join(root, "apps/web/src/env.d.ts")] : [])],
  }));
  const result = spawnSync(process.execPath, [compiler, "-p", config, "--pretty", "false"], {
    cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split("\n");
}

test("packed Docling and dictionary leaves preserve parser, cancellation, storage-port and UI boundaries", () => {
  withPackedConsumer((directory, installed) => {
    for (const leaf of ["docling", "dictionary"]) {
      assert.doesNotMatch(readFileSync(path.join(installed, "lib", leaf + ".d.ts"), "utf8"),
        /apps\/web|core\/services|core\/features|app\/runtime|\.\.\//u);
      assert.match(readFileSync(path.join(installed, "lib", leaf + ".js"), "utf8"), /^export \{\};\s*$/u,
        "declaration-only leaves cannot run a replacement task, cache or store");
    }
    const loaded = compile(directory, `
      import {getDoclingParserGateway, doclingErrorMessage, runDoclingParse,
        type DoclingParserGateway, type DoclingOverlayItem, type DoclingPageOverlay} from "@research-assistant/workbench-sdk/docling";
      import {getWordExplanationGateway, createDictionaryGateway, DictionaryLookup,
        WordContextExplanation, getWordExplanationStore} from "@research-assistant/workbench-sdk/dictionary";
      import type * as Docling from "@research-assistant/workbench-sdk/docling";
      import type * as Dictionary from "@research-assistant/workbench-sdk/dictionary";
      import type {DictionaryGateway, WordExplanationGateway, WordExplanationRequest,
        WordExplanation, WordExplanationStore, WordExplanationDraft, StoredWordExplanation} from "@research-assistant/core/dictionary";
      const parser = getDoclingParserGateway();
      export const parserKeys: Record<keyof DoclingParserGateway, true> = {startParseTask: true, getParseTask: true,
        cancelParseTask: true, parseAttachment: true, listParseRuns: true, getParseRun: true, getPageOverlay: true};
      type Task = Awaited<ReturnType<DoclingParserGateway["getParseTask"]>>;
      export const pending: Task = {id: "synthetic-task", state: "cancelling", stage: "parsing", completedPages: 1, totalPages: 2};
      export const failed: Task = {...pending, state: "failed", parseRunId: null, error: {code: "synthetic_error", message: "Synthetic error"}};
      export const cancelled: Task = {...pending, state: "cancelled", error: null};
      export const started: Promise<Task> = parser.startParseTask("paper", "attachment", {force: false});
      export const stopping: Promise<Task> = parser.cancelParseTask("synthetic-task");
      export const background = runDoclingParse(parser, "paper", "attachment", {paperTitle: "Synthetic paper", fileName: "synthetic.pdf"}, false);
      export const message: string = doclingErrorMessage({code: "synthetic_error", message: "Synthetic error"});
      export async function overlay() {
        const value: DoclingPageOverlay = await parser.getPageOverlay("attachment", 0, "run");
        const items: readonly DoclingOverlayItem[] = value.items;
        // @ts-expect-error Overlay arrays remain immutable observations.
        items.push({id: "new", kind: "text", regions: [], rawRef: "new"});
        return value;
      }
      export async function detail() {
        const value = await parser.parseAttachment("paper", "attachment");
        const raw: unknown = value.rawResponse; void raw;
        // @ts-expect-error Original response payload stays unknown rather than any.
        const assumed: string = value.rawResponse; void assumed;
        return value;
      }
      // @ts-expect-error Task states are the original finite union.
      export const invalidState: Task = {...pending, state: "paused"};
      // @ts-expect-error Optional null and omitted are allowed; explicit undefined is not added.
      export const invalidRun: Task = {...pending, parseRunId: undefined};
      // @ts-expect-error The parser Pick cannot manage model storage.
      parser.deleteModels();
      // @ts-expect-error Parsing does not grant service lifecycle ownership.
      parser.connectService();
      // @ts-expect-error Core settings remain outside the parser port.
      parser.saveSettings({});
      // @ts-expect-error Preserve the original force boolean signature.
      runDoclingParse(parser, "paper", "attachment", {paperTitle: "Synthetic", fileName: "synthetic.pdf"}, "force");
      // @ts-expect-error Display metadata keeps both required string fields.
      runDoclingParse(parser, "paper", "attachment", {paperTitle: "Synthetic"});
      // @ts-expect-error No full service gateway getter is published.
      export type NoFullDoclingGateway = typeof Docling.getDoclingGateway;

      const dictionary: DictionaryGateway<AbortSignal> = createDictionaryGateway();
      export const injected: DictionaryGateway<AbortSignal> = createDictionaryGateway(globalThis.fetch, "/synthetic/");
      const explanation: WordExplanationGateway<AbortSignal> = getWordExplanationGateway();
      const store: WordExplanationStore = getWordExplanationStore();
      declare const context: WordExplanationRequest;
      declare const explained: WordExplanation;
      declare const draft: WordExplanationDraft;
      declare const saved: StoredWordExplanation;
      export const lookup = dictionary.lookup("synthetic", new AbortController().signal);
      export const generated: Promise<WordExplanation> = explanation.explain(context, new AbortController().signal);
      export const listed: Promise<readonly StoredWordExplanation[]> = store.list("attachment", "synthetic-sha");
      export const persisted: Promise<StoredWordExplanation> = store.save(draft);
      export const removed: Promise<void> = store.remove(saved);
      export const dictionaryView = DictionaryLookup({text: "synthetic", gateway: dictionary, context,
        explanation: explained, explanationGateway: explanation, onDeleteExplanation: async () => {}});
      export const contextView = WordContextExplanation({explanation: explained, context, gateway: explanation,
        onDelete: async () => {}, deleteDisabled: true});
      // @ts-expect-error Context remains required for the original dictionary component.
      DictionaryLookup({text: "synthetic", gateway: dictionary});
      // @ts-expect-error Existing delete callbacks are asynchronous.
      WordContextExplanation({explanation: explained, context, onDelete: () => {}});
      // @ts-expect-error The original fetch injection accepts RequestInfo/URL, not arbitrary numbers.
      createDictionaryGateway((_input: number) => Promise.resolve(new Response()));
      // @ts-expect-error No additional browser storage operations are granted by the pure store port.
      store.getItem("synthetic");
      // @ts-expect-error The browser implementation constructor remains private.
      export type NoBrowserStoreFactory = typeof Dictionary.createBrowserWordExplanationStore;
      // @ts-expect-error Shared UI cannot obtain the underlying storage owner.
      export type NoAppStorage = typeof Dictionary.getAppStorage;
      // @ts-expect-error The Core registry is not a plugin capability.
      export type NoAppRuntime = typeof Dictionary.getAppRuntime;
      // @ts-expect-error No arbitrary native transport is exposed.
      export type NoInvoke = typeof Dictionary.invoke;
    `);
    assert.ok(loaded.some(file => file.includes("@types/react/index.d.ts")));
    for (const file of loaded) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  });
});

test("packed Docling and dictionary signatures match their actual Core public values and parser DTOs in both directions", () => {
  withPackedConsumer(directory => {
    const lines = [
      'import type * as doclingSdk from "@research-assistant/workbench-sdk/docling";',
      'import type * as dictionarySdk from "@research-assistant/workbench-sdk/dictionary";',
      `import type * as doclingCore from ${JSON.stringify(path.join(root, "apps/web/src/core/public/docling.ts"))};`,
      `import type * as dictionaryCore from ${JSON.stringify(path.join(root, "apps/web/src/core/public/dictionary.ts"))};`,
    ];
    const groups = [
      ["docling", ["getDoclingParserGateway", "doclingErrorMessage", "runDoclingParse"]],
      ["dictionary", ["getWordExplanationGateway", "createDictionaryGateway", "DictionaryLookup", "WordContextExplanation", "getWordExplanationStore"]],
    ];
    for (const [module, names] of groups) for (const name of names) {
      lines.push(`declare const core_${name}: typeof ${module}Core.${name}; declare const sdk_${name}: typeof ${module}Sdk.${name};`);
      lines.push(`const toCore_${name}: typeof ${module}Core.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: typeof ${module}Sdk.${name} = core_${name}; void toSdk_${name};`);
    }
    for (const name of ["DoclingParserGateway", "DoclingOverlayRect", "DoclingOverlayItem", "DoclingPageOverlay"]) {
      lines.push(`declare const core_${name}: doclingCore.${name}; declare const sdk_${name}: doclingSdk.${name};`);
      lines.push(`const toCore_${name}: doclingCore.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: doclingSdk.${name} = core_${name}; void toSdk_${name};`);
    }
    const results = [
      ["DoclingParseTaskStatus", 'Awaited<ReturnType<doclingSdk.DoclingParserGateway["getParseTask"]>>'],
      ["DoclingParseRunSummary", 'Awaited<ReturnType<doclingSdk.DoclingParserGateway["listParseRuns"]>>[number]'],
      ["DoclingParseRunDetail", 'Awaited<ReturnType<doclingSdk.DoclingParserGateway["getParseRun"]>>'],
    ];
    for (const [name, sdk] of results) {
      lines.push(`declare const core_${name}: doclingCore.${name}; declare const sdk_${name}: ${sdk};`);
      lines.push(`const toCore_${name}: doclingCore.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: ${sdk} = core_${name}; void toSdk_${name};`);
    }
    compile(directory, lines.join("\n"), true);
  });
});
