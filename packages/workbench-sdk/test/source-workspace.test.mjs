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
function withArtifacts(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-source-workspace-"));
  try {
    for (const name of ["workbench-sdk", "core", "data"]) {
      const archive = path.join(directory, name + ".tgz"), installed = path.join(directory, "node_modules/@research-assistant", name);
      execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {cwd: path.join(root, "packages", name), stdio: "pipe"});
      mkdirSync(installed, {recursive: true});
      execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    }
    mkdirSync(path.join(directory, "node_modules/@types"), {recursive: true});
    symlinkSync(path.dirname(require.resolve("@types/react/package.json")), path.join(directory, "node_modules/@types/react"), "dir");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    run(directory);
  } finally {rmSync(directory, {recursive: true, force: true});}
}
function compile(directory, source, actualCore = false) {
  const input = path.join(directory, "consumer.ts"); writeFileSync(input, source);
  const config = path.join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({...(actualCore ? {extends: path.join(root, "tsconfig.base.json")} : {}),
    compilerOptions: {strict: true, exactOptionalPropertyTypes: true, noEmit: true, target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", types: [], listFiles: true,
      ...(actualCore ? {allowImportingTsExtensions: true, paths: {
        "@research-assistant/core/hbs": [path.join(directory, "node_modules/@research-assistant/core/src/hbs/index.ts")],
        "@research-assistant/data/hbs": [path.join(directory, "node_modules/@research-assistant/data/src/hbs/index.ts")],
      }} : {})}, files: [input, ...(actualCore ? [path.join(root, "apps/web/src/env.d.ts")] : [])]}));
  const result = spawnSync(process.execPath, [compiler, "-p", config, "--pretty", "false"], {cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.split("\n");
}

test("the packed activation host exposes only the existing finite workspace and reading contracts", () => {
  withArtifacts(directory => {
    const declaration = readFileSync(path.join(directory, "node_modules/@research-assistant/workbench-sdk/lib/activation.d.ts"), "utf8");
    assert.doesNotMatch(declaration, /apps\/web|app\/runtime|core\/features/u);
    const files = compile(directory, `
      import type {PluginWorkspaceHostProps, PluginReadingContributions, PluginViewContribution, PluginActivationContext} from "@research-assistant/workbench-sdk/activation";
      export function workspace(host: PluginWorkspaceHostProps) {
        host.onNavigateTab("pdf:synthetic"); host.onSessionsChanged(["pdf:synthetic"], "pdf:synthetic");
        host.onSourceOpened(true); host.onItemOpened();
        const tabHost: HTMLElement | null = host.tabHost;
        const item: string | undefined = host.openItemId;
        // @ts-expect-error No App runtime is passed through workspace props.
        host.runtime;
        // @ts-expect-error No arbitrary IPC port is exposed.
        host.invoke("arbitrary");
        // @ts-expect-error Existing sessions publish string identities.
        host.onSessionsChanged([1], "pdf:synthetic");
        return {tabHost, item};
      }
      export const reading: PluginReadingContributions = {ReadingActions: ({note, disabled}) => disabled ? null : note.body,
        ReadingTemplateDialog: ({initialResourceId, onClose, disabled}) => {if (!disabled) onClose(); return initialResourceId ?? null;}, requestPortraitDetail: id => {void id;}};
      export const view: PluginViewContribution = {id: "library", title: "Library", reading,
        restore: {homeTabId: "library", readActiveTabId: () => "pdf:synthetic"}, render: props => {if (props.workspace) workspace(props.workspace); return null;}};
      export function activate(context: PluginActivationContext) {return context.registerView(view);}
      // @ts-expect-error Slots are the original three contributions, not an arbitrary service registry.
      export const arbitrary: PluginReadingContributions = {invoke: () => undefined};
      // @ts-expect-error The lifecycle signal is boolean, not an opaque runtime handle.
      export const invalidDisabled: import("@research-assistant/workbench-sdk/activation").PluginReadingTemplateProps = {onClose: () => {}, disabled: "ready"};
    `);
    for (const file of files) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  });
});

test("workspace, restore and reading declarations match the actual pre-existing App and Core public types in both directions", () => {
  withArtifacts(directory => {
    compile(directory, `
      import type {PluginWorkspaceHostProps, PluginWorkspaceRestore, PluginReadingContributions, PluginReadingActionsProps} from "@research-assistant/workbench-sdk/activation";
      import type {LiteratureWorkspaceSlot, WorkbenchContribution} from ${JSON.stringify(path.join(root, "apps/web/src/app/workbenchComposition.ts"))};
      import type {WorkspaceNavigationRestore} from ${JSON.stringify(path.join(root, "apps/web/src/core/useWorkspaceNavigation.ts"))};
      import type {ReadingNoteActionsProps} from ${JSON.stringify(path.join(root, "apps/web/src/core/public/notePresentation.ts"))};
      type OriginalHost = Required<Omit<LiteratureWorkspaceSlot, "active">>;
      declare const originalHost: OriginalHost; declare const sdkHost: PluginWorkspaceHostProps;
      const acceptsSdk: OriginalHost = sdkHost; const acceptsOriginal: PluginWorkspaceHostProps = originalHost;
      declare const originalRestore: WorkspaceNavigationRestore; declare const sdkRestore: PluginWorkspaceRestore;
      const restoreSdk: WorkspaceNavigationRestore = sdkRestore; const restoreOriginal: PluginWorkspaceRestore = originalRestore;
      declare const originalReading: Pick<WorkbenchContribution, "ReadingActions" | "ReadingTemplateDialog" | "requestPortraitDetail">;
      declare const sdkReading: PluginReadingContributions;
      const readingSdk: typeof originalReading = sdkReading; const readingOriginal: PluginReadingContributions = originalReading;
      declare const originalActions: ReadingNoteActionsProps; declare const sdkActions: PluginReadingActionsProps;
      const actionsSdk: ReadingNoteActionsProps = sdkActions; const actionsOriginal: PluginReadingActionsProps = originalActions;
      void [acceptsSdk, acceptsOriginal, restoreSdk, restoreOriginal, readingSdk, readingOriginal, actionsSdk, actionsOriginal];
    `, true);
  });
});
