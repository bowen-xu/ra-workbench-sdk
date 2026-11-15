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
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-ai-concept-contract-"));
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

test("packed AI and concept declarations expose only the finite existing consumer surface", () => {
  withPackedConsumer((directory, installed) => {
    for (const leaf of ["aiAssistance", "conceptRetrieval"]) {
      assert.doesNotMatch(readFileSync(path.join(installed, "lib", leaf + ".d.ts"), "utf8"),
        /apps\/web|core\/services|core\/features|app\/runtime|\.\.\//u);
      assert.match(readFileSync(path.join(installed, "lib", leaf + ".js"), "utf8"), /^export \{\};\s*$/u,
        "the SDK must not implement an Agent or a retrieval executor");
    }
    const loaded = compile(directory, `
      import {getAiAssistanceGateway, aiAssistanceErrorMessage, type AiAssistanceGateway} from "@research-assistant/workbench-sdk/ai-assistance";
      import {PaperConceptRetrievalControl, type PendingConceptRetrieval} from "@research-assistant/workbench-sdk/concept-retrieval";
      import type * as Ai from "@research-assistant/workbench-sdk/ai-assistance";
      import type * as Retrieval from "@research-assistant/workbench-sdk/concept-retrieval";
      import type {AiRun, AiCandidate, AiTaskSpecDraft, PaperAnalysisStartDraft, PaperAnalysisWorkflow,
        ConceptRetrievalPreview, LlmModelRouteDraft} from "@research-assistant/core/ai";
      const gateway = getAiAssistanceGateway();
      export const methods: Record<keyof AiAssistanceGateway, true> = {
        getLlmConfiguration: true, fetchLlmProviderModels: true, saveLlmModelRoutes: true,
        previewTask: true, startRun: true, getRun: true, cancelRun: true, getLatestPaperPortraitRun: true,
        startPaperAnalysis: true, cancelPaperAnalysis: true, getLatestPaperAnalysisWorkflow: true,
        listCandidates: true, reviseCandidate: true, confirmOverviewFields: true, undoOverviewConfirmation: true,
        recordEvidenceInspection: true, preparePaperReadingContext: true,
        previewConceptRetrieval: true, cancelConceptRetrievalPreview: true,
      };
      declare const task: AiTaskSpecDraft;
      declare const analysis: PaperAnalysisStartDraft;
      declare const routes: readonly LlmModelRouteDraft[];
      declare const preview: ConceptRetrievalPreview;
      export const run: Promise<AiRun> = gateway.startRun(task);
      export const workflow: Promise<PaperAnalysisWorkflow> = gateway.startPaperAnalysis(analysis);
      export const candidates: Promise<readonly AiCandidate[]> = gateway.listCandidates();
      export const scoped = gateway.listCandidates(undefined, {paperId: "paper"});
      export const latest: Promise<AiRun | undefined> = gateway.getLatestPaperPortraitRun("paper");
      export const latestWorkflow: Promise<PaperAnalysisWorkflow | undefined> = gateway.getLatestPaperAnalysisWorkflow("paper");
      export const canceled: Promise<boolean> = gateway.cancelPaperAnalysis("request");
      export const retrieved: Promise<ConceptRetrievalPreview> = gateway.previewConceptRetrieval({clientRequestId: "synthetic-request", query: "synthetic"});
      export const retrievalCanceled: Promise<boolean> = gateway.cancelConceptRetrievalPreview("synthetic-request");
      // @ts-expect-error Preserve the original string query input.
      gateway.previewConceptRetrieval({clientRequestId: "synthetic-request", query: 1});
      export const models = gateway.fetchLlmProviderModels("qwen", false);
      export const savedRoutes = gateway.saveLlmModelRoutes(routes);
      export const error: string = aiAssistanceErrorMessage({code: "synthetic_failure", requestId: "synthetic-request"});
      export const pending: PendingConceptRetrieval = {text: "Synthetic query", preview, isLoading: false};
      export const control = PaperConceptRetrievalControl({checked: true, disabled: false, pending,
        onCancel: () => {}, onChange: checked => {const value: boolean = checked; void value;}, onConfirm: () => {}});
      // @ts-expect-error A latest observation still permits absence.
      export const wrongLatest: Promise<AiRun> = gateway.getLatestPaperPortraitRun("paper");
      // @ts-expect-error The original cancellation result is boolean.
      export const wrongCancel: Promise<void> = gateway.cancelRun("run");
      // @ts-expect-error Preserve the original optional project ID and paper scope types.
      gateway.listCandidates(undefined, {paperId: 1});
      // @ts-expect-error Do not add provider credential updates to this consumer port.
      gateway.setCredential({providerId: "deepseek", apiKey: "synthetic"});
      // @ts-expect-error Login is owned by Core settings.
      gateway.startChatGptLogin();
      // @ts-expect-error Provider setup is not route selection.
      gateway.saveLlmProviderConfig({providerId: "qwen", enabled: true, baseUrl: "synthetic", timeoutMs: 1});
      // @ts-expect-error The raw wide service transport is private.
      export type NoTransport = typeof Ai.getAiAssistanceTransport;
      // @ts-expect-error A finite getter does not return the runtime registry.
      export type NoRuntime = typeof Ai.getAppRuntime;
      // @ts-expect-error Credentials are not exposed in the existing route configuration DTO.
      export async function noCredential() {return (await gateway.getLlmConfiguration()).providers[0]?.apiKey;}
      // @ts-expect-error This pure presentation does not grant retrieval execution.
      export type NoPreview = typeof Retrieval.previewConceptRetrieval;
      // @ts-expect-error Concept selection still requires a boolean callback.
      PaperConceptRetrievalControl({checked: true, disabled: false, onCancel: () => {}, onChange: (_value: string) => {}, onConfirm: () => {}});
      // @ts-expect-error Original loading state is required.
      export const invalidPending: PendingConceptRetrieval = {text: "Synthetic query"};
    `);
    assert.ok(loaded.some(file => file.includes("@types/react/index.d.ts")));
    for (const file of loaded) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  });
});

test("packed finite AI and concept signatures match the actual Core public ports in both directions", () => {
  withPackedConsumer(directory => {
    const lines = [
      'import type * as aiSdk from "@research-assistant/workbench-sdk/ai-assistance";',
      'import type * as retrievalSdk from "@research-assistant/workbench-sdk/concept-retrieval";',
      `import type * as aiCore from ${JSON.stringify(path.join(root, "apps/web/src/core/public/pluginAiAssistance.ts"))};`,
      `import type * as retrievalCore from ${JSON.stringify(path.join(root, "apps/web/src/core/public/conceptRetrieval.ts"))};`,
    ];
    for (const name of ["getAiAssistanceGateway", "aiAssistanceErrorMessage"]) {
      lines.push(`declare const core_${name}: typeof aiCore.${name}; declare const sdk_${name}: typeof aiSdk.${name};`);
      lines.push(`const toCore_${name}: typeof aiCore.${name} = sdk_${name}; void toCore_${name};`);
      lines.push(`const toSdk_${name}: typeof aiSdk.${name} = core_${name}; void toSdk_${name};`);
    }
    lines.push('declare const coreGateway: aiCore.AiAssistanceGateway; declare const sdkGateway: aiSdk.AiAssistanceGateway;');
    lines.push('const toCoreGateway: aiCore.AiAssistanceGateway = sdkGateway; void toCoreGateway;');
    lines.push('const toSdkGateway: aiSdk.AiAssistanceGateway = coreGateway; void toSdkGateway;');
    lines.push('declare const coreControl: typeof retrievalCore.PaperConceptRetrievalControl; declare const sdkControl: typeof retrievalSdk.PaperConceptRetrievalControl;');
    lines.push('const toCoreControl: typeof retrievalCore.PaperConceptRetrievalControl = sdkControl; void toCoreControl;');
    lines.push('const toSdkControl: typeof retrievalSdk.PaperConceptRetrievalControl = coreControl; void toSdkControl;');
    lines.push('declare const corePending: retrievalCore.PendingConceptRetrieval; declare const sdkPending: retrievalSdk.PendingConceptRetrieval;');
    lines.push('const toCorePending: retrievalCore.PendingConceptRetrieval = sdkPending; void toCorePending;');
    lines.push('const toSdkPending: retrievalSdk.PendingConceptRetrieval = corePending; void toSdkPending;');
    compile(directory, lines.join("\n"), true);
  });
});
