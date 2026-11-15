import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
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
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-storage-contract-"));
  try {
    const installed = installArtifact("workbench-sdk", directory);
    installArtifact("core", directory);
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
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], types: [],
      module: "ESNext", moduleResolution: "Bundler", listFiles: true,
      ...(corePublic ? {allowImportingTsExtensions: true} : {skipLibCheck: false})},
    files: [input],
  }));
  const result = spawnSync(process.execPath, [compiler, "-p", config, "--pretty", "false"], {
    cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split("\n");
}

test("the packed storage leaf preserves the real reader UI session consumer and original writable Storage", () => {
  withPackedConsumer((directory, installed) => {
    const declaration = readFileSync(path.join(installed, "lib/storage.d.ts"), "utf8");
    assert.doesNotMatch(declaration, /apps\/web|core\/runtime|\.\.\//u);
    assert.match(readFileSync(path.join(installed, "lib/storage.js"), "utf8"), /^export \{\};\s*$/u);
    const consumer = readFileSync(path.join(root, "plugins/literature_library/src/features/reader/session/readerUiSessionState.ts"), "utf8");
    assert.equal(consumer.split("@research-assistant/workbench-sdk/storage").length - 1, 1);
    writeFileSync(path.join(directory, "readerUiSessionState.ts"), consumer);
    const loaded = compile(directory, `
      import {flushStorage, getAppStorage, storagePersistence} from "@research-assistant/workbench-sdk/storage";
      import type * as StorageSdk from "@research-assistant/workbench-sdk/storage";
      import type * as EnvironmentSdk from "@research-assistant/workbench-sdk/environment";
      import {loadReaderUiSessionState, saveReaderUiSessionState} from "./readerUiSessionState";
      const storage: Storage = getAppStorage();
      export const read: string | null = storage.getItem("synthetic-key");
      storage.setItem("synthetic-key", "synthetic-value");
      storage.removeItem("synthetic-key");
      export const count: number = storage.length;
      export const key: string | null = storage.key(0);
      storage.clear();
      export const state = loadReaderUiSessionState("synthetic-attachment");
      saveReaderUiSessionState("synthetic-attachment", state);
      const persistence = storagePersistence(storage);
      export const persistenceError: Error | undefined = persistence?.error;
      export const flush: Promise<void> = flushStorage(storage);
      export const retry: Promise<void> | undefined = persistence?.retry();
      // @ts-expect-error Existing Storage values remain strings.
      storage.setItem("synthetic-key", 1);
      // @ts-expect-error This leaf does not expose a new storage selector.
      export type NoSelect = typeof StorageSdk.selectAppStorage;
      // @ts-expect-error Only the existing getter is published, not an App runtime handle.
      export type NoRuntime = typeof StorageSdk.getAppRuntime;
      // @ts-expect-error New Storage access does not widen the frozen environment view.
      export type NoEnvironmentStorage = EnvironmentSdk.RuntimeEnvironment["storage"];
      // @ts-expect-error No transport is granted by a browser storage port.
      export type NoInvoke = typeof StorageSdk.invoke;
    `);
    for (const file of loaded) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
  });
});

test("the packed storage values match the actual Core public functions in both directions", () => {
  withPackedConsumer(directory => {
    compile(directory, `
      import type * as sdk from "@research-assistant/workbench-sdk/storage";
      import type * as core from ${JSON.stringify(path.join(root, "apps/web/src/core/public/storage.ts"))};
      declare const original: typeof core.getAppStorage;
      declare const declared: typeof sdk.getAppStorage;
      const acceptsSdk: typeof core.getAppStorage = declared; void acceptsSdk;
      const acceptsCore: typeof sdk.getAppStorage = original; void acceptsCore;
      declare const originalFlush: typeof core.flushStorage;
      declare const declaredFlush: typeof sdk.flushStorage;
      const acceptsSdkFlush: typeof core.flushStorage = declaredFlush; void acceptsSdkFlush;
      const acceptsCoreFlush: typeof sdk.flushStorage = originalFlush; void acceptsCoreFlush;
      declare const originalPersistence: typeof core.storagePersistence;
      declare const declaredPersistence: typeof sdk.storagePersistence;
      const acceptsSdkPersistence: typeof core.storagePersistence = declaredPersistence; void acceptsSdkPersistence;
      const acceptsCorePersistence: typeof sdk.storagePersistence = originalPersistence; void acceptsCorePersistence;
    `, true);
  });
});
