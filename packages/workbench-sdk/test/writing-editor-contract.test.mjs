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
  ["block-content", "blockContent", ["baseBlockEditorSchema", "blockEditorDefaults", "withCaptionBlocks", "withoutCaptionBlocks", "ManagedAssetIngress", "NoteEditorSurface", "ImageBlockPresentation"]],
  ["document-windows", "documentWindows", ["NoteFloatingWindow"]],
  ["editor-review", "editorReview", ["EditorDiffControls", "EditorDiffHighlight", "chunkActionDecorations", "resolveTextChunk", "resolveTextDiff", "textChanges", "textDiffResolution", "textReviewBaseline"]],
  ["code-editor-extensions", "codeEditorExtensions", ["editorSearchScope", "createEditorSearchPanel", "latexLanguage", "virtualCompletion"]],
  ["writing-storage", "writingStorage", ["writingRecords", "writingFileKey", "decodeWritingBody", "decodeWritingDraft", "decodeWritingFile", "decodeWritingProject", "decodeWritingSession"]],
  ["writing-runtime", "writingRuntime", ["resolveWritingRuntimeGateway", "resolveWritingCheckpointRuntimeGateway", "getWritingNoteAssetNativeGateway"]],
  ["git-versions", "gitVersions", ["getManuscriptVersionGateway"]],
  ["git-worktrees", "gitWorktrees", ["getGitWorktreeGateway"]],
  ["document-recovery", "documentRecovery", ["EDITOR_AUTOSAVE_IDLE_MS"]],
  ["feedback", "feedback", ["NotificationEffect"]],
  ["workspace-state", "workspaceState", ["workspaceBoolean"]],
  ["note-documents", "noteDocuments", ["NotePageToolbar", "openNoteDocumentTab"]],
  ["pdf", "pdf", ["PdfViewControls"]],
  ["platform", "platform", ["downloadDir", "join"]],
  ["source-navigation", "sourceNavigation", ["openSourceLink"]],
  ["ui", "ui", ["InlineReference"]],
  ["domain-capabilities", "domainCapabilities", ["getOptionalLiteratureGateway"]],
  ["agent-gateways","agent",["agentApplicationGateway","agentCatalogGateway","agentCompactionGateway","agentCompileResultGateway","agentCreationGateway","agentEditorRestorationGateway","agentInputQueueGateway","agentInputQueuePreviewGateway","agentInstructionTrustGateway","agentMetadataGateway","agentPendingWritingApplicationGateway","agentPendingWritingUndoGateway","agentProposalGateway","agentSessionGateway","agentSteeringGateway","agentSubmissionGateway","agentSubtaskGateway","agentTurnGateway","agentUndoGateway","agentWorkspaceDiscardGateway","agentWorkspaceGateway","agentWorkspaceReviewGateway","agentWorkspaceSuccessorGateway","agentWritingFileDeliveryGateway","getAgentUndoEditorRestorationGateway"]],
  ["agent-delivery","pluginAgentDelivery",["writingDeliveryToolGateway","writingSuccessorToolGateway"]],
  ["agent-diagnostics","pluginAgentDiagnostics",["agentFailureDiagnostics","agentHistoryErrorMessage","diagnosticError"]],
  ["text-diff-stats","textDiffStats",["countWritingChangedLines"]],
  ["agent-drafts","pluginAgentDrafts",["useAgentDraftStore","useConversationDraft","decodeConversationDraftAcknowledgmentToken","queueDraftEdit"]],
  ["agent-writing","agentWriting",["ReviewedSubmissionController","ReviewedSubmissionOwnerRegistry","acquireWritingSubmissionController","captureWritingDraftReceipt","decodeWritingDraftAcknowledgment","hasPendingWritingSubmissions","releaseWritingSubmissionController","sameWritingQueueCancellationIntent","unownedWritingDraftReceipt","writingDraftAcknowledgments","writingPreparationDomainFields","writingPreparationMessage","writingPreparationRejection","writingQueueCancellationMessage","writingQueueCancellationRecovery","writingQueuePreparationMessage","writingQueuedStartMessage","writingQueuedStartQueue","writingWorkspacePreparationMessage"]],
  ["agent-submission","pluginAgentSubmission",["AgentPendingSteeringBubbles","AgentPendingSubmissionBubble","hasConfirmedSubmissionMessage","useAgentQueueOwners","AgentSteeringHandoffRecovery","useAgentSteeringOwners","AgentSteeringReceipt","AgentSubmissionFeedback","readComposerCommand","AGENT_START_FAILURE","recoverAgentPreparationFailure","dispatchQueuedAgentCommand","holdRejectedQueuePreparation","writingQueuePreparingPresentation","pauseRejectedSteerQueue","recoverRejectedSteer","reconcileSteeringTransfer","useAgentInputQueue","useAgentQueueAutoPrepare","useAgentSteering"]],
  ["agent-context-controls","pluginAgentContextControls",["agentContextGateway","useAgentContextUsage","useContextContribution","useConversationSteeringHandoff","useHiddenHandoffQueueInputs"]],
  ["agent-conversations","pluginAgentConversations",["BoundConversationList","ConversationCreationRecovery","conversationCreationMessage","ConversationForkOrigin","clearAgentSessionSelection","readAgentSessionSelection","writeAgentSessionSelection","nameInitialConversation","pendingBoundConversationId","readBoundCreation","reserveBoundConversation","AgentConversationController","projectConversationMessages","useAgentConversation","useBoundConversationCreation","useConversationForkActions","useConversationMetadata"]],
  ["agent-presentation","pluginAgentPresentation",["AgentChangeContribution","WritingAgentPanel","AgentTransientFailure","AgentRecoveryMessage","readMessageInspection","useAgentChildTasks","useAgentHostLifecycle","useAgentMountedGuard","WritingAgentTaskStack"]],
  ["agent-canvas","pluginAgentCanvas",["AgentCanvasHost","useAgentCanvasExternalSubmission"]],
];
const peerPackages = [
  "@types/react", "@types/react-dom", "@tiptap/pm", "@blocknote/core", "@blocknote/react",
  "@codemirror/state", "@codemirror/view", "@codemirror/autocomplete", "@ariakit/react", "sonner",
];

