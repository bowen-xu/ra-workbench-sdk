import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const compiler = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

function installArtifact(name, temporary) {
  const archive = path.join(temporary, `${name}.tgz`);
  const source = fileURLToPath(new URL(`../../${name}/`, import.meta.url));
  execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {cwd: source, stdio: "pipe"});
  const installed = path.join(temporary, "node_modules/@research-assistant", name);
  mkdirSync(installed, {recursive: true});
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
  return installed;
}

test("a consumer compiles and runs using only the packed SDK, outside the repository", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-sdk-"));
  try {
    const installed = installArtifact("workbench-sdk", temporary);
    assert.ok(!readdirSync(installed).includes("src"), "package must not expose application or SDK source");
    for (const file of readdirSync(path.join(installed, "lib"))) {
      assert.doesNotMatch(readFileSync(path.join(installed, "lib", file), "utf8"), /apps\/web|core\/features|app\/runtime|\.\.\/\.\.\//u);
    }
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    // Compile the actual production declaration unchanged, rather than an
    // independent hand-written imitation of its dependency contract.
    writeFileSync(path.join(temporary, "note-manifest.ts"), readFileSync(new URL("../../../plugins/note_manager/src/public/manifest.ts", import.meta.url)));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import {decodePluginManifest, assertPluginCompatibility, WORKBENCH_UI_RUNTIME, type BuiltinPluginManifest} from "@research-assistant/workbench-sdk";
      import {resolveBuiltinPlugins} from "@research-assistant/workbench-sdk/composition";
      import type {ConfigurationSetting, PluginConfiguration} from "@research-assistant/workbench-sdk/configuration";
      import {noteManagerManifest} from "./note-manifest.js";
      const setting: ConfigurationSetting<boolean> = {key: "explorerOpen", defaultValue: false,
        schema: {type: "boolean"}, scopes: ["application"], effect: "immediate"};
      function readPreference(configuration: PluginConfiguration): boolean {return configuration.get<boolean>(setting.key);}
      void readPreference;
      const manifest = decodePluginManifest({...noteManagerManifest, formatVersion: 1, version: "1.0.0",
        entry: "entry.js", styles: [], uiRuntime: WORKBENCH_UI_RUNTIME});
      const declaration: BuiltinPluginManifest = manifest;
      assertPluginCompatibility(manifest);
      const coreCapabilities = noteManagerManifest.consumes.required.map(({id, version}) => ({id, version}));
      if (resolveBuiltinPlugins([declaration], [declaration.id], coreCapabilities).activationOrder[0]?.id !== declaration.id) throw new Error("binding failed");
    `);
    execFileSync(process.execPath, [compiler, "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.ts"], {cwd: temporary, stdio: "pipe"});
    execFileSync(process.execPath, ["consumer.js"], {cwd: temporary, stdio: "pipe"});
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});

test("note resource and document declarations use only SDK artifacts and public domain packages", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-resource-contract-"));
  try {
    for (const name of ["workbench-sdk", "core", "data"]) installArtifact(name, temporary);
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import type {NoteResourceAccess, NoteHistoryCommand, NoteAnnotationAccess, LiteratureNoteAccess} from "@research-assistant/workbench-sdk/note-resources";
      import type {NoteSaveCoordinator, NoteOpenFailure} from "@research-assistant/workbench-sdk/note-documents";
      import {open, type OpenDialogOptions} from "@research-assistant/workbench-sdk/platform";
      import {useOverlayTarget, type OverlayPortalProps} from "@research-assistant/workbench-sdk/overlay";
      import {useNotificationState} from "@research-assistant/workbench-sdk/feedback";
      import {usePublishWorkspaceTabs, type WorkspaceTab} from "@research-assistant/workbench-sdk/workbench";
      import type {ReorderableListRowProps, ReorderDragHandleProps} from "@research-assistant/workbench-sdk/reorder";
      export async function loadCatalog(resources: NoteResourceAccess) {return resources.gateway.listPages();}
      export async function flushExistingOwner(owner: NoteSaveCoordinator) {return owner.flush();}
      export const failure: NoteOpenFailure = {kind: "failed", code: "example_failure", message: "Synthetic failure"};
      export const command: NoteHistoryCommand = {id: "example", undo: () => true, redo: () => true};
      export function createLiteratureNote(resources: LiteratureNoteAccess) {return resources.create("paper");}
      export function annotationCannotReadLibrary(resources: NoteAnnotationAccess) {
        // @ts-expect-error The annotation port cannot enumerate the note library.
        return resources.gateway.listPages();
      }
      export async function chooseMultiple(): Promise<string[] | null> {return open({multiple: true});}
      export async function chooseOne(): Promise<string | null> {return open({directory: true});}
      export const options: OpenDialogOptions = {directory: true, recursive: true, fileAccessMode: "scoped"};
      // @ts-expect-error A picker cannot accept a non-boolean multiple flag.
      export const invalidOptions: OpenDialogOptions = {multiple: "yes"};
      export const portal: OverlayPortalProps = {children: null, kind: "popup"};
      export function invalidOverlayKind() {
        // @ts-expect-error Consumers cannot allocate a private overlay scope.
        return useOverlayTarget("private", {current: null});
      }
      export function notificationHook() {return useNotificationState("error");}
      export function publishTabs(tabs: readonly WorkspaceTab[]): boolean {return usePublishWorkspaceTabs("library", tabs, false);}
      export const row: ReorderableListRowProps = {itemId: "paper", dropTarget: true};
      export const handle: ReorderDragHandleProps = {compact: true};
    `);
    const loaded = execFileSync(process.execPath, [compiler, "--strict", "--noEmit", "--skipLibCheck", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--listFiles", "consumer.ts"], {cwd: temporary, encoding: "utf8"});
    for (const file of loaded.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      if (file.includes("/packages/core/src/") || file.includes("/packages/data/src/")) assert.fail(`workspace source escaped artifact: ${file}`);
    }
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});

test("the packed environment, shortcut and settings leaves require no application types", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-settings-contract-"));
  try {
    installArtifact("workbench-sdk", temporary);
    installArtifact("core", temporary);
    // Resolve the declared peer from the existing locked workspace. This does
    // not install anything or make an application implementation available.
    const require = createRequire(fileURLToPath(new URL("../../../apps/web/package.json", import.meta.url)));
    mkdirSync(path.join(temporary, "node_modules/@types"), {recursive: true});
    symlinkSync(path.dirname(require.resolve("@types/react/package.json")), path.join(temporary, "node_modules/@types/react"), "dir");
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import {isAppPreview, isDesktopRuntime, getRuntimeEnvironment, ensureRuntimeStructuredResources, hasPlatformCapabilities,
        getRuntimeStorage, getNativePreviewCapabilities, captureNewPreviewOwnerIntent, freezeNewPreviewOwnerIntent} from "@research-assistant/workbench-sdk/environment";
      import type * as Environment from "@research-assistant/workbench-sdk/environment";
      import {formatShortcut, isShortcutMac, type ShortcutBinding} from "@research-assistant/workbench-sdk/shortcuts";
      import {SettingRow, SettingGroup, useDeveloperMode, type SettingRowProps} from "@research-assistant/workbench-sdk/settings";
      export const modes: boolean[] = [isAppPreview(), isDesktopRuntime(), hasPlatformCapabilities()];
      export const environment = getRuntimeEnvironment();
      export const mode: "desktop" | "browser" | "preview" = environment.mode;
      export const capturedStorage: Storage = getRuntimeStorage(environment);
      export const previewCapabilities: Readonly<Environment.NativePreviewCapabilities> | undefined = getNativePreviewCapabilities(environment);
      export const previewGeneration: string | undefined = previewCapabilities?.generation;
      export const previewManualSupport: boolean | undefined = previewCapabilities?.supportsManualCompaction;
      export const previewOwnerSupport: boolean | undefined = previewCapabilities?.supportsOwnerIntent;
      export const writer: ((requestId: string) => Promise<void>) | undefined = captureNewPreviewOwnerIntent(environment, "synthetic-conversation");
      export const frozenOwner: Promise<void> = freezeNewPreviewOwnerIntent(environment, "synthetic-conversation", "synthetic-request");
      // @ts-expect-error The finite preview summary does not expose native controls.
      export const previewInvoke = previewCapabilities?.invoke;
      // @ts-expect-error Captured owner writers retain string request identities.
      writer?.(1);
      export async function startup() {return ensureRuntimeStructuredResources(environment);}
      // @ts-expect-error The narrow captured view does not expose native preview controls.
      export const nativePreview = environment.nativeAgentPreview;
      // @ts-expect-error The narrow captured view does not expose raw storage.
      export const storage = environment.storage;
      // @ts-expect-error The narrow captured view has no native transport.
      export const invoke = environment.invoke;
      export const shortcut: ShortcutBinding = {key: "z", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true};
      export const label: string = formatShortcut(shortcut, isShortcutMac());
      export const empty: string = formatShortcut(null);
      export const row: SettingRowProps = {title: "Synthetic setting", description: "Shared owner", details: null, children: "Value"};
      export const layout = SettingGroup({label: "Synthetic group", children: SettingRow(row)});
      export function developerMode() {
        const state = useDeveloperMode();
        state.setEnabled(true);
        // @ts-expect-error The original developer-mode setter requires a boolean.
        state.setEnabled("yes");
        return state.enabled;
      }
      // @ts-expect-error This leaf does not expose the raw native transport.
      export type NoInvoke = typeof Environment.invoke;
      // @ts-expect-error Settings presentation does not grant a provider registry.
      export const invalidRow: SettingRowProps = {title: "Invalid", children: null, providerRegistry: {}};
      // @ts-expect-error Existing shortcut bindings require all modifier flags.
      export const invalidBinding: ShortcutBinding = {key: "z"};
    `);
    const loaded = execFileSync(process.execPath, [compiler, "--strict", "--noEmit", "--target", "ES2022", "--lib", "ES2022,DOM", "--module", "ESNext", "--moduleResolution", "Bundler", "--listFiles", "consumer.ts"], {cwd: temporary, encoding: "utf8"});
    assert.ok(loaded.includes("@types/react/index.d.ts"), "the real React peer declarations must be checked");
    for (const file of loaded.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  } finally {
    rmSync(temporary, {recursive: true, force: true});
  }
});
