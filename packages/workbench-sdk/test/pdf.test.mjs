import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const ts = require("typescript");
const compiler = require.resolve("typescript/bin/tsc");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

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
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-pdf-contract-"));
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

function compile(directory, source, corePublic = false, extension = "ts") {
  const input = path.join(directory, "consumer." + extension);
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

function assertArtifactOnly(loaded) {
  assert.ok(loaded.some(file => file.includes("@types/react/index.d.ts")));
  for (const file of loaded) {
    assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
    assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    assert.doesNotMatch(file, /pdfjs-dist/u, "declarations must not load the renderer or worker");
  }
}

test("the packed PDF declarations preserve lifecycle, callback, ref and geometry boundaries", () => {
  withPackedConsumer((directory, installed) => {
    for (const leaf of ["pdf", "pdfGeometry"]) {
      assert.doesNotMatch(readFileSync(path.join(installed, "lib", leaf + ".d.ts"), "utf8"),
        /apps\/web|core\/components|app\/runtime|pdfjs-dist|\.\.\//u);
      assert.match(readFileSync(path.join(installed, "lib", leaf + ".js"), "utf8"), /^export \{\};\s*$/u,
        "SDK declares the original Core values; it cannot create a renderer");
    }
    const loaded = compile(directory, `
      import type {RefObject} from "react";
      import {PdfViewAdapter, PdfViewController, PdfView, PdfPageControls, PDF_BACKGROUND_SUSPEND_MS,
        usePdfThumbnailCacheWindow, type PdfViewAdapterCallbacks} from "@research-assistant/workbench-sdk/pdf";
      import type * as Pdf from "@research-assistant/workbench-sdk/pdf";
      import {positionPdfSelectionPopover, clampPdfPageIndex, parsePdfPageInput,
        type PdfSelectionPopoverPosition} from "@research-assistant/workbench-sdk/pdf-geometry";
      declare const container: HTMLDivElement;
      declare const containerRef: RefObject<HTMLDivElement | null>;
      declare const inputRef: RefObject<HTMLInputElement | null>;
      const adapter = new PdfViewAdapter();
      const controller = new PdfViewController(adapter, PDF_BACKGROUND_SUSPEND_MS);
      export const callbacks: PdfViewAdapterCallbacks = {
        onReady: event => {const count: number = event.pageCount; void count;}, onPageChange: () => {},
        onScaleChange: () => {}, onViewAreaChange: () => {}, onPageHostsChange: () => {},
        onFindMatchesChange: () => {}, onOutlineChange: () => {},
        onCharacterSelectionAvailabilityChange: () => {}, onResourceChange: () => {}, onStatus: () => {},
      };
      export const opening: Promise<void> = adapter.open({bytes: new Uint8Array(), container,
        viewerElement: container, callbacks});
      export const viewerOpening: Promise<void> = controller.open({source: {key: "synthetic", revision: "one", bytes: new Uint8Array()},
        container, viewerElement: container, active: true});
      export const unsubscribe: () => void = controller.subscribe(() => {});
      export const copied: Promise<boolean> = controller.copySelection();
      export const region: Promise<string> = adapter.renderPageRegionPng(0, {x: 0, y: 0, width: 1, height: 1}, new AbortController().signal);
      export const surface = PdfView({controller, containerRef, viewerRef: containerRef, ready: true, active: true,
        characterSelectionAvailable: false, pageHosts: [], documentVersion: "one", selection: null});
      export const pages = PdfPageControls({pageIndex: 0, pageCount: 1, value: "1", inputRef,
        onChange: () => {}, onCommit: () => {}, onPrevious: () => {}, onNext: () => {}});
      export const retained: ReadonlySet<number> = usePdfThumbnailCacheWindow({listRef: containerRef,
        pageCount: 1, currentPageNumber: 1, renderingEnabled: true});
      export const position: PdfSelectionPopoverPosition = positionPdfSelectionPopover({
        anchor: {left: 0, top: 0, right: 10, bottom: 10}, boundary: {left: 0, top: 0, right: 500, bottom: 500},
        popup: {width: 100, height: 50}, centerOnAnchor: true});
      export const page: number = clampPdfPageIndex(2, 3);
      export const label: number | undefined = parsePdfPageInput("ii", 3, ["i", "ii", "1"]);
      // @ts-expect-error Open requires its original complete callback contract.
      adapter.open({bytes: new Uint8Array(), container, viewerElement: container, callbacks: {}});
      // @ts-expect-error Document source bytes are not an arbitrary number array.
      controller.open({source: {key: "synthetic", revision: "one", bytes: [1]}, container, viewerElement: container, active: true});
      // @ts-expect-error The existing public adapter owner is readonly.
      controller.adapter = adapter;
      // @ts-expect-error A textarea ref cannot replace the page-number input.
      PdfPageControls({pageIndex: 0, pageCount: 1, value: "1", inputRef: {} as RefObject<HTMLTextAreaElement | null>, onChange: () => {}, onCommit: () => {}, onPrevious: () => {}, onNext: () => {}});
      // @ts-expect-error A top-level lifecycle Promise is not an untyped success flag.
      export const wrongResult: boolean = controller.open({source: {key: "synthetic", revision: "one", bytes: new Uint8Array()}, container, viewerElement: container, active: true});
      // @ts-expect-error Page count is required by the original geometry function.
      parsePdfPageInput("1");
      // @ts-expect-error The original geometry discriminant is unchanged.
      export const wrongPlacement: PdfSelectionPopoverPosition = {left: 0, top: 0, placement: "auto"};
      // @ts-expect-error Character stores remain type-only and owned by the adapter.
      export const noNewStore = new Pdf.PdfPageCharacterStore();
      // @ts-expect-error The PDF SDK does not publish the underlying PDF.js factory.
      export type NoGetDocument = typeof Pdf.getDocument;
      export type ViewControls = typeof Pdf.PdfViewControls;
      // @ts-expect-error PDF rendering does not grant raw native transport.
      export type NoInvoke = typeof Pdf.invoke;
    `);
    assertArtifactOnly(loaded);
  });
});

test("PDF contracts match the explicitly projected Core public members, not private class identity", () => {
  withPackedConsumer(directory => {
    const core = path.join(root, "apps/web/src/core/public/pdf.ts");
    const geometry = path.join(root, "apps/web/src/core/public/pdfGeometry.ts");
    const lines = [
      'import type * as sdk from "@research-assistant/workbench-sdk/pdf";',
      'import type * as geometrySdk from "@research-assistant/workbench-sdk/pdf-geometry";',
      `import type * as core from ${JSON.stringify(core)};`,
      `import type * as geometryCore from ${JSON.stringify(geometry)};`,
      'type CoreCharacterStore = Pick<core.PdfPageCharacterStore, keyof core.PdfPageCharacterStore>;',
      'type CoreAdapter = Omit<core.PdfViewAdapter, "characterStore"> & {readonly characterStore: CoreCharacterStore};',
      'type CoreController = Omit<core.PdfViewController, "adapter"> & {readonly adapter: CoreAdapter};',
      'type CoreViewProps = Omit<Parameters<typeof core.PdfView>[0], "controller"> & {readonly controller: CoreController};',
      'type CoreView = (props: CoreViewProps) => ReturnType<typeof core.PdfView>;',
      'declare const coreStore: CoreCharacterStore; declare const sdkStore: sdk.PdfPageCharacterStore;',
      'const storeToCore: CoreCharacterStore = sdkStore; void storeToCore;',
      'const storeToSdk: sdk.PdfPageCharacterStore = coreStore; void storeToSdk;',
      'declare const coreAdapter: CoreAdapter; declare const sdkAdapter: sdk.PdfViewAdapter;',
      'const adapterToCore: CoreAdapter = sdkAdapter; void adapterToCore;',
      'const adapterToSdk: sdk.PdfViewAdapter = coreAdapter; void adapterToSdk;',
      'declare const coreController: CoreController; declare const sdkController: sdk.PdfViewController;',
      'const controllerToCore: CoreController = sdkController; void controllerToCore;',
      'const controllerToSdk: sdk.PdfViewController = coreController; void controllerToSdk;',
      'declare const coreView: CoreView; declare const sdkView: typeof sdk.PdfView;',
      'const viewToCore: CoreView = sdkView; void viewToCore;',
      'const viewToSdk: typeof sdk.PdfView = coreView; void viewToSdk;',
      // Constructor parameters have their original optionality. Nested class
      // parameters/results use the explicit public projections above.
      'const coreEmptyArgs: ConstructorParameters<typeof core.PdfViewController> = []; void coreEmptyArgs;',
      'const sdkEmptyArgs: ConstructorParameters<typeof sdk.PdfViewController> = []; void sdkEmptyArgs;',
      'declare const coreDelay: Pick<ConstructorParameters<typeof core.PdfViewController>, "1">;',
      'declare const sdkDelay: Pick<ConstructorParameters<typeof sdk.PdfViewController>, "1">;',
      'const delayToCore: typeof coreDelay = sdkDelay; void delayToCore;',
      'const delayToSdk: typeof sdkDelay = coreDelay; void delayToSdk;',
      'declare const coreAdapterArgs: ConstructorParameters<typeof core.PdfViewAdapter>;',
      'declare const sdkAdapterArgs: ConstructorParameters<typeof sdk.PdfViewAdapter>;',
      'const argsToCore: typeof coreAdapterArgs = sdkAdapterArgs; void argsToCore;',
      'const argsToSdk: typeof sdkAdapterArgs = coreAdapterArgs; void argsToSdk;',
      'declare const sdkControllerConstructor: typeof sdk.PdfViewController;',
      'declare const sdkAdapterConstructor: typeof sdk.PdfViewAdapter;',
      'const controllerPrototype: CoreController = sdkControllerConstructor.prototype; void controllerPrototype;',
      'const adapterPrototype: CoreAdapter = sdkAdapterConstructor.prototype; void adapterPrototype;',
    ];
    for (const name of ["PdfPageControls", "usePdfThumbnailCacheWindow", "PDF_BACKGROUND_SUSPEND_MS"]) {
      lines.push(`declare const core_${name}: typeof core.${name}; declare const sdk_${name}: typeof sdk.${name};`);
      lines.push(`const toCore_${name}: typeof core.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: typeof sdk.${name} = core_${name}; void toSdk_${name};`);
    }
    for (const name of ["PdfPageHost", "PdfOutlineEntry", "PdfResourceSnapshot", "PdfFindOptions", "PdfViewAdapterCallbacks"]) {
      lines.push(`declare const core_${name}: core.${name}; declare const sdk_${name}: sdk.${name};`);
      lines.push(`const toCore_${name}: core.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: sdk.${name} = core_${name}; void toSdk_${name};`);
    }
    for (const name of ["positionPdfSelectionPopover", "clampPdfPageIndex", "parsePdfPageInput"]) {
      lines.push(`declare const core_${name}: typeof geometryCore.${name}; declare const sdk_${name}: typeof geometrySdk.${name};`);
      lines.push(`const toCore_${name}: typeof geometryCore.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: typeof geometrySdk.${name} = core_${name}; void toSdk_${name};`);
    }
    compile(directory, lines.join("\n"), true);
  });
});

test("the original literature session and its construction, subscription and required view props compile against packed PDF ports", () => {
  withPackedConsumer((directory, installed) => {
    const prefix = "plugins/literature_library/src/";
    const sessionPath = prefix + "features/reader/session/ReaderSessionController.ts";
    const session = readFileSync(path.join(root, sessionPath), "utf8");
    const publicPdf = "@research-assistant/workbench-sdk/pdf";
    assert.equal(session.split(publicPdf).length - 1, 4, "the canonical source retains the four frozen public PDF imports");
    const stagedSession = session;
    const staging = path.join(directory, "literature");
    const target = path.join(staging, "features/reader/session/ReaderSessionController.ts");
    mkdirSync(path.dirname(target), {recursive: true});
    writeFileSync(target, stagedSession);
    const thumbnailPath = prefix + "components/PdfPageThumbnail.tsx";
    const thumbnail = readFileSync(path.join(root, thumbnailPath), "utf8");
    const sourceInterface = thumbnail.match(/export interface PdfThumbnailSource \{[\s\S]*?\n\}/u)?.[0];
    assert.ok(sourceInterface);
    mkdirSync(path.join(staging, "components"), {recursive: true});
    writeFileSync(path.join(staging, "components/PdfPageThumbnail.tsx"), sourceInterface + "\n");

    const readerPath = prefix + "components/PdfReader.tsx";
    const reader = readFileSync(path.join(root, readerPath), "utf8");
    const readerAst = ts.createSourceFile(readerPath, reader, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declarations = new Map();
    const collect = node => {
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && ["adapter", "controller", "reader"].includes(declaration.name.text)) {
          assert.ok(!declarations.has(declaration.name.text));
          declarations.set(declaration.name.text, node.getText(readerAst));
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(readerAst);
    assert.equal(declarations.size, 3);
    const viewPath = prefix + "features/reader/ReaderWorkspaceView.tsx";
    const view = readFileSync(path.join(root, viewPath), "utf8");
    const viewAst = ts.createSourceFile(viewPath, view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const attributes = [];
    const required = ["controller", "containerRef", "viewerRef", "ready", "active", "characterSelectionAvailable", "pageHosts", "documentVersion"];
    const collectView = node => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(viewAst) === "PdfView") {
        for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute) && required.includes(attribute.name.getText(viewAst))) {
          attributes.push(attribute.getText(viewAst));
        }
      }
      ts.forEachChild(node, collectView);
    };
    collectView(viewAst);
    assert.equal(attributes.length, required.length);
    const source = `
      import {useMemo, useSyncExternalStore, type RefObject} from "react";
      import type {ReaderViewStateV2} from "@research-assistant/core/reader";
      import {PdfViewAdapter, PdfView} from "@research-assistant/workbench-sdk/pdf";
      import {ReaderSessionController} from "./literature/features/reader/session/ReaderSessionController";
      declare const item: {readonly id: string}; declare const attachment: {readonly id: string};
      declare const gateway: {saveReadingState: (paperId: string, attachmentId: string, state: ReaderViewStateV2) => Promise<void>};
      declare const viewerContainerRef: RefObject<HTMLDivElement | null>;
      declare const viewerElementRef: RefObject<HTMLDivElement | null>;
      declare const active: boolean; declare const documentVersion: string;
      export function realConsumerTypecheck() {
        ${[...declarations.values()].join("\n")}
        const surface = <PdfView ${attributes.join("\n")} />;
        return {adapter, controller, reader, surface};
      }
    `;
    const loaded = compile(directory, source, false, "tsx");
    assertArtifactOnly(loaded);
    const receiptRoot = path.join(root, ".tmp/runtime-plugins");
    const evidenceRoot = path.join(receiptRoot, "c02-pdf-consumer-contracts");
    mkdirSync(evidenceRoot, {recursive: true});
    const evidenceDirectory = mkdtempSync(path.join(evidenceRoot, "run-"));
    const evidencePath = path.join(evidenceDirectory, "receipt.json");
    const sourceRecord = (file, bytes) => ({path: file, bytes: Buffer.byteLength(bytes), sha256: sha(bytes)});
    const receipt = JSON.stringify({
      status: "passed-real-LF-consumer-typecheck-only", recordedAt: new Date().toISOString(),
      evidencePath: path.relative(root, evidencePath),
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {cwd: root, encoding: "utf8"}).trim(),
      scope: "Temporary typecheck fixture copies canonical production source with existing public SDK imports; this test does not prove a complete independent plugin build or PDF runtime acceptance.",
      session: {...sourceRecord(sessionPath, session), lines: session.trimEnd().split("\n").length,
        publicImports: {module: publicPdf, occurrences: 4, stagedBytesUnchanged: true}, stagedSha256: sha(stagedSession)},
      thumbnailType: {...sourceRecord(thumbnailPath, sourceInterface), lines: sourceInterface.split("\n").length,
        entireSourceSha256: sha(thumbnail)},
      constructionAndSubscription: {source: sourceRecord(readerPath, reader), statements: [...declarations].map(([name, bytes]) => ({name, bytes, sha256: sha(bytes)}))},
      view: {source: sourceRecord(viewPath, view), requiredAttributeBytes: attributes, sha256: sha(attributes.join("\n"))},
      packedDeclarations: ["pdf.d.ts", "pdfGeometry.d.ts"].map(file => sourceRecord("lib/" + file, readFileSync(path.join(installed, "lib", file)))),
      loadedAppSources: 0, loadedPdfJsSources: 0, executedFixture: false,
    }, null, 2) + "\n";
    writeFileSync(evidencePath, receipt, {flag: "wx"});
    writeFileSync(path.join(receiptRoot, "c02-pdf-consumer-contract.json"), receipt);
  });
});