function packageDirectory(name) {
  let entry;
  try {
    entry = require.resolve(`${name}/package.json`);
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    entry = require.resolve(name === "@tiptap/pm" ? "@tiptap/pm/view" : name);
  }
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    try {
      if (JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).name === name) return directory;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Package directory missing for ${name}`);
}

function withPackedConsumer(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-writing-editor-"));
  try {
    for (const name of ["core", "writing", "data", "workbench-sdk"]) {
      const archive = path.join(directory, `${name}.tgz`);
      execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {
        cwd: path.join(root, "packages", name), stdio: "pipe",
      });
      const installed = path.join(directory, "node_modules/@research-assistant", name);
      mkdirSync(installed, {recursive: true});
      execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
    }
    for (const name of peerPackages) {
      const target = path.join(directory, "node_modules", name);
      mkdirSync(path.dirname(target), {recursive: true});
      symlinkSync(packageDirectory(name), target, "dir");
    }
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    run(directory);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
}

function compile(directory, source, actualCore = false) {
  const input = path.join(directory, "consumer.ts");
  writeFileSync(input, source);
  const configuration = path.join(directory, "tsconfig.json");
  writeFileSync(configuration, JSON.stringify({
    ...(actualCore ? {extends: path.join(root, "tsconfig.base.json")} : {}),
    compilerOptions: {
      strict: true, exactOptionalPropertyTypes: true, noEmit: true,
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx", listFiles: true,
      // Match the existing project profile. The pinned BlockNote declaration
      // files contain upstream optional-heading errors under full lib checking;
      // SDK sources and both assignment directions remain strictly checked.
      skipLibCheck: true,
      ...(actualCore ? {
        allowImportingTsExtensions: true,
        paths: {
          // Both the actual producer and the packed declaration use one public
          // branded path and one public HBS class identity.
          "@research-assistant/writing": [path.join(directory, "node_modules/@research-assistant/writing/src/index.ts")],
          "@research-assistant/data/agent": [path.join(directory, "node_modules/@research-assistant/data/src/agent/index.ts")],
          "@research-assistant/core/hbs": [path.join(directory, "node_modules/@research-assistant/core/src/hbs/index.ts")],
          "@research-assistant/data/hbs": [path.join(directory, "node_modules/@research-assistant/data/src/hbs/index.ts")],
        },
      } : {}),
    },
    files: [input, ...(actualCore ? [path.join(root, "apps/web/src/env.d.ts")] : [])],
  }));
  const result = spawnSync(process.execPath, [compiler, "-p", configuration, "--pretty", "false"], {
    cwd: directory, encoding: "utf8", maxBuffer: 24 * 1024 * 1024,
  });
  const diagnostics = result.stdout.split("\n").filter(line => !line.startsWith("/") || line.includes("error TS")).join("\n");
  assert.equal(result.status, 0, diagnostics + result.stderr);
  return result.stdout.trim().split("\n");
}

test("packed writing Core declarations have a public-only type closure", () => {
  withPackedConsumer(directory => {
    const source = groups.map(([subpath, , names], index) => `
      import type * as Group${index} from "@research-assistant/workbench-sdk/${subpath}";
      export type Values${index} = Pick<typeof Group${index}, ${names.map(JSON.stringify).join(" | ")}>;
    `).join("\n") + `
      import type {useAgentQueueOwners, useAgentSteeringOwners} from "@research-assistant/workbench-sdk/agent-submission";
      import type {acquireWritingSubmissionController, hasPendingWritingSubmissions, ReviewedSubmissionOwnerRegistry, WritingSubmissionController, WritingQueuedStartQueuePort} from "@research-assistant/workbench-sdk/agent-writing";
      declare const queues: ReturnType<typeof useAgentQueueOwners>;
      declare const steering: ReturnType<typeof useAgentSteeringOwners>;
      declare const hasSubmissions: typeof hasPendingWritingSubmissions;
      declare const reviewedOwners: ReviewedSubmissionOwnerRegistry<WritingSubmissionController>;
      export const pendingQueue: boolean | undefined = queues?.writing.hasPending();
      export const pendingSteer: boolean | undefined = steering?.writing.hasPending();
      export const pendingHandoff: boolean | undefined = steering?.handoffs.hasPending("manuscript");
      export const pendingSubmission: boolean = hasSubmissions();
      export const pendingReviewed: boolean = reviewedOwners.hasPending();
      export const acquisitionAdmission: NonNullable<Parameters<typeof acquireWritingSubmissionController>[5]> = () => false;
      export const resumeAdmission: NonNullable<Parameters<WritingQueuedStartQueuePort["resume"]>[4]> = () => false;
      // @ts-expect-error Only original queue scope kinds can filter a handoff.
      steering?.handoffs.hasPending("writing");
    `;
    const files = compile(directory, source);
    for (const file of files) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|writing|workbench-sdk)\/src\//u);
    }
    for (const [, module] of groups.slice(0, 8)) {
      const base = path.join(directory, "node_modules/@research-assistant/workbench-sdk/lib", module);
      assert.doesNotMatch(readFileSync(`${base}.d.ts`, "utf8"), /apps\/web|core\/features|app\/runtime/u);
      assert.match(readFileSync(`${base}.js`, "utf8"), /^export \{\};\s*$/u);
    }
    assert.ok(files.some(file => file.includes("@blocknote/core") && file.endsWith(".d.ts")));
    assert.ok(files.some(file => file.includes("@codemirror/state") && file.endsWith(".d.ts")));
    assert.ok(files.some(file => file.includes("@codemirror/view") && file.endsWith(".d.ts")));
  });
});

test("all writing Core values match the actual Core producer in both directions", () => {
  withPackedConsumer(directory => {
    const source = groups.map(([subpath, module, names], index) => {
      const keys = names.map(JSON.stringify).join(" | ");
      return `
        import type * as Sdk${index} from "@research-assistant/workbench-sdk/${subpath}";
        import type * as Core${index} from ${JSON.stringify(path.join(root, "apps/web/src/core/public", module + ".ts"))};
        declare const sdk${index}: Pick<typeof Sdk${index}, ${keys}>;
        declare const core${index}: Pick<typeof Core${index}, ${keys}>;
        export const sdkFromCore${index}: typeof sdk${index} = core${index};
        export const coreFromSdk${index}: typeof core${index} = sdk${index};
      `;
    }).join("\n");
    compile(directory, source, true);
  });
});
