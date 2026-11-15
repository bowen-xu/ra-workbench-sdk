import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/web/package.json"));
const ts = require("typescript");
const compiler = require.resolve("typescript/bin/tsc");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const consumers = [
  ["literature", "Literature", "LiteratureGateway", "getLiteratureGateway", "browserGateway"],
  ["collection", "Collection", "CollectionGateway", "getCollectionGateway", "gateway"],
  ["nal", "Nal", "NalGateway", "getNalGateway", "gateway"],
  ["nalQuery", "NalQuery", "NalQueryGateway", "getNalQueryGateway", "gateway"],
  ["knowledge", "Knowledge", "ResearchKnowledgeGateway", "getResearchKnowledgeGateway", "browserKnowledgeGateway"],
  ["evidence", "Evidence", "EvidenceGateway", "getEvidenceGateway", "browserEvidenceGateway"],
  ["evidenceMatrix", "EvidenceMatrix", "EvidenceMatrixGateway", "getEvidenceMatrixGateway", "browserGateway"],
  ["derivedView", "DerivedView", "DerivedResearchViewGateway", "getDerivedResearchViewGateway", "browserGateway"],
  ["referenceRecord", "ReferenceRecord", "ReferenceRecordGateway", "getReferenceRecordGateway", "browserGateway"],
  ["researchExport", "ResearchExport", "ResearchExportGateway", "getResearchExportGateway", "browserGateway"],
];

function compiledExports(value) {
  if (typeof value === "string" && value.startsWith("./src/") && value.endsWith(".ts")) {
    const stem = "./lib/" + value.slice(6, -3);
    return {types: stem + ".d.ts", default: stem + ".js"};
  }
  return value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compiledExports(child)])) : value;
}

function installArtifact(name, directory) {
  let source = path.join(root, "packages", name);
  if (name !== "workbench-sdk") {
    const output = path.join(directory, "built", name);
    mkdirSync(output, {recursive: true});
    execFileSync(process.execPath, [compiler, "-p", path.join(source, "tsconfig.json"), "--noEmit", "false", "--declaration",
      "--declarationMap", "false", "--rootDir", path.join(source, "src"), "--outDir", path.join(output, "lib"),
      ...(name === "data" ? ["--tsBuildInfoFile", path.join(output, "build.tsbuildinfo")] : [])], {cwd: root, stdio: "pipe"});
    const metadata = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
    metadata.exports = compiledExports(metadata.exports);
    metadata.files = ["lib"];
    delete metadata.scripts; delete metadata.devDependencies;
    for (const dependency of ["core", "writing"]) {
      const id = "@research-assistant/" + dependency;
      if (metadata.dependencies?.[id] === "workspace:*") {
        metadata.dependencies[id] = JSON.parse(readFileSync(path.join(root, "packages", dependency, "package.json"), "utf8")).version;
      }
    }
    writeFileSync(path.join(output, "package.json"), JSON.stringify(metadata));
    source = output;
  }
  const archive = path.join(directory, name + ".tgz");
  execFileSync("pnpm", ["--config.verify-deps-before-run=false", "pack", "--out", archive], {cwd: source, stdio: "pipe"});
  const installed = path.join(directory, "node_modules/@research-assistant", name);
  mkdirSync(installed, {recursive: true});
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", installed]);
  return {name, archive, installed, sha256: digest(readFileSync(archive))};
}

function withPackedConsumer(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-literature-runtime-contract-"));
  try {
    const artifacts = ["workbench-sdk", "core", "writing", "data"].map(name => installArtifact(name, directory));
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    run(directory, artifacts);
  } finally {rmSync(directory, {recursive: true, force: true});}
}

