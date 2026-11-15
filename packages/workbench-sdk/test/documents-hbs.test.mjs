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
const groups = [
  ["annotation-notes", "annotationNotes", ["listBrowserNotePageIds", "ensureBrowserAnnotationNote"]],
  ["documents", "documents", ["getNoteDocumentGateway"]],
  ["document-recovery", "documentRecovery", ["clearRecoveryDraft", "createRecoveryDraft", "loadRecoveryDraft", "saveRecoveryDraft"]],
  ["hbs", "hbs", ["HbsStructuredEditor", "directTextDiff", "getHbsDocumentGateway", "getPendingHbsDocumentCommit"]],
  ["literature-notes", "literatureNotes", ["stageLegacyAnnotationDocument", "requestLiteratureNoteTrash"]],
  ["structured-resources", "structuredResources", ["getStructuredResourceGateway", "structuredWriteValidationDiagnostic"]],
];

function installArtifact(name, directory) {
  const archive = path.join(directory, name + ".tgz");
  execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
    cwd: path.join(root, "packages", name), stdio: "pipe",
    env: {...process.env, npm_config_verify_deps_before_run: "false"},
  });
  const installed = path.join(directory, "node_modules/@research-assistant", name);
  mkdirSync(installed, {recursive: true});
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
  return installed;
}

function withPackedConsumer(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-documents-hbs-"));
  try {
    const sdk = installArtifact("workbench-sdk", directory);
    const core = installArtifact("core", directory);
    const data = installArtifact("data", directory);
    mkdirSync(path.join(directory, "node_modules/@types"), {recursive: true});
    symlinkSync(path.dirname(require.resolve("@types/react/package.json")), path.join(directory, "node_modules/@types/react"), "dir");
    // This pinned peer exports its dist entry, not a package.json subpath.
    symlinkSync(path.resolve(path.dirname(require.resolve("sonner")), ".."), path.join(directory, "node_modules/sonner"), "dir");
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    run({directory, sdk, core, data});
  } finally {rmSync(directory, {recursive: true, force: true});}
}

