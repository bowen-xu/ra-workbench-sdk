import {runBuildCommand} from "./build-command.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = process.cwd();
const profileFile = path.join(root, "native-build.json");
const ownProfile = await fs.readFile(profileFile, "utf8").then(JSON.parse).catch(error => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
const profiles = new Map(ownProfile ? [[ownProfile.id, ownProfile]] : []);
const maxResourceBytes = 64 * 1024 * 1024;
const maxPackageBytes = 256 * 1024 * 1024;
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const inside = (directory, file) => file === directory || file.startsWith(directory + path.sep);

/** The finite build profile is artifact validation, not Core authorization. */
export function assertNativeBuildManifest(manifest, profile) {
  const expected = [profile.capability, ...(profile.extraCapabilities ?? [])];
  if (manifest?.id !== profile.id || manifest.formatVersion !== 2
    || manifest.native?.protocolVersion !== profile.protocolVersion
    || !Array.isArray(manifest.provides) || manifest.provides.length !== expected.length
    || expected.some((id, index) => manifest.provides[index]?.id !== id || manifest.provides[index]?.version !== 1)) {
    throw new Error(profile.label + "_native_profile_mismatch");
  }
}

export function assertLiteratureNativeBuildManifest(manifest) {
  assertNativeBuildManifest(manifest, profiles.get("literature_library"));
}

export function projectFilesProfile(profile) {
  return {...profile, capability: "writing.project-files", protocolVersion: 2,
    extraCapabilities: ["writing.import-preview"], resources: profile.projectResources ?? profile.resources, task: "C05-project-files"};
}

export function assertWritingProjectNativeBuildManifest(manifest) {
  assertNativeBuildManifest(manifest, projectFilesProfile(profiles.get("writing_projects")));
}

// Rust dep-info uses Makefile escaped spaces and continuation lines. Only the
// right side of each rule is source evidence; target names are not inputs.
export function dependencyPaths(text) {
  const dependencies = new Set();
  for (const line of text.replace(/\\\r?\n/gu, "").split(/\r?\n/u)) {
    const separator = line.indexOf(": ");
    if (separator < 0) continue;
    let token = "";
    let escaped = false;
    for (const character of line.slice(separator + 2) + " ") {
      if (escaped) {token += character; escaped = false;}
      else if (character === "\\") escaped = true;
      else if (/\s/u.test(character)) {if (token) dependencies.add(token); token = "";}
      else token += character;
    }
  }
  return [...dependencies].sort();
}

export async function buildNativePlugin(profileId, arguments_ = process.argv.slice(2)) {
  let profile = profiles.get(profileId);
  if (!profile) throw new Error("native_plugin_build_profile_invalid");
  const projectFiles = profileId === "writing_projects" && arguments_.includes("--project-files");
  if (projectFiles) profile = projectFilesProfile(profile);
  const localProjects = [profile.project, ".dependencies/sdk/native/workbench-native-sdk", ".dependencies/sdk/native/agent-api", ".dependencies/sdk/native/semantic-engine-api", ...(profile.id === "writing_projects" ? [".dependencies/sdk/native/note-query"] : [])];
  if (arguments_.some(value => value !== "--offline" && !(projectFiles && value === "--project-files"))) throw new Error(`Usage: node ${profile.wrapper} [--offline]${profileId === "writing_projects" ? " [--project-files]" : ""} (always locked/offline)`);
  const platforms = {darwin: "macos", linux: "linux"};
  const architectures = {arm64: "aarch64", x64: "x86_64"};
  const nativeOs = platforms[process.platform], nativeArch = architectures[process.arch];
  if (!nativeOs || !nativeArch) throw new Error(profile.label + "_native_platform_unsupported: only native Unix build targets are supported");
  const staging = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `research-${profile.label}-native-`)));
  const receiptBase = path.join(root, `.tmp/runtime-plugins/${profile.label}-native-build`);
  const receiptRoot = path.join(receiptBase, path.basename(staging));
  const packageRoot = path.join(receiptRoot, `packages/${profile.id}`);
  const project = path.join(staging, localProjects[0]);
  const target = path.join(staging, "target");
  const receipt = {task: profile.task, status: "running", staging, packageRoot, commands: [], sources: [],
    scope: "Independent native binary and package only; no application installer, publication or desktop acceptance.",
    nativePlatform: {os: nativeOs, arch: nativeArch},
    builder: {file: profile.wrapper, sha256: digest(await fs.readFile(path.join(root, profile.wrapper)))},
    buildHelper: {file: "scripts/native-plugin-build.mjs", sha256: digest(await fs.readFile(fileURLToPath(import.meta.url)))}};
  const json = async (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n");
  await fs.mkdir(receiptRoot, {recursive: true});

  async function run(label, command, args, cwd = project, extraEnv = {}) {
    const log = path.join(receiptRoot, label + ".log");
    const result = await runBuildCommand(label, command, args, {cwd, env: {...process.env, ...extraEnv}}, log);
    receipt.commands.push({label, command, args, cwd, exitCode: result.status, log});
    if (result.status !== 0) throw new Error(`${label} failed (${result.status ?? result.error?.code ?? "unknown"}); see ${log}`);
    return result.stdout;
  }

  async function copySource(relative) {
    const original = path.join(root, relative), destination = path.join(staging, relative);
    let info = await fs.lstat(original);
    if (info.isSymbolicLink()) throw new Error(profile.label + "_native_source_symlink: " + relative);
    if (info.isDirectory()) {
      await fs.mkdir(destination, {recursive: true});
      for (const name of (await fs.readdir(original)).sort()) {
        if (["target", ".git", ".DS_Store"].includes(name)) continue;
        await copySource(path.posix.join(relative, name));
      }
    } else if (info.isFile()) {
      const originalBytes = await fs.readFile(original);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.writeFile(destination, originalBytes);
      const stagedBytes = await fs.readFile(destination);
      const sha256 = digest(originalBytes), stagedSha256 = digest(stagedBytes);
      if (sha256 !== stagedSha256) throw new Error(profile.label + "_native_source_copy_changed: " + relative);
      receipt.sources.push({file: relative, sha256, stagedSha256, bytes: originalBytes.length});
    } else throw new Error(profile.label + "_native_source_not_regular: " + relative);
  }

  async function copyLicense(source, destination) {
    const bytes = await fs.readFile(source);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.writeFile(destination, bytes);
    return {file: path.relative(packageRoot, destination).split(path.sep).join("/"), sha256: digest(bytes), bytes: bytes.length};
  }

  try {
    receipt.buildProfile = {file: "native-build.json", sha256: digest(await fs.readFile(profileFile))};
    for (const project of localProjects) await copySource(project);
    receipt.toolchain = await run("toolchain", "rustc", ["-Vv"]);
    const hostTriple = receipt.toolchain.match(/^host: (\S+)$/mu)?.[1];
    if (!hostTriple) throw new Error(profile.label + "_native_toolchain_host_missing");
    if (!hostTriple.startsWith(nativeArch + "-") || (nativeOs === "macos" ? !hostTriple.endsWith("-apple-darwin") : !hostTriple.includes("-linux-"))) {
      throw new Error(profile.label + "_native_toolchain_platform_mismatch");
    }
    receipt.nativePlatform.target = hostTriple;
    receipt.cargo = await run("cargo-version", "cargo", ["-V"]);
    const metadata = JSON.parse(await run("metadata", "cargo", ["metadata", "--locked", "--offline", "--format-version", "1", "--filter-platform", hostTriple]));
    const local = metadata.packages.filter(value => value.source === null);
    const allowedNames = new Set([profile.crate, "research-workbench-native-sdk", "research-agent-api", "research-semantic-engine-api", ...(profile.id === "writing_projects" ? ["research-note-query"] : [])]);
    if (local.length !== allowedNames.size || local.some(value => !allowedNames.has(value.name)
      || !inside(staging, value.manifest_path))) throw new Error(profile.label + "_native_source_closure_invalid: unexpected local crate");
    receipt.dependencies = metadata.packages.map(value => ({name: value.name, version: value.version,
      source: value.source, manifestPath: value.manifest_path, license: value.license, licenseFile: value.license_file}));
    const buildOutput = await run("build", "cargo", ["build", "--release", "--locked", "--offline", "--target", hostTriple, "--bin", profile.binary, "--message-format", "json"], project,
      {CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "0"});
    const compilerArtifacts = buildOutput.split("\n").filter(Boolean).map(line => JSON.parse(line))
      .filter(value => value.reason === "compiler-artifact");
    await json(path.join(receiptRoot, "compiler-artifacts.json"), compilerArtifacts);
    const binaryArtifact = compilerArtifacts.find(value => value.target.name === profile.binary && value.executable);
    if (!binaryArtifact || !inside(target, binaryArtifact.executable)) throw new Error(profile.label + "_native_binary_missing");
    const dependenciesDirectory = path.join(path.dirname(binaryArtifact.executable), "deps");
    receipt.depInfo = [];
    const actualSources = new Set();
    const prefixes = [...allowedNames].map(name => name.replaceAll("-", "_") + "-");
    prefixes.push(profile.binary.replaceAll("-", "_") + "-");
    for (const file of (await fs.readdir(dependenciesDirectory)).sort()) {
      if (!file.endsWith(".d") || !prefixes.some(prefix => file.startsWith(prefix))) continue;
      const original = path.join(dependenciesDirectory, file), bytes = await fs.readFile(original);
      await fs.copyFile(original, path.join(receiptRoot, file));
      const inputs = await Promise.all(dependencyPaths(bytes.toString("utf8")).map(value => fs.realpath(path.resolve(project, value))));
      for (const input of inputs) {
        if (inside(root, input)) throw new Error(profile.label + "_native_private_source_entered_build: " + input);
        if (inside(staging, input) && !inside(target, input)) actualSources.add(input);
      }
      receipt.depInfo.push({file, sha256: digest(bytes), inputs});
    }
    if (receipt.depInfo.length !== prefixes.length || !actualSources.size) throw new Error(profile.label + "_native_dep_info_incomplete");
    for (const source of receipt.projectResourceMetadata ?? []) {
      if (source.sha256 !== digest(await fs.readFile(path.join(root, source.file))))
        throw new Error("writing_native_resource_metadata_changed_during_build: " + source.file);
    }
    const sourceByPath = new Map(receipt.sources.map(source => [path.join(staging, source.file), source]));
    receipt.compiledSources = [];
    for (const file of [...actualSources].sort()) {
      const source = sourceByPath.get(file);
      if (!source || source.stagedSha256 !== digest(await fs.readFile(file))) throw new Error(profile.label + "_native_unrecorded_source: " + file);
      receipt.compiledSources.push(source);
    }
    // A concurrent edit cannot turn this receipt into evidence for newer bytes.
    for (const source of receipt.sources) {
      if (source.sha256 !== digest(await fs.readFile(path.join(root, source.file)))) throw new Error(profile.label + "_native_source_changed_during_build: " + source.file);
    }
    if (receipt.paperContextResourceMetadata && receipt.paperContextResourceMetadata.sha256
      !== digest(await fs.readFile(path.join(root, receipt.paperContextResourceMetadata.file))))
      throw new Error("literature_native_resource_metadata_changed_during_build: " + receipt.paperContextResourceMetadata.file);
    if (receipt.contextCatalogResourceMetadata && receipt.contextCatalogResourceMetadata.sha256
      !== digest(await fs.readFile(path.join(root, receipt.contextCatalogResourceMetadata.file))))
      throw new Error("literature_native_resource_metadata_changed_during_build: " + receipt.contextCatalogResourceMetadata.file);

    if (receipt.contextMetadataResourceMetadata && receipt.contextMetadataResourceMetadata.sha256
      !== digest(await fs.readFile(path.join(root, receipt.contextMetadataResourceMetadata.file))))
      throw new Error("literature_native_resource_metadata_changed_during_build: " + receipt.contextMetadataResourceMetadata.file);

    const nativeEntry = `native/${nativeOs}-${nativeArch}/${profile.binary}`;
    const executable = path.join(packageRoot, nativeEntry);
    const binaryBytes = await fs.readFile(binaryArtifact.executable);
    if (binaryBytes.length > maxResourceBytes) throw new Error(profile.label + "_native_binary_exceeds_64mib");
    await fs.mkdir(path.dirname(executable), {recursive: true});
    await fs.writeFile(executable, binaryBytes, {mode: 0o755});
    receipt.binary = {file: nativeEntry, sha256: digest(binaryBytes), bytes: binaryBytes.length};
    receipt.licenses = [];
    for (const package_ of metadata.packages) {
      const directory = path.dirname(package_.manifest_path);
      const licenseFiles = new Set((await fs.readdir(directory)).filter(name => /^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:[._-]|$)/iu.test(name)));
      if (package_.license_file) licenseFiles.add(package_.license_file);
      const files = [];
      for (const name of [...licenseFiles].sort()) {
        const source = path.resolve(directory, name), stat = await fs.lstat(source);
        if (!inside(directory, source) || stat.isSymbolicLink()) throw new Error(profile.label + "_native_license_path_invalid");
        if (stat.isFile()) files.push(await copyLicense(source, path.join(packageRoot, "licenses/dependencies", `${package_.name}-${package_.version}`, path.basename(name))));
      }
      receipt.licenses.push({name: package_.name, version: package_.version, license: package_.license, files});
    }
    for (const name of ["LICENSE", "NOTICE"]) await copyLicense(path.join(staging, ".dependencies/sdk/native/agent-api/third-party/codex", name), path.join(packageRoot, "licenses/codex", name));
    await json(path.join(packageRoot, "licenses/dependencies.json"), receipt.licenses);
    const nativePackage = local.find(value => value.name === profile.crate);
    receipt.resources = [];
    for (const name of profile.resources) {
      const relative = path.posix.join(profile.project, "data", name);
      const bytes = await fs.readFile(path.join(staging, relative));
      if (digest(bytes) !== digest(await fs.readFile(path.join(root, relative)))) throw new Error(profile.label + "_native_resource_changed: " + relative);
      const destination = path.join(packageRoot, "data", name);
      await fs.mkdir(path.dirname(destination), {recursive: true});
      await fs.writeFile(destination, bytes);
      if (digest(bytes) !== digest(await fs.readFile(destination))) throw new Error(profile.label + "_native_resource_copy_changed: " + name);
      receipt.resources.push({source: relative, file: "data/" + name, sha256: digest(bytes), bytes: bytes.length,
        endsWithNewline: bytes.at(-1) === 10});
    }

    // Reuse the public SDK's production manifest decoder and composition rules.
    // Transpilation removes only TS syntax; no App or private module is loaded.
    const require = createRequire(path.join(root, "package.json"));
    const validators = {
      manifest: await import(pathToFileURL(require.resolve("@research-assistant/workbench-sdk")).href),
      composition: await import(pathToFileURL(require.resolve("@research-assistant/workbench-sdk/composition")).href),
    };
    const manifest = validators.manifest.decodePluginManifest({formatVersion: 2, id: profile.id, version: nativePackage.version,
      apiVersion: 1, provides: [profile.capability, ...(profile.extraCapabilities ?? [])].map(id => ({id, version: 1})),
      dependencies: {required: [], optional: []}, consumes: {required: [], optional: []},
      native: {protocolVersion: profile.protocolVersion, os: nativeOs, arch: nativeArch, entry: nativeEntry}});
    if (profile.id === "literature_library") assertLiteratureNativeBuildManifest(manifest);
    validators.manifest.assertPluginCompatibility(manifest);
    validators.composition.resolveBuiltinPlugins([manifest], [manifest.id], []);
    await json(path.join(packageRoot, "manifest.json"), manifest);
    receipt.manifest = manifest;
    receipt.artifacts = [];
    let packageEntries = 0;
    async function auditPackage(directory) {
      for (const name of (await fs.readdir(directory)).sort()) {
        packageEntries += 1;
        if (packageEntries > 4096) throw new Error(profile.label + "_native_package_exceeds_4096entries");
        const file = path.join(directory, name), stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) throw new Error(profile.label + "_native_output_symlink");
        if (stat.isDirectory()) await auditPackage(file);
        else if (stat.isFile()) {
          if (stat.size > maxResourceBytes) throw new Error(profile.label + "_native_output_exceeds_64mib");
          receipt.artifacts.push({file: path.relative(packageRoot, file).split(path.sep).join("/"), bytes: stat.size, sha256: digest(await fs.readFile(file))});
        } else throw new Error(profile.label + "_native_output_not_regular");
      }
    }
    await auditPackage(packageRoot);
    receipt.packageEntries = packageEntries;
    receipt.packageBytes = receipt.artifacts.reduce((total, file) => total + file.bytes, 0);
    if (receipt.packageBytes > maxPackageBytes) throw new Error(profile.label + "_native_package_exceeds_256mib");
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    await json(path.join(receiptRoot, "receipt.json"), receipt);
    await json(path.join(receiptBase, "latest.json"), {receipt: path.join(receiptRoot, "receipt.json"), status: receipt.status});
    console.log(JSON.stringify({status: receipt.status, receipt: path.join(receiptRoot, "receipt.json"), packages: path.join(receiptRoot, "packages"), staging}));
    if (receipt.error) console.error(receipt.error);
  }
  return receipt;
}
