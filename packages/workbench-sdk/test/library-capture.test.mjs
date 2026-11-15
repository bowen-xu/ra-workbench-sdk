import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const compiler = require.resolve("typescript/bin/tsc");

test("packed capture contracts preserve fixed events, window scope and asynchronous cleanup", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-capture-"));
  try {
    const archive = path.join(temporary, "sdk.tgz");
    execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
      cwd: path.join(root, "packages/workbench-sdk"), stdio: "pipe",
    });
    const installed = path.join(temporary, "node_modules/@research-assistant/workbench-sdk");
    mkdirSync(installed, {recursive: true});
    execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import {listenBrowserCaptures, subscribeWindowFileDrop, desktopDropClientPosition,
        type BrowserCaptureEvent, type FileDropPosition, type WindowFileDropEvent} from "@research-assistant/workbench-sdk/library-capture";
      import type * as Capture from "@research-assistant/workbench-sdk/library-capture";
      export const capture: BrowserCaptureEvent = {kind: "attachment"};
      export const listener: Promise<() => void> = listenBrowserCaptures(event => {
        const kind: "item" | "attachment" | "tags" = event.kind; void kind;
      });
      export const lateCleanup: Promise<void> = listener.then(unlisten => {unlisten();});
      export const windowListener: Promise<() => void> = subscribeWindowFileDrop(event => {
        if (event.type === "enter" || event.type === "drop") {
          const paths: readonly string[] = event.paths; void paths;
          const client: FileDropPosition = desktopDropClientPosition(event.position); void client;
          // @ts-expect-error A listener cannot mutate the original drop payload.
          event.paths.push("injected");
        }
        if (event.type === "leave") {
          // @ts-expect-error A leave signal carries no stale file paths.
          void event.paths;
        }
      });
      export const drop: WindowFileDropEvent = {type: "drop", position: {x: 1, y: 2}, paths: ["synthetic.pdf"]};
      // @ts-expect-error Browser capture exposes only the original three change signals.
      export const arbitraryCapture: BrowserCaptureEvent = {kind: "private-channel"};
      // @ts-expect-error Fixed window subscription does not accept native event names.
      subscribeWindowFileDrop("private-channel", () => {});
      // @ts-expect-error Enter/drop payloads require the original paths and position.
      export const invalidDrop: WindowFileDropEvent = {type: "enter"};
      // @ts-expect-error Platform coordinates remain numeric.
      desktopDropClientPosition({x: "1", y: 2});
      // @ts-expect-error An event signal does not provide an arbitrary file reader.
      export type NoReadFile = typeof Capture.readFile;
      // @ts-expect-error No raw native transport is exposed.
      export type NoInvoke = typeof Capture.invoke;
    `);
    const options = ["--strict", "--noEmit", "--target", "ES2022", "--lib", "ES2022,DOM", "--module", "ESNext", "--moduleResolution", "Bundler"];
    const files = execFileSync(process.execPath, [compiler, ...options, "--listFiles", "consumer.ts"], {
      cwd: temporary, encoding: "utf8",
    });
    for (const file of files.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
    const names = ["listenBrowserCaptures", "subscribeWindowFileDrop", "desktopDropClientPosition"];
    const lines = [
      'import type * as SDK from "@research-assistant/workbench-sdk/library-capture";',
      `import type * as Core from ${JSON.stringify(path.join(root, "apps/web/src/core/public/libraryCapture.ts"))};`,
    ];
    for (const name of names) lines.push(
      `declare const core_${name}: typeof Core.${name}; declare const sdk_${name}: typeof SDK.${name};`,
      `const toCore_${name}: typeof Core.${name} = sdk_${name}; void toCore_${name};`,
      `const toSdk_${name}: typeof SDK.${name} = core_${name}; void toSdk_${name};`,
    );
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