function compile(packed, source, corePublic = false, extraFiles = []) {
  const {directory, core, data} = packed;
  const input = path.join(directory, "consumer.ts");
  writeFileSync(input, source);
  const config = path.join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    ...(corePublic ? {extends: path.join(root, "tsconfig.base.json")} : {}),
    compilerOptions: {strict: true, exactOptionalPropertyTypes: true, noEmit: true,
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext",
      moduleResolution: "Bundler", jsx: "react-jsx", listFiles: true,
      ...(corePublic ? {allowImportingTsExtensions: true, paths: {
        // Both sides of the nominal class contract resolve the same versioned
        // public artifacts. No App/private source aliases are introduced.
        "@research-assistant/core/hbs": [path.join(core, "src/hbs/index.ts")],
        "@research-assistant/data/hbs": [path.join(data, "src/hbs/index.ts")],
      }} : {skipLibCheck: false})},
    files: [input, ...extraFiles, ...(corePublic ? [path.join(root, "apps/web/src/env.d.ts")] : [])],
  }));
  const result = spawnSync(process.execPath, [compiler, "-p", config, "--pretty", "false"], {
    cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split("\n");
}

function assertPureClosure(files) {
  assert.ok(files.some(file => file.includes("@types/react/index.d.ts")), "the real React peer is checked");
  for (const file of files) {
    assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
    assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
  }
}

test("six packed document/HBS leaves expose the original typed ports without App implementation", () => {
  withPackedConsumer(packed => {
    for (const [, name] of groups) {
      assert.doesNotMatch(readFileSync(path.join(packed.sdk, "lib", name + ".d.ts"), "utf8"), /apps\/web|core\/features|app\/runtime|\.\.\//u);
      assert.match(readFileSync(path.join(packed.sdk, "lib", name + ".js"), "utf8"), /^export \{\};\s*$/u,
        "a declaration must not construct another save, storage or session owner");
    }
    const files = compile(packed, `
      import type {NotePageId} from "@research-assistant/core/notes";
      import type {DocumentCommit, HbsSession} from "@research-assistant/core/hbs";
      import {listBrowserNotePageIds, ensureBrowserAnnotationNote} from "@research-assistant/workbench-sdk/annotation-notes";
      import {getNoteDocumentGateway} from "@research-assistant/workbench-sdk/documents";
      import {clearRecoveryDraft, createRecoveryDraft, loadRecoveryDraft, saveRecoveryDraft} from "@research-assistant/workbench-sdk/document-recovery";
      import {HbsStructuredEditor, directTextDiff, getHbsDocumentGateway, getPendingHbsDocumentCommit,
        type StructuredNativeHistoryAction, type HbsStructuredEditorProps} from "@research-assistant/workbench-sdk/hbs";
      import type * as Hbs from "@research-assistant/workbench-sdk/hbs";
      import {stageLegacyAnnotationDocument, requestLiteratureNoteTrash} from "@research-assistant/workbench-sdk/literature-notes";
      import {getStructuredResourceGateway} from "@research-assistant/workbench-sdk/structured-resources";
      declare const page: NotePageId;
      declare const session: HbsSession<unknown>;
      declare const request: DocumentCommit<unknown>;
      export async function annotation() {
        const ids: readonly NotePageId[] = await listBrowserNotePageIds();
        const snapshot = await ensureBrowserAnnotationNote(["concept", "synthetic"], "Synthetic note");
        await getNoteDocumentGateway().loadDocument(snapshot.page.id);
        return ids;
      }
      const identity = {scope: "pdf-reader", resourceId: "synthetic", slot: "session"};
      const draft = createRecoveryDraft(identity, {pageNote: "Synthetic input"}, {hash: "synthetic-hash"});
      export const recoveredPayload: string = draft.payload.pageNote;
      saveRecoveryDraft(draft); export const recovered = loadRecoveryDraft(identity); clearRecoveryDraft(identity);
      export const history: StructuredNativeHistoryAction = {undo: () => true, redo: () => false};
      export const editor: HbsStructuredEditorProps = {session, resourceKind: "structuredReading",
        configuration: {conflictActions: [], highlight: {incomingForeground: "var(--incoming)"}},
        renderFooter: field => field.title, onNativeHistoryReady: () => () => {}};
      export const view = HbsStructuredEditor(editor);
      export const changes = directTextDiff("before", "after");
      export const pending = getPendingHbsDocumentCommit("structured", "synthetic");
      export const submitted: Promise<unknown> = getHbsDocumentGateway().commit("structured", "synthetic", request);
      stageLegacyAnnotationDocument(page, 1, "Synthetic legacy body");
      export const trash: Promise<void> = requestLiteratureNoteTrash(page);
      export const resources = getStructuredResourceGateway().list();
      // @ts-expect-error The original typed note port excludes library management.
      getNoteDocumentGateway().listPages();
      // @ts-expect-error Recovery declarations preserve the actual C00 call form, not a Storage injection API.
      saveRecoveryDraft(draft, {} as Storage);
      // @ts-expect-error A source/receipt identifier is not a complete immutable commit.
      getHbsDocumentGateway().commit("structured", "synthetic", {id: "request"});
      // @ts-expect-error The original HBS kind is finite.
      getPendingHbsDocumentCommit("arbitrary", "synthetic");
      // @ts-expect-error A structurally similar object cannot replace the actual public HbsSession class.
      HbsStructuredEditor({session: {subscribe: () => () => {}, getSnapshot: () => ({})}});
      // @ts-expect-error Native history readiness must return its original cleanup.
      HbsStructuredEditor({session, onNativeHistoryReady: () => {}});
      // @ts-expect-error The existing structured gateway has no arbitrary native transport.
      getStructuredResourceGateway().invoke("arbitrary");
      // @ts-expect-error The Core outbox cannot be cleared through this leaf.
      export type NoOutboxReset = typeof Hbs.clearPendingHbsDocumentCommit;
      // @ts-expect-error Opening must not add an implicit resend method.
      export type NoAutomaticRetry = typeof Hbs.retryPendingHbsDocumentCommit;
    `);
    assertPureClosure(files);
  });
});

test("the real Core public signatures match the six packed leaves with one public HBS class version", () => {
  withPackedConsumer(packed => {
    const lines = [];
    for (const [subpath, module, names] of groups) {
      lines.push(`import type * as sdk_${module} from "@research-assistant/workbench-sdk/${subpath}";`);
      lines.push(`import type * as core_${module} from ${JSON.stringify(path.join(root, "apps/web/src/core/public", module + ".ts"))};`);
      for (const name of names) {
        lines.push(`declare const sdk_${name}: typeof sdk_${module}.${name};`);
        lines.push(`declare const core_${name}: typeof core_${module}.${name};`);
        lines.push(`const fromSdk_${name}: typeof core_${module}.${name} = sdk_${name}; void fromSdk_${name};`);
        lines.push(`const fromCore_${name}: typeof sdk_${module}.${name} = core_${name}; void fromCore_${name};`);
      }
    }
    for (const [module, names] of [["documents", ["NoteDocumentAccess"]], ["documentRecovery", ["RecoveryDraftIdentity"]],
      ["hbs", ["AppHbsDocumentGateway", "StructuredNativeHistoryAction"]], ["structuredResources", ["StructuredResourceGateway", "StructuredResourceEvidence"]]]) {
      for (const name of names) {
        lines.push(`declare const core_${name}: core_${module}.${name}; declare const sdk_${name}: sdk_${module}.${name};`);
        lines.push(`const fromSdk_${name}: core_${module}.${name} = sdk_${name}; void fromSdk_${name};`);
        lines.push(`const fromCore_${name}: sdk_${module}.${name} = core_${name}; void fromCore_${name};`);
      }
    }
    compile(packed, lines.join("\n"), true);
  });
});

test("the actual literature HBS owner and session construction compile unchanged against packed contracts", () => {
  withPackedConsumer(packed => {
    const ownerPath = path.join(root, "plugins/literature_library/src/features/ai/resources/useStructuredHbsSession.ts");
    const owner = readFileSync(ownerPath, "utf8");
    assert.ok(owner.includes('"@research-assistant/workbench-sdk/hbs"'));
    assert.ok(owner.includes('"@research-assistant/workbench-sdk/structured-resources"'));
    const mapped = owner;
    const start = owner.indexOf("interface NativeHistoryPort");
    assert.ok(start > 0);
    assert.equal(mapped.slice(mapped.indexOf("interface NativeHistoryPort")), owner.slice(start),
      "the canonical owner/session/outbox code is copied verbatim with its existing public imports");
    for (const fragment of ["new WeakMap<AppHbsDocumentGateway, Map<string, Owner>>()", "getPendingHbsDocumentCommit(\"structured\",resource.id)",
      "await HbsSession.open({ adapter, port, preservation", "if(owner.references<1)owner.suspend()", "await owner.state.session?.flushPreservation()"])
      assert.ok(mapped.includes(fragment), "actual production owner fragment: " + fragment);
    const resources = path.join(packed.directory, "resources");
    mkdirSync(resources);
    const stagedOwner = path.join(resources, "useStructuredHbsSession.ts");
    writeFileSync(stagedOwner, mapped);
    // The imported panel history is another actual domain fragment, not a
    // synthetic HbsSession. Its independent UI/provider is outside this probe.
    const history = readFileSync(path.join(root, "plugins/literature_library/src/features/ai/PortraitEditHistory.tsx"), "utf8");
    const historyBody = history.slice(history.indexOf("interface Edit {"), history.indexOf("\nconst HistoryContext"));
    assert.ok(historyBody.includes("export class PortraitEditHistory"));
    writeFileSync(path.join(packed.directory, "PortraitEditHistory.ts"),
      'import {notify} from "@research-assistant/workbench-sdk/feedback";\n' + historyBody + "\n");
    const files = compile(packed, 'export {useStructuredHbsSession, disposeStructuredHbsSessions} from "./resources/useStructuredHbsSession";', false, [stagedOwner]);
    assertPureClosure(files);
    assert.equal(readFileSync(ownerPath, "utf8"), owner, "the production owner was not edited");
  });
});
