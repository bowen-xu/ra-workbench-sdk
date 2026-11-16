import {withCachedBuild} from "./build-artifacts.mjs";
import {runBuildCommand} from "./build-command.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import {assertLiteratureNativeBuildManifest, assertWritingProjectNativeBuildManifest, buildNativePlugin} from "./native-plugin-build.mjs";
import {verifyWritingPublicArtifact} from "./writing-public-artifact.mjs";

const root = process.cwd();
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const profiles = new Map([
  ["note_manager", {task: "A05", label: "note", receipt: "note-manager-build", manifest: "noteManagerManifest", wrapper: "build-note-manager-plugin.mjs"}],
  ["literature_library", {task: "C02", label: "literature", receipt: "literature-library-build", manifest: "literatureLibraryManifest", wrapper: "build-literature-library-plugin.mjs"}],
  ["writing_projects", {task: "C04", label: "writing", receipt: "writing-projects-build", manifest: "writingProjectsManifest", wrapper: "build-writing-projects-plugin.mjs"}],
]);

/** Built-in frontend projects share the original isolated artifact build. */
export async function buildFrontendPlugin(profileId, arguments_ = process.argv.slice(2)) {
  const receipt = await withCachedBuild({
    root, kind: "plugin", native: profileId !== "note_manager",
    inputs: ["src", "native", "scripts", "resources", "patches", "native-build.json", "package.json", "pnpm-lock.yaml",
      "pnpm-workspace.yaml", "sdk-dependency.json", "tsconfig.json", "vite.config.ts", "LICENSE", "NOTICE", ".cargo"],
    args: [profileId, ...arguments_.filter(value => value !== "--project-files")],
  }, context => buildFrontendPackage(profileId, arguments_, context));
  console.log(JSON.stringify({status: receipt.status, receipt: receipt.receipt, output: receipt.output, cacheHit: receipt.cacheHit}));
  return receipt;
}

