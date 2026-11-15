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
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-agent-ui-contract-"));
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

test("the packed Agent UI leaf preserves evidence, draft, Promise and button-ref boundaries", () => {
  withPackedConsumer((directory, installed) => {
    const declaration = readFileSync(path.join(installed, "lib/agentUi.d.ts"), "utf8");
    assert.doesNotMatch(declaration, /apps\/web|core\/features|app\/runtime|\.\.\//u);
    assert.match(readFileSync(path.join(installed, "lib/agentUi.js"), "utf8"), /^export \{\};\s*$/u,
      "declaration-only SDK must not run a replacement Core owner");
    const loaded = compile(directory, `
      import type {RefObject} from "react";
      import type {AgentEvidenceInput, AgentEvidenceImage} from "@research-assistant/core/agent";
      import {SelectionAskAiButton, SelectionAskAiEditor, submitEvidenceAnnotation,
        openAgentConversation, useAgentCanvasMessage, captureEvidenceImage,
        type AgentCanvasMessage, type AgentCanvasMessageOptions} from "@research-assistant/workbench-sdk/agent-ui";
      import type * as AgentUi from "@research-assistant/workbench-sdk/agent-ui";
      declare const button: RefObject<HTMLButtonElement | null>;
      declare const evidence: readonly AgentEvidenceInput[];
      declare const resources: NonNullable<AgentCanvasMessage["resources"]>;
      const send = useAgentCanvasMessage();
      export const message: AgentCanvasMessage = {text: "Synthetic evidence", resources,
        resolve: () => {}, reject: (_reason: unknown) => {}};
      export const options: AgentCanvasMessageOptions = {mode: "draft", reveal: false, evidence};
      export const draft: Promise<void> = send("", resources, options);
      export const submitted: Promise<void> = submitEvidenceAnnotation({capture: async () => evidence,
        resources, comment: "Synthetic question", intent: "send", submit: send, discard: () => {}});
      export const noResources: Promise<void> = submitEvidenceAnnotation({capture: async () => evidence,
        resources: undefined, comment: "Synthetic question", submit: send, discard: () => {}});
      export const image: Promise<AgentEvidenceImage> = captureEvidenceImage([1, 2] as const, "image/png", "Synthetic capture");
      export const navigation: Promise<void> = openAgentConversation("synthetic-conversation");
      export const trigger = SelectionAskAiButton({ref: button, disabled: true,
        onClick: event => {const target: HTMLButtonElement = event.currentTarget; void target;}});
      export const editor = SelectionAskAiEditor({title: "Selection", onCancel: () => {},
        onSubmit: async (comment, intent) => {await send(comment, resources, {mode: "draft", ...(intent === "silent" ? {reveal: false} : {})});}});
      // @ts-expect-error Draft capture never requests reveal=true through this original option.
      export const wrongReveal: AgentCanvasMessageOptions = {reveal: true};
      // @ts-expect-error The original draft option is not a send-mode discriminator.
      export const wrongMode: AgentCanvasMessageOptions = {mode: "send"};
      // @ts-expect-error Title is a required input to the original editor.
      SelectionAskAiEditor({onCancel: () => {}, onSubmit: async () => {}});
      // @ts-expect-error Editor submission preserves the original asynchronous result.
      SelectionAskAiEditor({title: "Selection", onCancel: () => {}, onSubmit: () => {}});
      // @ts-expect-error The shared control owns its accessible label and content.
      SelectionAskAiButton({children: "Other label"});
      // @ts-expect-error Ref remains the real button element type.
      SelectionAskAiButton({ref: {} as RefObject<HTMLDivElement | null>});
      // @ts-expect-error The resources property is required even when its value is undefined.
      submitEvidenceAnnotation({capture: async () => evidence, comment: "Synthetic", submit: send, discard: () => {}});
      // @ts-expect-error Submission does not accept a synchronous capture.
      submitEvidenceAnnotation({capture: () => evidence, resources, comment: "Synthetic", submit: send, discard: () => {}});
      // @ts-expect-error Raw native dispatch is not part of Agent UI.
      export type NoInvoke = typeof AgentUi.invoke;
      // @ts-expect-error Core's runtime registry is private.
      export type NoAppRuntime = typeof AgentUi.getAppRuntime;
      // @ts-expect-error Asset storage access is not granted by a shared control.
      export type NoNotesGateway = typeof AgentUi.getNotesGateway;
      // @ts-expect-error The Core canvas host and its ownership are not plugin UI.
      export type NoCanvasHost = typeof AgentUi.AgentCanvasHost;
    `);
    assert.ok(loaded.some(file => file.includes("@types/react/index.d.ts")), "actual React peer declarations are checked");
    for (const file of loaded) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  });
});

test("the actual packed Agent UI contracts match Core public signatures in both directions", () => {
  withPackedConsumer(directory => {
    const core = path.join(root, "apps/web/src/core/public/pluginAgentUi.ts");
    const values = ["SelectionAskAiButton", "SelectionAskAiEditor", "submitEvidenceAnnotation",
      "openAgentConversation", "useAgentCanvasMessage", "captureEvidenceImage"];
    const types = ["AgentCanvasMessage", "AgentCanvasMessageOptions"];
    const lines = [
      'import type * as sdk from "@research-assistant/workbench-sdk/agent-ui";',
      `import type * as core from ${JSON.stringify(core)};`,
    ];
    for (const name of [...values, ...types]) {
      const type = values.includes(name) ? "typeof " : "";
      lines.push(`declare const core_${name}: ${type}core.${name};`);
      lines.push(`declare const sdk_${name}: ${type}sdk.${name};`);
      lines.push(`const acceptsSdk_${name}: ${type}core.${name} = sdk_${name}; void acceptsSdk_${name};`);
      lines.push(`const acceptsCore_${name}: ${type}sdk.${name} = core_${name}; void acceptsCore_${name};`);
    }
    compile(directory, lines.join("\n"), true);
  });
});
