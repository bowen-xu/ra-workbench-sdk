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

test("packed ReaderClosePort.close preserves the original producer's string input and Promise<boolean> result", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-reader-close-contract-"));
  try {
    const archive = path.join(directory, "workbench-sdk.tgz");
    execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
      cwd: path.join(root, "packages/workbench-sdk"), stdio: "pipe",
    });
    const installed = path.join(directory, "node_modules/@research-assistant/workbench-sdk");
    mkdirSync(installed, {recursive: true});
    execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    assert.doesNotMatch(readFileSync(path.join(installed, "lib/workbench.d.ts"), "utf8"), /apps\/web|core\/workspace|\.\.\//u);
    assert.match(readFileSync(path.join(installed, "lib/workbench.js"), "utf8"), /^export \{\};\s*$/u);
    const compile = (source, actualCore = false) => {
      const input = path.join(directory, "consumer.ts");
      writeFileSync(input, source);
      const config = path.join(directory, "tsconfig.json");
      writeFileSync(config, JSON.stringify({
        ...(actualCore ? {extends: path.join(root, "tsconfig.base.json")} : {}),
        compilerOptions: {strict: true, exactOptionalPropertyTypes: true, noEmit: true, types: [],
          target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "Bundler", listFiles: true,
          ...(actualCore ? {jsx: "react-jsx", allowImportingTsExtensions: true} : {skipLibCheck: false})},
        files: [input, ...(actualCore ? [path.join(root, "apps/web/src/env.d.ts")] : [])],
      }));
      const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", config, "--pretty", "false"], {
        cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout.trim().split("\n");
    };
    const loaded = compile(`
      import {getReaderCloseCoordinator} from "@research-assistant/workbench-sdk/workbench";
      const pending: Promise<boolean> = getReaderCloseCoordinator().close("synthetic-reader-id");
      export async function closeExistingReader(tabId: string): Promise<boolean> {
        return await getReaderCloseCoordinator().close(tabId);
      }
      pending.then(closed => {const saved: boolean = closed; void saved;});
      // @ts-expect-error The original close identity is a string.
      getReaderCloseCoordinator().close(1);
      // @ts-expect-error The original save/close result is asynchronous.
      export const noSynchronousSuccess: boolean = getReaderCloseCoordinator().close("synthetic-reader-id");
    `);
    for (const file of loaded) assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\/|\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    compile(`
      import type * as sdk from "@research-assistant/workbench-sdk/workbench";
      import type * as core from ${JSON.stringify(path.join(root, "apps/web/src/core/public/workbench.ts"))};
      type CoreClose = ReturnType<typeof core.getReaderCloseCoordinator>["close"];
      type SdkClose = sdk.ReaderClosePort["close"];
      declare const original: CoreClose;
      declare const declared: SdkClose;
      const acceptsSdk: CoreClose = declared; void acceptsSdk;
      const acceptsCore: SdkClose = original; void acceptsCore;
      type CorePublicProjection = Pick<ReturnType<typeof core.getReaderCloseCoordinator>, "register" | "close" | "prepareAll">;
      declare const originalPort: CorePublicProjection;
      declare const declaredPort: sdk.ReaderClosePort;
      const acceptsSdkPort: CorePublicProjection = declaredPort; void acceptsSdkPort;
      const acceptsCorePort: sdk.ReaderClosePort = originalPort; void acceptsCorePort;
    `, true);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