async function buildFrontendPackage(profileId, arguments_, context) {
  let profile = profiles.get(profileId);
  if (!profile) throw new Error("frontend_plugin_build_profile_invalid");
  // The writing project's normal artifact includes its existing native domain.
  // Keep the explicit flag accepted for callers of the earlier C05 entry.
  const projectFiles = profileId === "writing_projects";
  if (arguments_.some(value => value !== "--offline" && !(projectFiles && value === "--project-files")))
    throw new Error(`Usage: node scripts/${profile.wrapper} [--offline]${profileId === "writing_projects" ? " [--project-files]" : ""}`);
  if (projectFiles) profile = {...profile, task: "C05-project-files"};
  const offline = arguments_.includes("--offline");
  const project = root;
  const production = path.join(project, "src");
  const staging = context.workDirectory;
  const receiptRoot = context.logDirectory;
  const stagedProject = path.join(staging, "plugin");
  const artifacts = path.join(staging, "artifacts");
  const require = createRequire(path.join(root, "package.json"));
  const ts = require("typescript");
  const mappings = new Map([
    ["core/contracts/plugins", ""],
    ["core/contracts/workbench", "workbench"],
    ["core/public/agentContext/AgentContextProvider", "agent-context"],
    ["core/public/agentContext/sourceNavigation", "source-navigation"],
    ["core/public/agentContext/useSourceNavigationHost", "source-navigation"],
    ["core/public/configuration", "configuration-hooks"],
    ["core/public/domainCapabilities", "domain-capabilities"],
    ["core/public/feedback", "feedback"],
    ["core/public/layout", "layout"],
    ["core/public/noteDiagnostics", "note-diagnostics"],
    ["core/public/noteDocuments", "note-documents"],
    ["core/public/noteResources", "note-resources"],
    ["core/public/noteStorage", "note-storage"],
    ["core/public/noteTransfer", "note-transfer"],
    ["core/public/overlay", "overlay"],
    ["core/public/platform", "platform"],
    ["core/public/reorder", "reorder"],
    ["core/public/workbench", "workbench"],
    ["core/public/workspaceState", "workspace-state"],
  ]);
  const receipt = {task: profile.task, status: "running", staging, commands: [], sources: [],
    scope: "Build the sole selected frontend source against independently packed public artifacts. Domain, desktop and lifecycle acceptance remain separate.",
    builder: {file: profile.wrapper, sha256: digest(await fs.readFile(path.join(root, "scripts", profile.wrapper)))},
    helper: {file: "scripts/frontend-plugin-build.mjs", sha256: digest(await fs.readFile(fileURLToPath(import.meta.url)))}};
  const frozenSurface = JSON.parse(await fs.readFile(path.join(root, ".dependencies/sdk/tooling/runtime-note-sdk-surface.json"), "utf8"));
  if (profileId === "writing_projects") receipt.firstPartyVerifier = {file: "scripts/writing-public-artifact.mjs",
    sha256: digest(await fs.readFile(path.join(root, ".dependencies/sdk/tooling/writing-public-artifact.mjs")))};
  const runtimeImports = new Map();
  const publicArchives = new Map();
  await fs.mkdir(receiptRoot, {recursive: true});
  await fs.mkdir(artifacts, {recursive: true});

  async function run(label, command, args, cwd = root) {
    if (command === "pnpm" && !args.includes("--config.verify-deps-before-run=false")) args = ["--config.verify-deps-before-run=false", ...args];
    const log = path.join(receiptRoot, label + ".log");
    const result = await runBuildCommand(label, command, args, {cwd}, log);
    receipt.commands.push({label, command, args, cwd, exitCode: result.status, log});
    if (result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.error?.code ?? "unknown"}); see ${log}`);
    return result.stdout;
  }

  async function json(file, value) {await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");}

  // A00 remains the historical consumer inventory. Match the same values after
  // their explicit migration to SDK imports, without rewriting source or adding
  // public exports to make an unexpected dependency pass.
  const canonicalModules = new Map([...mappings].filter(([module]) =>
    frozenSurface.modules.some(value => value.module === module && value.runtime.length)).map(([module, subpath]) =>
    ["@research-assistant/workbench-sdk" + (subpath ? "/" + subpath : ""), module]));
  for (const module of frozenSurface.modules) if (module.module.startsWith("@")) canonicalModules.set(module.module, module.module);
  const copied = new Set();
  async function copyPluginSource(original) {
    if (copied.has(original)) return;
    if (!original.startsWith(production + path.sep)) throw new Error("Private source escapes plugin: " + original);
    if (!(await fs.lstat(original)).isFile()) throw new Error("Plugin source must be a regular non-symlink file: " + original);
    copied.add(original);
    const bytes = await fs.readFile(original), source = bytes.toString("utf8");
    const destination = path.join(stagedProject, "src", path.relative(production, original));
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, bytes);
    const stagedBytes = await fs.readFile(destination);
    if (!bytes.equals(stagedBytes)) throw new Error("Frontend source changed during copy: " + original);
    receipt.sources.push({file: path.relative(root, original), sha256: digest(bytes), stagedSha256: digest(stagedBytes)});
    const parsed = /\.tsx?$/u.test(original) ? ts.createSourceFile(original, source, ts.ScriptTarget.Latest, true) : undefined;
    if (parsed) {
      for (const node of parsed.statements) {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)
          || !node.importClause || node.importClause.isTypeOnly) continue;
        const module = profileId === "note_manager" ? canonicalModules.get(node.moduleSpecifier.text) : node.moduleSpecifier.text;
        if (!module || module.startsWith(".") || (profileId === "note_manager"
          && !frozenSurface.modules.some(value => value.module === module))) continue;
        const names = runtimeImports.get(module) ?? new Set();
        if (node.importClause.name) names.add("default");
        if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) if (!element.isTypeOnly) names.add((element.propertyName ?? element.name).text);
        }
        runtimeImports.set(module, names);
      }
    }
    const dependencies = parsed ? ts.preProcessFile(source).importedFiles.map(value => value.fileName)
      : original.endsWith(".css") ? [...source.matchAll(/(?:@import\s+["']|url\(["']?)([^"')\s;]+)/gu)].map(value => value[1]) : [];
    if (parsed) {
      const visit = node => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Worker") {
          const url = node.arguments?.[0];
          if (!url || !ts.isNewExpression(url) || !ts.isIdentifier(url.expression) || url.expression.text !== "URL"
            || url.arguments?.length !== 2 || !ts.isStringLiteral(url.arguments[0])
            || !url.arguments[0].text.startsWith(".") || url.arguments[1].getText(parsed) !== "import.meta.url") {
            throw new Error("Unsupported frontend Worker source in " + original);
          }
          dependencies.push(url.arguments[0].text);
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
    }
    for (const dependency of dependencies) {
      if (!dependency.startsWith(".")) continue;
      const [resource, query] = dependency.split("?");
      if (query !== undefined && query !== "raw" && query !== "url") throw new Error("Unsupported frontend resource query: " + query);
      const target = path.resolve(path.dirname(original), resource);
      if (!target.startsWith(production + path.sep)) throw new Error("Private source escapes plugin: " + dependency);
      let resolved;
      for (const candidate of [target, target + ".ts", target + ".tsx", path.join(target, "index.ts"), path.join(target, "index.tsx")]) {
        if (await fs.stat(candidate).then(value => value.isFile(), () => false)) {resolved = candidate; break;}
      }
      if (!resolved) throw new Error("Missing plugin source dependency in " + original + ": " + dependency);
      await copyPluginSource(resolved);
    }
  }

  async function packagePublicDomain(name) {
    const distribution = JSON.parse(await fs.readFile(path.join(root, ".dependencies/sdk/sdk-artifacts.json"), "utf8"));
    const artifact = distribution.artifacts.find(value => value.name === "@research-assistant/" + name);
    if (!artifact) throw new Error("public_sdk_artifact_missing: " + name);
    const archive = path.join(root, ".dependencies/sdk/web", artifact.file);
    if (digest(await fs.readFile(archive)) !== artifact.sha256) throw new Error("public_sdk_artifact_changed: " + name);
    const directory = path.join(staging, "public", name);
    await fs.mkdir(directory, {recursive: true});
    await run("unpack-public-" + name, "tar", ["-xzf", archive, "--strip-components=1", "-C", directory]);
    publicArchives.set(name, {archive, sha256: artifact.sha256, compiled: directory});
    await fs.copyFile(archive, path.join(receiptRoot, name + ".tgz"));
    return archive;
  }

  try {
    // Let pnpm decode its own lock format. Pin the existing resolved dependency
    // edges, not newly chosen versions of transitive semver ranges in the stage.
    const lockBytes = await fs.readFile(path.join(root, "pnpm-lock.yaml"));
    const lockedTree = JSON.parse(await run("workspace-locked-tree", "pnpm", ["list", "--recursive", "--lockfile-only", "--depth", "Infinity", "--json"]));
    const pinnedEdges = new Map(), registry = new Set();
    const exactVersion = value => typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(value);
    function visitLocked(node, name = node.name, collectEdges = true) {
      if (exactVersion(node.version) && typeof node.resolved === "string" && /^https?:\/\//u.test(node.resolved)) registry.add(`${name}@${node.version}`);
      for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
        for (const [alias, dependency] of Object.entries(node[group] ?? {})) {
          if (collectEdges && exactVersion(node.version) && exactVersion(dependency.version)
            && typeof node.resolved === "string" && /^https?:\/\//u.test(node.resolved)) {
            const key = `${name}@${node.version}>${alias}`;
            const value = dependency.from !== alias ? `npm:${dependency.from}@${dependency.version}` : dependency.version;
            if (pinnedEdges.has(key) && pinnedEdges.get(key) !== value) throw new Error("frontend_lock_edge_ambiguous: " + key);
            pinnedEdges.set(key, value);
          }
          visitLocked(dependency, dependency.from ?? alias, collectEdges);
        }
      }
    }
    for (const project of lockedTree) visitLocked(project);
    if (!pinnedEdges.size || !registry.size) throw new Error("frontend_workspace_lock_empty");
    receipt.dependencyLock = {sha256: digest(lockBytes), pinnedEdges: Object.fromEntries([...pinnedEdges].sort()), registry: [...registry].sort()};
    await json(path.join(receiptRoot, "workspace-locked-tree.json"), lockedTree);

    await fs.mkdir(stagedProject, {recursive: true});
    for (const file of ["package.json", "tsconfig.json", "vite.config.ts"]) await fs.copyFile(path.join(project, file), path.join(stagedProject, file));
    if (profileId === "writing_projects") receipt.configuration = await Promise.all(["package.json", "tsconfig.json", "vite.config.ts"].map(async file => {
      const original = await fs.readFile(path.join(project, file)), staged = await fs.readFile(path.join(stagedProject, file));
      if (!original.equals(staged)) throw new Error("writing_build_configuration_copy_changed");
      return {file, sha256: digest(original), stagedSha256: digest(staged)};
    }));
    await copyPluginSource(path.join(production, "index.ts"));
    const codeCheck = "features/writing/editor/code-check";
    if (profileId === "writing_projects") {
      if (!copied.has(path.join(production, codeCheck, "overleafCodeCheck.worker.ts"))) throw new Error("writing_code_check_worker_missing");
      for (const file of ["COPYING", "OVERLEAF_CODE_CHECK_NOTICE.md"]) await copyPluginSource(path.join(production, codeCheck, file));
    }
    receipt.runtimeSurface = frozenSurface.modules.filter(value => value.runtime.length).map(value => ({
      module: value.module, expected: [...value.runtime,
        ...frozenSurface.runtimeExtensions.filter(extension => extension.module === value.module).flatMap(extension => extension.runtime)],
      actual: [...(runtimeImports.get(value.module) ?? [])].sort(),
    }));
    receipt.actualRuntimeImports = [...runtimeImports].map(([module, values]) => ({module, values: [...values].sort()}));
    for (const value of profileId === "note_manager" ? receipt.runtimeSurface : []) {
      if (value.expected.length !== value.actual.length || value.expected.some(name => !value.actual.includes(name))) {
        throw new Error(`Frozen runtime surface changed for ${value.module}: expected ${value.expected.join(",")}; actual ${value.actual.join(",")}`);
      }
    }
    const core = await packagePublicDomain("core"), writing = await packagePublicDomain("writing"), data = await packagePublicDomain("data");
    const sdk = await packagePublicDomain("workbench-sdk");
    const metadata = JSON.parse(await fs.readFile(path.join(stagedProject, "package.json"), "utf8"));
    metadata.scripts = {typecheck: "tsc -p tsconfig.json", build: "vite build"};
    metadata.dependencies["@research-assistant/core"] = "file:" + core;
    metadata.dependencies["@research-assistant/data"] = "file:" + data;
    metadata.dependencies["@research-assistant/writing"] = "file:" + writing;
    metadata.dependencies["@research-assistant/workbench-sdk"] = "file:" + sdk;
    await json(path.join(stagedProject, "package.json"), metadata);
    // pnpm 11 reads overrides from workspace settings, including for a standalone
    // project. Keep this workspace outside the repository and resolve transitive
    // public package requests to the exact tarballs we just compiled and packed.
    const patch = profileId === "literature_library" ? {id: "pdfjs-dist@6.1.200", file: "patches/pdfjs-dist@6.1.200.patch"}
      : profileId === "writing_projects" ? {id: "@codemirror/autocomplete@6.20.3", file: "patches/@codemirror__autocomplete@6.20.3.patch"} : undefined;
    await fs.writeFile(path.join(stagedProject, "pnpm-workspace.yaml"), [
      "packages:", "  - .", "overrides:",
    ...[...pinnedEdges].sort().map(([key, value]) => "  " + JSON.stringify(key) + ": " + JSON.stringify(value)),
      "  '@research-assistant/core': " + JSON.stringify("file:" + core),
      "  '@research-assistant/writing': " + JSON.stringify("file:" + writing),
      "  '@research-assistant/data': " + JSON.stringify("file:" + data),
      ...(patch ? ["patchedDependencies:", "  " + JSON.stringify(patch.id) + ": " + JSON.stringify(patch.file)] : []), "",
    ].join("\n"));
    if (patch) {
      const original = await fs.readFile(path.join(root, patch.file));
      await fs.mkdir(path.join(stagedProject, "patches"));
      await fs.writeFile(path.join(stagedProject, patch.file), original);
      receipt.patch = {file: patch.file, sha256: digest(original), stagedSha256: digest(await fs.readFile(path.join(stagedProject, patch.file)))};
    }
    // Resolve the existing cache before changing cwd. pnpm 11's default store
    // can differ in the isolated project; only content-addressed dependencies,
    // never workspace source aliases, are shared with that project.
    const storeDir = (await run("store-path", "pnpm", ["store", "path"])).trim();
    if (!path.isAbsolute(storeDir) || /[\r\n]/u.test(storeDir)) throw new Error("frontend_package_store_invalid");
    receipt.storeDir = storeDir;
    await run("install", "pnpm", ["--store-dir", storeDir, "install", ...(offline ? ["--offline"] : []), "--ignore-scripts"], stagedProject);
    const installedTree = JSON.parse(await run("installed-locked-tree", "pnpm", ["list", "--lockfile-only", "--depth", "Infinity", "--json"], stagedProject));
    const workspaceRegistry = new Set(registry);
    registry.clear();
    for (const project of installedTree) visitLocked(project, project.name, false);
    const unexpected = [...registry].filter(value => !workspaceRegistry.has(value));
    if (unexpected.length) throw new Error("frontend_dependency_not_in_workspace_lock: " + unexpected.join(", "));
    if (!lockBytes.equals(await fs.readFile(path.join(root, "pnpm-lock.yaml")))) throw new Error("frontend_workspace_lock_changed");
    receipt.dependencyLock.installedRegistry = [...registry].sort();
    const installedSdk = await import(pathToFileURL(path.join(stagedProject, "node_modules/@research-assistant/workbench-sdk/lib/index.js")).href);
    const manifestSource = await fs.readFile(path.join(production, "public/manifest.ts"), "utf8");
    const emittedManifest = path.join(stagedProject, "production-manifest.mjs");
    await fs.writeFile(emittedManifest, ts.transpileModule(manifestSource, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText);
    const module = await import(pathToFileURL(emittedManifest).href);
    let manifest = installedSdk.decodePluginManifest({...module[profile.manifest], formatVersion: profileId === "writing_projects" ? 2 : 1, version: metadata.version,
      entry: "entry.js", styles: ["style.css"], uiRuntime: installedSdk.WORKBENCH_UI_RUNTIME});
    installedSdk.assertPluginCompatibility(manifest);
    let incompatible;
    try {installedSdk.assertPluginCompatibility({...manifest, apiVersion: 2});}
    catch (error) {if (error instanceof installedSdk.PluginPackageError) incompatible = error.diagnostic; else throw error;}
    if (incompatible?.code !== "plugin_api_incompatible" || incompatible.pluginId !== manifest.id) throw new Error("Incompatible API was not rejected with its plugin identity");
    receipt.compatibility = {accepted: {pluginId: manifest.id, apiVersion: manifest.apiVersion}, rejected: incompatible, entryEvaluated: false};
    await run("typecheck", "pnpm", ["exec", "tsc", "-p", "tsconfig.json", "--listFiles"], stagedProject);
    const loaded = await fs.readFile(path.join(receiptRoot, "typecheck.log"), "utf8");
    const compilerFiles = loaded.split(/\r?\n/u).filter(file => path.isAbsolute(file));
    if (compilerFiles.some(file => !file.startsWith(staging + path.sep))
      || /\/node_modules\/@research-assistant\/(?:core|data|writing)\/src\//u.test(loaded)) {
      throw new Error("plugin_type_closure_violation: application or unbuilt public source entered the independent consumer");
    }
    await run("build", "pnpm", ["exec", "vite", "build"], stagedProject);
    const output = context.output;
    await fs.rm(output, {recursive: true, force: true});
    await fs.cp(path.join(stagedProject, "build"), output, {recursive: true});
    await fs.rename(path.join(output, "source-closure.json"), path.join(receiptRoot, "source-closure.json"));
    await fs.copyFile(path.join(stagedProject, "pnpm-lock.yaml"), path.join(receiptRoot, "installed-pnpm-lock.yaml"));
    // Audit only libraries actually bundled by the production graph. Shared
    // Core libraries stay external and retain their existing Core distribution.
    const closure = JSON.parse(await fs.readFile(path.join(receiptRoot, "source-closure.json"), "utf8"));
    if (profileId === "writing_projects") {
      await fs.rename(path.join(output, "worker-source-closure.json"), path.join(receiptRoot, "worker-source-closure.json"));
      const worker = JSON.parse(await fs.readFile(path.join(receiptRoot, "worker-source-closure.json"), "utf8"));
      if (!worker.modules.includes(path.join(stagedProject, "src", codeCheck, "overleafCodeCheck.worker.ts"))) throw new Error("writing_worker_build_closure_missing");
      closure.modules = [...new Set([...closure.modules, ...worker.modules])];
    }
    const libraries = new Map();
    for (const source of closure.modules.filter(file => file.includes("/node_modules/"))) {
      let directory = path.dirname(source.split("?")[0]);
      let found = false;
      while (directory.startsWith(stagedProject + path.sep)) {
        const metadataFile = path.join(directory, "package.json");
        const library = await fs.readFile(metadataFile, "utf8").then(JSON.parse, () => undefined);
        if (library?.name && library.version) {libraries.set(directory, library); found = true; break;}
        directory = path.dirname(directory);
      }
      if (!found) throw new Error("frontend_bundled_package_metadata_missing: " + source);
    }
    receipt.licenses = [];
    const firstPartyWriting = profileId === "writing_projects" ? await verifyWritingPublicArtifact({...publicArchives.get("writing"),
      installed: path.join(stagedProject, "node_modules/@research-assistant/writing")}) : undefined;
    if (firstPartyWriting) receipt.firstPartyPublicArtifacts = [firstPartyWriting];
    for (const [directory, library] of libraries) {
      if (firstPartyWriting && library.name === "@research-assistant/writing" && await fs.realpath(directory) === firstPartyWriting.directory) continue;
      const licenses = (await fs.readdir(directory)).filter(name => /^licen[cs]e(?:\.|$)/iu.test(name));
      if (!licenses.length) throw new Error("frontend_bundled_license_missing: " + library.name);
      for (const name of licenses) {
        const bytes = await fs.readFile(path.join(directory, name));
        const file = path.posix.join("licenses", library.name.replaceAll("/", "_") + "-" + library.version, name);
        await fs.mkdir(path.dirname(path.join(output, file)), {recursive: true});
        await fs.writeFile(path.join(output, file), bytes);
        receipt.licenses.push({name: library.name, version: library.version, license: library.license, file, sha256: digest(bytes)});
      }
    }
    if (profileId === "writing_projects") {
      for (const name of ["COPYING", "OVERLEAF_CODE_CHECK_NOTICE.md", "overleafCodeCheck.worker.ts"]) {
        const source = path.join(production, codeCheck, name), bytes = await fs.readFile(source);
        const frozen = receipt.sources.find(value => value.file === path.relative(root, source));
        if (frozen?.sha256 !== digest(bytes)) throw new Error("writing_code_check_source_changed");
        const file = path.posix.join("licenses/overleaf-code-check", name);
        await fs.mkdir(path.dirname(path.join(output, file)), {recursive: true});
        await fs.writeFile(path.join(output, file), bytes);
        receipt.licenses.push({name: "overleaf-code-check", version: "28ad3b03b71cb4311decdcb55c36b33ec10d72db", license: "AGPL-3.0-only", file, sha256: digest(bytes)});
      }
    }
    if (profileId === "literature_library" || projectFiles) {
      const native = await buildNativePlugin(profileId, ["--offline", ...(projectFiles ? ["--project-files"] : [])]);
      if (native.status !== "passed") throw new Error(profile.label + "_native_build_failed");
      const nativeManifest = JSON.parse(await fs.readFile(path.join(native.packageRoot, "manifest.json"), "utf8"));
      if (projectFiles) assertWritingProjectNativeBuildManifest(nativeManifest);
      else assertLiteratureNativeBuildManifest(nativeManifest);
      const nativeReceipt = native.receipt;
      receipt.nativeBuild = {receipt: nativeReceipt, sha256: digest(await fs.readFile(nativeReceipt)), artifacts: native.artifacts};
      for (const artifact of native.artifacts.filter(value => value.file !== "manifest.json")) {
        const bytes = await fs.readFile(path.join(native.packageRoot, artifact.file));
        if (digest(bytes) !== artifact.sha256) throw new Error(profile.label + "_native_artifact_changed");
        const target = path.join(output, artifact.file);
        if (await fs.lstat(target).then(() => true, () => false)) throw new Error(profile.label + "_native_artifact_collision");
        await fs.mkdir(path.dirname(target), {recursive: true});
        await fs.copyFile(path.join(native.packageRoot, artifact.file), target);
        await fs.chmod(target, (await fs.stat(path.join(native.packageRoot, artifact.file))).mode & 0o777);
        if (digest(await fs.readFile(target)) !== artifact.sha256) throw new Error(profile.label + "_native_copy_changed");
      }
      const capabilities = [...manifest.provides, ...nativeManifest.provides];
      manifest = installedSdk.decodePluginManifest({...manifest, formatVersion: 2, native: nativeManifest.native,
        provides: capabilities});
      if (manifest.provides.length !== capabilities.length || capabilities.some((capability, index) =>
        manifest.provides[index]?.id !== capability.id || manifest.provides[index]?.version !== capability.version))
        throw new Error(profile.label + "_combined_profile_mismatch");
      installedSdk.assertPluginCompatibility(manifest);
    }
    await json(path.join(output, "manifest.json"), manifest);
    receipt.compatibility.finalManifest = {pluginId: manifest.id, apiVersion: manifest.apiVersion,
      formatVersion: manifest.formatVersion, ...(manifest.native ? {nativeProtocolVersion: manifest.native.protocolVersion} : {})};
    receipt.compatibility.sdkMetadataOnly = true;
    receipt.compatibility.coreNativeLoaderVerified = false;
    receipt.artifacts = [];
    let entries = 0;
    async function audit(directory) {
      for (const name of (await fs.readdir(directory)).sort()) {
        if (++entries > 4096) throw new Error("frontend_output_exceeds_4096_entries");
        const file = path.join(directory, name), info = await fs.lstat(file);
        if (info.isSymbolicLink()) throw new Error("frontend_output_symlink");
        if (info.isDirectory()) await audit(file);
        else if (info.isFile()) {
          if (info.size > 64 * 1024 * 1024) throw new Error("frontend_output_resource_exceeds_64mib");
          receipt.artifacts.push({file: path.relative(output, file).split(path.sep).join("/"), bytes: info.size, mode: info.mode & 0o777, sha256: digest(await fs.readFile(file))});
        }
        else throw new Error("frontend_output_not_regular");
      }
    }
    await audit(output);
    if (profileId === "writing_projects") {
      const workers = receipt.artifacts.filter(value => /^assets\/overleafCodeCheck\.worker-[^.]+\.js$/u.test(value.file));
      if (workers.length !== 1) throw new Error("writing_code_check_artifact_missing");
      receipt.worker = {source: path.posix.join("plugins/writing_projects/src", codeCheck, "overleafCodeCheck.worker.ts"),
        artifact: workers[0], closure: path.join(receiptRoot, "worker-source-closure.json")};
    }
    if (receipt.artifacts.reduce((sum, value) => sum + value.bytes, 0) > 256 * 1024 * 1024) throw new Error("frontend_package_exceeds_256mib");
    receipt.publicArtifacts = await Promise.all(["core", "writing", "data", "workbench-sdk"].map(async name => ({file: name + ".tgz", sha256: digest(await fs.readFile(path.join(receiptRoot, name + ".tgz")))})));
    receipt.status = "passed";
    receipt.output = output;
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await json(path.join(receiptRoot, "receipt.json"), receipt);
    if (receipt.error) console.error(receipt.error);
  }

  return receipt;
}