function compile(directory, source, corePublic = false) {
  const input = path.join(directory, "consumer.ts");
  writeFileSync(input, source);
  const config = path.join(directory, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    ...(corePublic ? {extends: path.join(root, "tsconfig.base.json")} : {}),
    compilerOptions: {strict: true, exactOptionalPropertyTypes: true, noEmit: true,
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], types: [], module: "ESNext", moduleResolution: "Bundler", listFiles: true,
      ...(corePublic ? {allowImportingTsExtensions: true, jsx: "react-jsx"} : {skipLibCheck: false})},
    files: [input, ...(corePublic ? [path.join(root, "apps/web/src/env.d.ts")] : [])],
  }));
  const result = spawnSync(process.execPath, [compiler, "-p", config, "--pretty", "false"], {
    cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split("\n");
}

test("all ten original terminal getter consumers compile outside the repository using only built packed contracts", () => {
  withPackedConsumer((directory, artifacts) => {
    const installedSdk = artifacts.find(value => value.name === "workbench-sdk").installed;
    const declaration = readFileSync(path.join(installedSdk, "lib/literatureRuntime.d.ts"), "utf8");
    assert.doesNotMatch(declaration, /apps\/web|core\/runtime|plugins\/|\.\.\//u);
    assert.match(readFileSync(path.join(installedSdk, "lib/literatureRuntime.js"), "utf8"), /^export \{\};\s*$/u);
    const data = artifacts.find(value => value.name === "data").installed;
    assert.match(readFileSync(path.join(data, "lib/literature.js"), "utf8"), /^export \{\};\s*$/u);
    const evidence = [];
    for (const [module, resolver, type, getter, fallback] of consumers) {
      const original = "plugins/literature_library/src/services/" + module + "Gateway.ts";
      const bytes = readFileSync(path.join(root, original));
      const source = ts.createSourceFile(original, bytes.toString(), ts.ScriptTarget.Latest, true);
      const terminal = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === getter);
      assert.ok(terminal, original + ": actual getter exists");
      const text = terminal.getText(source);
      assert.ok(text.includes(`resolve${resolver}RuntimeGateway(${fallback})`));
      const contract = module === "collection" ? "collections" : ["nal", "nalQuery"].includes(module) ? "nal" : "literature";
      const bindings = module === "literature" ? `declare const runtimeLiteratureGateway: (legacy?: () => ${type}) => ${type} | undefined;\n`
        : module === "nal" ? `declare const runtimeNalGateway: () => ${type} | undefined;\n`
        : module === "nalQuery" ? `declare const runtimeNalQueryGateway: () => ${type} | undefined;\n`
        : module === "knowledge" ? "declare const runtimeLiteratureGateway: () => unknown;\ndeclare const runtimeKnowledgeGateway: () => ResearchKnowledgeGateway | undefined;\n"
        : module === "researchExport" ? "declare const hasPlatformCapabilities: () => boolean;\ndeclare const runtimeResearchExportGateway: () => ResearchExportGateway | undefined;\n"
        : module === "referenceRecord" ? "declare const runtimeReferenceRecordGateway: () => ReferenceRecordGateway | undefined;\n"
        : ["evidence", "evidenceMatrix", "derivedView"].includes(module) ? `declare const runtime${resolver}Gateway: () => ${type} | undefined;\n` : "";
      const fixture = `import {resolve${resolver}RuntimeGateway} from "@research-assistant/workbench-sdk/literature-runtime";\n`
        + `import type {${type}} from "@research-assistant/data/${contract}";\ndeclare const ${fallback}: ${type};\n` + bindings + text + "\n";
      writeFileSync(path.join(directory, module + ".ts"), fixture);
      evidence.push({original, originalSha256: digest(bytes), terminalGetterSha256: digest(text), fixtureSha256: digest(fixture),
        adaptation: "Actual current terminal getter bytes copied unchanged; imports use packed SDK/public data, with fallback and finite runtime-binding helpers declared as data only, never executed."});
    }
    const loaded = compile(directory, consumers.map(([module]) => `export * from "./${module}";`).join("\n") + `
      import type * as sdk from "@research-assistant/workbench-sdk/literature-runtime";
      import type {LiteratureGateway, ReferenceRecordGateway, ResearchKnowledgeGateway, ResearchExportGateway} from "@research-assistant/data/literature";
      import type {NalGateway} from "@research-assistant/data/nal";
      declare const port: sdk.RuntimeLiteraturePort;
      export const preview: LiteratureGateway["previewDoi"] = port.literature.previewDoi;
      export const apply: LiteratureGateway["applyMetadataCandidateFields"] = port.literature.applyMetadataCandidateFields;
      export const save: LiteratureGateway["save"] = port.literature.save;
      export const update: LiteratureGateway["updateMetadataField"] = port.literature.updateMetadataField;
      export const confirm: LiteratureGateway["confirmMetadataFields"] = port.literature.confirmMetadataFields;
      export const bibtex: LiteratureGateway["importBibtex"] = port.literature.importBibtex;
      export const decide: LiteratureGateway["decideDuplicate"] = port.literature.decideDuplicate;
      export const merge: LiteratureGateway["mergeDuplicate"] = port.literature.mergeDuplicate;
      export const undo: LiteratureGateway["undoMerge"] = port.literature.undoMerge;
      export const archive: LiteratureGateway["archive"] = port.literature.archive;
      export const restore: LiteratureGateway["restore"] = port.literature.restore;
      export const trash: LiteratureGateway["trash"] = port.literature.trash;
      export const trashMany: LiteratureGateway["trashMany"] = port.literature.trashMany;
      export const restoreTrash: LiteratureGateway["restoreTrash"] = port.literature.restoreTrash;
      export const listTrash: LiteratureGateway["listTrash"] = port.literature.listTrash;
      export const importPdfs: LiteratureGateway["importPdfs"] = port.literature.importPdfs;
      export const attachPdf: LiteratureGateway["attachPdf"] = port.literature.attachPdf;
      export const renameAttachment: LiteratureGateway["renameAttachment"] = port.literature.renameAttachment;
      export const removeAttachment: LiteratureGateway["removeAttachment"] = port.literature.removeAttachment;
      export const readAttachment: LiteratureGateway["readAttachment"] = port.literature.readAttachment;
      export const revealAttachments: LiteratureGateway["revealAttachments"] = port.literature.revealAttachments;
      export const saveReadingState: LiteratureGateway["saveReadingState"] = port.literature.saveReadingState;
      export const getReadingState: LiteratureGateway["getReadingState"] = port.literature.getReadingState;
      export const isAttachmentIndexed: LiteratureGateway["isAttachmentIndexed"] = port.literature.isAttachmentIndexed;
      export const indexAttachment: LiteratureGateway["indexAttachment"] = port.literature.indexAttachment;
      export const listReferences: ReferenceRecordGateway["list"] = port.referenceRecords.list;
      export const saveReference: ReferenceRecordGateway["save"] = port.referenceRecords.save;
      // @ts-expect-error The existing reference-record contract has only list/save.
      export const noReferenceRemove = port.referenceRecords.remove;
      // @ts-expect-error The typed instance does not expose arbitrary native calls.
      export const noPortInvoke = port.invoke;
      // @ts-expect-error No new project relation consumer is part of this finite port.
      export const noPortProjects = port.literature.setProjects;
      // @ts-expect-error A job-list UI is not added by the existing management consumers.
      export const noJobList = port.literature.listImportJobs;
      export const nalMutation: NalGateway["mutate"] = port.nal.mutate;
      export const nalAnnotation: NalGateway["ensureAnnotation"] = port.nal.ensureAnnotation;
      export const searchConcepts: ResearchKnowledgeGateway["searchConcepts"] = port.knowledge.searchConcepts;
      export const saveConcept: ResearchKnowledgeGateway["saveConcept"] = port.knowledge.saveConcept;
      export const listReadingUnits: ResearchKnowledgeGateway["listReadingUnits"] = port.knowledge.listReadingUnits;
      export const saveReadingUnit: ResearchKnowledgeGateway["saveReadingUnit"] = port.knowledge.saveReadingUnit;
      // @ts-expect-error The finite manual-reading port does not grant reading profiles.
      export const noReadingProfiles = port.knowledge.listReadingProfiles;
      export const optionalCapture: ResearchKnowledgeGateway["captureConceptUsage"] | undefined = port.knowledge.captureConceptUsage;
      // @ts-expect-error Human capture requires checking the optional method.
      export const unguardedCapture: ResearchKnowledgeGateway["captureConceptUsage"] = port.knowledge.captureConceptUsage;
      export const optionalDefinitions: ResearchKnowledgeGateway["listDefinitionClaims"] | undefined = port.knowledge.listDefinitionClaims;
      export const optionalDefinitionSave: ResearchKnowledgeGateway["saveDefinitionClaim"] | undefined = port.knowledge.saveDefinitionClaim;
      export const optionalRevisions: ResearchKnowledgeGateway["listRevisions"] | undefined = port.knowledge.listRevisions;
      // @ts-expect-error Manual definitions require checking the optional method.
      export const unguardedDefinition: ResearchKnowledgeGateway["saveDefinitionClaim"] = port.knowledge.saveDefinitionClaim;
      // @ts-expect-error Revision reads require checking the optional method.
      export const unguardedRevisions: ResearchKnowledgeGateway["listRevisions"] = port.knowledge.listRevisions;
      export const optionalRelationSearch: ResearchKnowledgeGateway["searchRelationNodes"] | undefined = port.knowledge.searchRelationNodes;
      export const optionalRelationSave: ResearchKnowledgeGateway["saveRelationAssertion"] | undefined = port.knowledge.saveRelationAssertion;
      export const optionalRelations: ResearchKnowledgeGateway["listRelationAssertions"] | undefined = port.knowledge.listRelationAssertions;
      // @ts-expect-error Relation writes require checking the optional method.
      export const unguardedRelations: ResearchKnowledgeGateway["saveRelationAssertion"] = port.knowledge.saveRelationAssertion;
      export const optionalExport: ResearchExportGateway | undefined = port.researchExport;
      // @ts-expect-error Export requires checking the optional capability.
      export const unguardedExport: ResearchExportGateway = port.researchExport;
      export const optionalFoundations: ResearchKnowledgeGateway["analyzeSharedFoundations"] | undefined = port.knowledge.analyzeSharedFoundations;
      // @ts-expect-error Foundations requires checking the optional method.
      export const unguardedFoundations: ResearchKnowledgeGateway["analyzeSharedFoundations"] = port.knowledge.analyzeSharedFoundations;
      export const optionalEvolution: ResearchKnowledgeGateway["analyzeConceptEvolution"] | undefined = port.knowledge.analyzeConceptEvolution;
      export const optionalAlgorithmRun: ResearchKnowledgeGateway["getConceptAlgorithmRun"] | undefined = port.knowledge.getConceptAlgorithmRun;
      // @ts-expect-error Evolution requires checking the optional method.
      export const unguardedEvolution: ResearchKnowledgeGateway["analyzeConceptEvolution"] = port.knowledge.analyzeConceptEvolution;
      export const optionalIdentityPreview: ResearchKnowledgeGateway["previewConceptMerge"] | undefined = port.knowledge.previewConceptMerge;
      export const optionalIdentityMerge: ResearchKnowledgeGateway["mergeConcepts"] | undefined = port.knowledge.mergeConcepts;
      export const optionalIdentitySplit: ResearchKnowledgeGateway["splitConcepts"] | undefined = port.knowledge.splitConcepts;
      export const optionalIdentityEvents: ResearchKnowledgeGateway["listConceptIdentityEvents"] | undefined = port.knowledge.listConceptIdentityEvents;
      // @ts-expect-error Identity previews require checking the optional method.
      export const unguardedIdentity: ResearchKnowledgeGateway["previewConceptMerge"] = port.knowledge.previewConceptMerge;
      // @ts-expect-error HTTP request/credential handles remain Core-owned.
      export const noHttp = port.http;
      // @ts-expect-error No whole App runtime or private registry is exposed.
      export type NoRuntime = typeof sdk.getAppRuntime;
      // @ts-expect-error This leaf exposes only the ten named resolvers.
      export type NoGenericResolve = typeof sdk.resolveAppGateway;
      // @ts-expect-error Native invocation remains App-owned.
      export type NoInvoke = typeof sdk.invoke;
      // @ts-expect-error Gateway names cannot replace the required typed fallback.
      export const noArbitraryName = sdk.resolveNalRuntimeGateway("agentCommandGateway");
    `);
    for (const file of loaded) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\//u);
      assert.doesNotMatch(file, /\/packages\/(?:core|data|workbench-sdk)\/src\//u);
      assert.doesNotMatch(file, /\/node_modules\/@research-assistant\/(?:core|data)\/src\//u);
    }
    const receiptRoot = path.join(root, ".tmp/runtime-plugins/c02-literature-runtime-consumer-contracts");
    mkdirSync(receiptRoot, {recursive: true});
    const receiptDirectory = mkdtempSync(path.join(receiptRoot, "run-"));
    const evidencePath = path.relative(root, path.join(receiptDirectory, "receipt.json"));
    writeFileSync(path.join(root, evidencePath), JSON.stringify({evidencePath, recordedAt: new Date().toISOString(),
      scope: "Ten existing terminal getter bodies only, compiled against built packed artifacts; not a migrated full frontend build.",
      consumers: evidence, artifacts: artifacts.map(({name, sha256}) => ({name, sha256})), loadedFiles: loaded,
    }, null, 2) + "\n", {flag: "wx"});
  });
});

test("the packed resolvers preserve the real Core producer and seven legacy contract signatures in both directions", () => {
  withPackedConsumer(directory => {
    const lines = [
      'import type * as sdk from "@research-assistant/workbench-sdk/literature-runtime";',
      `import type * as core from ${JSON.stringify(path.join(root, "apps/web/src/core/public/literatureRuntime.ts"))};`,
      'import type * as canonical from "@research-assistant/data/literature";',
    ];
    for (const [, resolver] of consumers) {
      const name = "resolve" + resolver + "RuntimeGateway";
      lines.push(`declare const original_${resolver}: typeof core.${name}; declare const sdk_${resolver}: typeof sdk.${name};`,
        `const acceptsSdk_${resolver}: typeof core.${name} = sdk_${resolver}; void acceptsSdk_${resolver};`,
        `const acceptsCore_${resolver}: typeof sdk.${name} = original_${resolver}; void acceptsCore_${resolver};`);
    }
    const legacyTypes = [
      ["literatureGateway", ["LiteratureGateway"]], ["knowledgeGateway", ["ResearchKnowledgeGateway", "ConceptCaptureSourcePreview"]],
      ["evidenceGateway", ["EvidenceGateway"]], ["evidenceMatrixGateway", ["EvidenceMatrixGateway"]],
      ["derivedViewGateway", ["DerivedResearchViewGateway"]], ["referenceRecordGateway", ["ReferenceRecordGateway"]],
      ["researchExportGateway", ["ResearchExportGateway", "ResearchExportTransport", "ResearchExportReport", "ResearchExportErrorCode"]],
    ];
    for (const [module, names] of legacyTypes) {
      const original = path.join(root, "apps/web/src/plugins/literature_library/public/contracts", module + ".ts");
      lines.push(`import type * as legacy_${module} from ${JSON.stringify(original)};`);
      for (const name of names) lines.push(`declare const legacy_${name}: legacy_${module}.${name}; declare const canonical_${name}: canonical.${name};`,
        `const acceptsCanonical_${name}: legacy_${module}.${name} = canonical_${name}; void acceptsCanonical_${name};`,
        `const acceptsLegacy_${name}: canonical.${name} = legacy_${name}; void acceptsLegacy_${name};`);
    }
    compile(directory, lines.join("\n"), true);
  });
});
