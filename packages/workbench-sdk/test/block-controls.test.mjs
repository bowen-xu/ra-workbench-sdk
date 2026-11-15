import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const compiler = require.resolve("typescript/bin/tsc");

test("packed block controls retain Core signatures without exposing editor implementations", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "workbench-block-controls-"));
  try {
    const archive = path.join(temporary, "sdk.tgz");
    execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
      cwd: path.join(root, "packages/workbench-sdk"), stdio: "pipe",
    });
    const installed = path.join(temporary, "node_modules/@research-assistant/workbench-sdk");
    mkdirSync(installed, {recursive: true});
    execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    for (const name of ["@types/react", "@ariakit/react"]) {
      const destination = path.join(temporary, "node_modules", name);
      mkdirSync(path.dirname(destination), {recursive: true});
      symlinkSync(path.dirname(require.resolve(name + "/package.json")), destination, "dir");
    }
    writeFileSync(path.join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(temporary, "consumer.ts"), `
      import {BlockControlsProvider, FloatingBlockControls, BlockAddButton, BlockDragButton,
        NoteActionMenu, NoteActionMenuItem, useBlockControlsRoot, getEditorScrollContainer,
        startBlockPointerDrag, useBlockDragAutoScroll, type BlockDragDom,
        type BlockDragCallbacks, type BlockDropTarget} from "@research-assistant/workbench-sdk/block-controls";
      import type * as Controls from "@research-assistant/workbench-sdk/block-controls";
      import type {ComponentProps} from "react";
      declare const root: HTMLElement;
      declare const initial: PointerEvent;
      declare const dom: BlockDragDom;
      export const owner = BlockControlsProvider({root: {current: root}, dom, children: null});
      export const gutter = FloatingBlockControls({blockId: "block", label: "Synthetic commands", children: null});
      export const add: ComponentProps<typeof BlockAddButton> = {ref: {current: null}, disabled: true};
      export const drag: ComponentProps<typeof BlockDragButton> = {onPointerDown: event => {event.preventDefault();}};
      export const menu = NoteActionMenu({label: "Actions", trigger: null, children: null, className: "synthetic"});
      export const item = NoteActionMenuItem({children: "Move", hideOnClick: false});
      export const callbacks: BlockDragCallbacks = {
        canDrop: target => target.placement !== "inside", move: target => {void target.blockId;},
        onActivate: () => {}, onFinish: result => {const click: boolean = result.click; void click;},
      };
      export const dispose: () => void = startBlockPointerDrag(root, root, initial, callbacks, dom);
      export const defaultDispose = startBlockPointerDrag(root, root, initial, callbacks);
      export const pane: HTMLElement | null = getEditorScrollContainer(root);
      export function hooks() {
        const root = useBlockControlsRoot();
        const scroll = useBlockDragAutoScroll();
        if (root.current) scroll.start(root.current);
        scroll.stop();
      }
      // @ts-expect-error A block destination keeps the original finite placement union.
      export const invalidTarget: BlockDropTarget = {blockId: "block", placement: "replace", line: {left: 0, top: 0, width: 1}};
      // @ts-expect-error A DOM resolver cannot confer a document writer.
      export const invalidDom: BlockDragDom = {...dom, writeDocument: () => {}};
      // @ts-expect-error A pointer gesture is not an arbitrary event callback.
      startBlockPointerDrag(root, root, new Event("pointerdown"), callbacks);
      // @ts-expect-error The SDK does not expose the private editor schema or runtime constructor.
      export type NoEditor = typeof Controls.createEditor;
      // @ts-expect-error Floating controls require the original host label.
      FloatingBlockControls({blockId: "block", children: null});
    `);
    const options = ["--strict", "--noEmit", "--target", "ES2022", "--lib", "ES2022,DOM,DOM.Iterable", "--module", "ESNext", "--moduleResolution", "Bundler"];
    const files = execFileSync(process.execPath, [compiler, ...options, "--listFiles", "consumer.ts"], {
      cwd: temporary, encoding: "utf8",
    });
    for (const file of files.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
    }
    const names = ["BlockControlsProvider", "FloatingBlockControls", "NoteActionMenu", "NoteActionMenuItem",
      "BlockAddButton", "BlockDragButton", "useBlockControlsRoot", "startBlockPointerDrag",
      "getEditorScrollContainer", "useBlockDragAutoScroll"];
    const lines = [
      'import type * as SDK from "@research-assistant/workbench-sdk/block-controls";',
      `import type * as Core from ${JSON.stringify(path.join(root, "apps/web/src/core/public/blockControls.ts"))};`,
    ];
    for (const name of names) lines.push(
      `declare const core_${name}: typeof Core.${name};`,
      `declare const sdk_${name}: typeof SDK.${name};`,
      `const acceptsCore_${name}: typeof SDK.${name} = core_${name}; void acceptsCore_${name};`,
      `const acceptsSdk_${name}: typeof Core.${name} = sdk_${name}; void acceptsSdk_${name};`,
    );
    lines.push("declare const coreDom: Core.BlockDragDom; declare const sdkDom: SDK.BlockDragDom;",
      "const acceptsCoreDom: SDK.BlockDragDom = coreDom; void acceptsCoreDom;",
      "const acceptsSdkDom: Core.BlockDragDom = sdkDom; void acceptsSdkDom;");
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
