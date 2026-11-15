import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const groups = [
  ["agentPresentation", "pluginAgentPresentation", ["WritingAgentPanel", "WritingAgentTaskStack", "AgentChangeContribution", "AgentTransientFailure", "AgentRecoveryMessage", "readMessageInspection", "useAgentChildTasks", "useAgentHostLifecycle", "useAgentMountedGuard"]],
  ["agentCanvas", "pluginAgentCanvas", ["AgentCanvasHost", "useAgentCanvasExternalSubmission"]],
];

test("Agent presentation and Canvas use the actual Core values with bidirectional public types", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-agent-presentation-"));
  try {
    const source = groups.map(([sdk, core, values], index) => {
      const keys = values.map(JSON.stringify).join(" | ");
      return `
        import type * as Sdk${index} from ${JSON.stringify(path.join(root, "packages/workbench-sdk/src", `${sdk}.ts`))};
        import type * as Core${index} from ${JSON.stringify(path.join(root, "apps/web/src/core/public", `${core}.ts`))};
        declare const sdk${index}: Pick<typeof Sdk${index}, ${keys}>;
        declare const core${index}: Pick<typeof Core${index}, ${keys}>;
        export const sdkFromCore${index}: typeof sdk${index} = core${index};
        export const coreFromSdk${index}: typeof core${index} = sdk${index};
      `;
    }).join("\n") + `
      import type {AgentMessage, WritingAgentMessage} from ${JSON.stringify(path.join(root, "packages/workbench-sdk/src/agentPresentation.ts"))};
      import type {AgentMessage as CoreMessage, WritingAgentMessage as CoreWritingMessage} from ${JSON.stringify(path.join(root, "apps/web/src/core/contracts/agentMessage.ts"))};
      import type {AgentDomainSessionProps} from ${JSON.stringify(path.join(root, "packages/workbench-sdk/src/agentPresentation.ts"))};
      import type {AgentDomainSessionProps as CoreDomainSessionProps} from ${JSON.stringify(path.join(root, "apps/web/src/core/public/agentConversationAdapters.ts"))};
      declare const message: AgentMessage;
      declare const coreMessage: CoreMessage;
      export const messageFromCore: AgentMessage = coreMessage;
      export const coreFromMessage: CoreMessage = message;
      declare const writing: WritingAgentMessage;
      declare const coreWriting: CoreWritingMessage;
      export const writingFromCore: WritingAgentMessage = coreWriting;
      export const coreFromWriting: CoreWritingMessage = writing;
      declare const domain: AgentDomainSessionProps;
      declare const coreDomain: CoreDomainSessionProps;
      export const domainFromCore: AgentDomainSessionProps = coreDomain;
      export const coreFromDomain: CoreDomainSessionProps = domain;
      type SameKeys<Left, Right> = [Exclude<keyof Left, keyof Right>, Exclude<keyof Right, keyof Left>] extends [never, never] ? true : false;
      export const messageFieldsPreserved: SameKeys<AgentMessage, CoreMessage> = true;
      export const domainFieldsPreserved: SameKeys<AgentDomainSessionProps, CoreDomainSessionProps> = true;
      export const panelFieldsPreserved: SameKeys<Parameters<typeof Sdk0.WritingAgentPanel>[0], Parameters<typeof Core0.WritingAgentPanel>[0]> = true;
      export const stackFieldsPreserved: SameKeys<Parameters<typeof Sdk0.WritingAgentTaskStack>[0], Parameters<typeof Core0.WritingAgentTaskStack>[0]> = true;
      export const queueFieldsPreserved: SameKeys<NonNullable<Parameters<typeof Sdk0.WritingAgentTaskStack>[0]["queue"]>, NonNullable<Parameters<typeof Core0.WritingAgentTaskStack>[0]["queue"]>> = true;
    `;
    const input = path.join(directory, "consumer.ts");
    writeFileSync(input, source);
    const configuration = path.join(directory, "tsconfig.json");
    writeFileSync(configuration, JSON.stringify({
      extends: path.join(root, "tsconfig.base.json"),
      compilerOptions: {allowImportingTsExtensions: true, noEmit: true, jsx: "react-jsx", lib: ["ES2022", "DOM", "DOM.Iterable"], types: []},
      files: [input, path.join(root, "apps/web/src/env.d.ts")],
    }));
    const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", configuration, "--pretty", "false"], {
      cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

test("Agent UI declarations preserve the separate Core Canvas module and create no SDK owner", () => {
  for (const sdk of [...groups.map(([module]) => module), "agentMessages"]) {
    const declaration = readFileSync(path.join(root, "packages/workbench-sdk/lib", `${sdk}.d.ts`), "utf8");
    assert.doesNotMatch(declaration, /apps\/web|core\/features|app\/runtime/u);
    assert.match(readFileSync(path.join(root, "packages/workbench-sdk/lib", `${sdk}.js`), "utf8"), /^export \{\};\s*$/u);
  }
  assert.doesNotMatch(readFileSync(path.join(root, "apps/web/src/core/public/pluginAgentPresentation.ts"), "utf8"), /AgentCanvasShell|pluginAgentCanvas/u);
  assert.doesNotMatch(readFileSync(path.join(root, "packages/workbench-sdk/src/agentMessages.ts"), "utf8"), /agentPresentation|agentConversations|agentContextControls|agentSubmission/u);
});
