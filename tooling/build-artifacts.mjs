import fs from "node:fs/promises";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const tooling = path.dirname(fileURLToPath(import.meta.url));

async function sourceFiles(root, inputs, exclude) {
  try {
    const project = execFileSync("git", ["rev-parse", "--show-toplevel"], {cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
    if (await fs.realpath(project) === await fs.realpath(root)) {
      return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        {cwd: root, stdio: ["ignore", "pipe", "pipe"]}).toString().split("\0").filter(Boolean);
    }
  } catch (error) {
    if (error.status !== 128 && error.code !== "ENOENT") throw error;
  }
  // Source archives and isolated build fixtures also work without a Git checkout.
  const roots = inputs.length ? inputs : ["src", "scripts", "tooling", "packages", "apps", "patches", "resources", "native",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.base.json", "vite.config.ts",
    "native-build.json", "sdk-dependency.json", "LICENSE", "NOTICE", ".gitignore", ".cargo"];
  const ignored = new Set([".git", "node_modules", ".cache", ".generated", "artifacts", ".tmp", ".dependencies", "confidential"]);
  async function visit(relative) {
    if (relative.split("/").some(part => ignored.has(part))) return [];
    if (exclude.some(input => relative === input || relative.startsWith(input + "/"))) return [];
    const info = await fs.lstat(path.join(root, relative)).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return [];
    if (!info.isDirectory()) return [relative];
    const name = path.posix.basename(relative);
    const manifest = name === "target" ? "Cargo.toml" : "package.json";
    if (["target", "build", "dist", "lib", "out"].includes(name)) {
      const generated = await fs.access(path.join(root, path.dirname(relative), manifest)).then(() => true, error => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
      if (generated) return [];
    }
    const files = await Promise.all((await fs.readdir(path.join(root, relative))).map(name => visit(path.posix.join(relative, name))));
    return files.flat();
  }
  return (await Promise.all(roots.map(visit))).flat();
}

export async function buildInputFingerprint(root, {kind, args = [], inputs = [], exclude = [], toolchains = true, native = false}) {
  const fingerprint = createHash("sha256");
  fingerprint.update(JSON.stringify({kind, exclude, args: args.filter(value => value !== "--offline"),
    platform: process.platform, arch: process.arch, node: process.version,
    environment: Object.entries(process.env).filter(([key]) => key !== "CARGO_NET_OFFLINE" && /^(?:RUST|CARGO|CC$|CXX$|CFLAGS$|CXXFLAGS$|MACOSX_|NODE_OPTIONS$|NODE_ENV$|VITE_|RESEARCH_ASSISTANT_PREVIEW_HOST$|NOTE_QUERY_|npm_config_(?:production|optional|arch|platform)$)/u.test(key)).sort()}));
  if (toolchains) {
    const commands = [["pnpm", ["--version"]]];
    if (native || ["native", "sdk", "workbench-native"].includes(kind)) {
      commands.push([process.env.NOTE_QUERY_RUSTC ?? process.env.RUSTC ?? "rustc", ["-Vv"]], ["cargo", ["-V"]]);
    }
    if (kind === "sdk" && process.env.NOTE_QUERY_WASM_BINDGEN) commands.push([process.env.NOTE_QUERY_WASM_BINDGEN, ["--version"]]);
    if (native || ["native", "workbench-native"].includes(kind)) {
      for (const command of [process.env.CC ?? "cc", process.env.CXX ?? "c++"]) {
        try {fingerprint.update(command).update(execFileSync(command, ["--version"], {cwd: root, stdio: ["ignore", "pipe", "pipe"]}));}
        catch (error) {if (error.code !== "ENOENT") throw error;}
      }
    }
    for (const [command, parameters] of commands) {
      fingerprint.update(execFileSync(command, parameters, {cwd: root}));
    }
  }
  const files = [...new Set(await sourceFiles(root, inputs, exclude))].sort()
    .filter(file => !file.split("/").includes("confidential"))
    .filter(file => !exclude.some(input => file === input || file.startsWith(input + "/")))
    .filter(file => inputs.length === 0 || inputs.some(input => file === input || file.startsWith(input + "/")));
  for (const file of files) {
    fingerprint.update(file);
    const stat = await fs.lstat(path.join(root, file)).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error("build_source_symlink: " + file);
    fingerprint.update(String(stat?.mode ?? "deleted"));
    if (stat) fingerprint.update(hash(await fs.readFile(path.join(root, file))));
  }
  if (["workbench-web", "preview-host", "api-test-host"].includes(kind)) {
    for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
      const bytes = await fs.readFile(path.join(root, "apps/web", name)).catch(error => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (bytes) fingerprint.update(name).update(hash(bytes));
    }
  }
  // The distributed tools and exact installed public dependencies are inputs too.
  for (const file of (await fs.readdir(tooling)).filter(file => file.endsWith(".mjs")).sort()) {
    fingerprint.update(file).update(hash(await fs.readFile(path.join(tooling, file))));
  }
  const sdk = await fs.readFile(path.join(root, ".dependencies/sdk/sdk-artifacts.json")).catch(error => {
    if (error.code === "ENOENT") return Buffer.from("producer");
    throw error;
  });
  return fingerprint.update(sdk).digest("hex");
}

async function artifactFiles(directory, relative = "") {
  const info = await fs.lstat(directory);
  if (!info.isDirectory()) throw new Error("build_artifact_not_regular: " + directory);
  const files = [];
  for (const entry of (await fs.readdir(path.join(directory, relative), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(directory, name));
    else {
      const stat = await fs.lstat(path.join(directory, name));
      if (!stat.isFile()) throw new Error("build_artifact_not_regular: " + name);
      files.push({file: name, bytes: stat.size, mode: stat.mode & 0o777,
        sha256: hash(await fs.readFile(path.join(directory, name)))});
    }
  }
  return files;
}

async function readCachedReceipt(root, kind, key) {
  try {
    const base = path.join(root, "artifacts", kind);
    const index = await fs.readFile(path.join(root, ".cache/build", kind, key + ".json"), "utf8").catch(error => {
      if (error.code === "ENOENT") return fs.readFile(path.join(base, "latest.json"), "utf8");
      throw error;
    });
    const pointer = JSON.parse(index);
    if (pointer.buildKey !== key || !/^[a-f0-9]{64}$/u.test(pointer.artifactKey)) return undefined;
    const receiptFile = path.join(base, pointer.artifactKey, "builds", key + ".json");
    const receipt = JSON.parse(await fs.readFile(receiptFile, "utf8"));
    const output = path.join(base, pointer.artifactKey, "package");
    if (receipt.status !== "passed" || receipt.buildKey !== key || receipt.artifactKey !== pointer.artifactKey || !receipt.artifacts?.length) return undefined;
    if (hash(JSON.stringify(receipt.artifacts)) !== receipt.artifactKey
      || JSON.stringify(await artifactFiles(output)) !== JSON.stringify(receipt.artifacts)) return undefined;
    return {...receipt, output, receipt: receiptFile, ...(receipt.packageRoot ? {packageRoot: output} : {})};
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code) || error instanceof SyntaxError || error.message.startsWith("build_artifact_not_regular:")) return undefined;
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const staging = file + "." + randomUUID();
  await fs.writeFile(staging, JSON.stringify(value, null, 2) + "\n");
  await fs.rename(staging, file);
}

async function selectArtifact(root, kind, receipt) {
  await writeJson(path.join(root, "artifacts", kind, "latest.json"), {
    formatVersion: 1, kind, buildKey: receipt.buildKey,
    artifactKey: receipt.artifactKey, package: path.posix.join(receipt.artifactKey, "package"),
    receipt: path.posix.join(receipt.artifactKey, "builds", receipt.buildKey + ".json"),
  });
}

/** Each project publishes immutable packages and a stable, atomic latest pointer.
 * Cargo owns compilation caching. This layer reuses complete verified packages.
 */
export async function withCachedBuild(options, build) {
  const {root, kind} = options;
  if (!/^[a-z][a-z0-9-]*$/u.test(kind)) throw new Error("build_kind_invalid");
  const key = await buildInputFingerprint(root, options);
  const cached = await readCachedReceipt(root, kind, key);
  if (cached) {
    await writeJson(path.join(root, ".cache/build", kind, key + ".json"), {buildKey: key, artifactKey: cached.artifactKey});
    await selectArtifact(root, kind, cached);
    console.error(`[build] ${kind} · reusing verified package · ${cached.output}`);
    return {...cached, cacheHit: true};
  }
  const run = Date.now() + "-" + randomUUID();
  const logDirectory = path.join(root, ".cache/logs", kind, run);
  const workDirectory = path.join(root, ".cache/work", kind, run);
  const artifactParent = path.join(root, "artifacts", kind);
  await fs.mkdir(logDirectory, {recursive: true});
  await fs.mkdir(workDirectory, {recursive: true});
  await fs.mkdir(artifactParent, {recursive: true});
  const staging = await fs.mkdtemp(path.join(artifactParent, ".building-"));
  try {
    const result = await build({key, logDirectory, workDirectory, output: path.join(staging, "package")});
    if (result.status !== "passed") return {...result, receipt: path.join(logDirectory, "receipt.json"), cacheHit: false};
    if (key !== await buildInputFingerprint(root, options)) throw new Error("build_inputs_changed: retry with stable sources");
    const artifacts = await artifactFiles(path.join(staging, "package"));
    if (!artifacts.length) throw new Error("build_artifact_empty");
    const artifactKey = hash(JSON.stringify(artifacts));
    const final = path.join(artifactParent, artifactKey);
    try { await fs.rename(staging, final); }
    catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      // Content-addressed packages can be published concurrently. Equal names
      // imply equal bytes, modes and entries; a valid existing package is reused.
      const existing = await artifactFiles(path.join(final, "package")).catch(() => undefined);
      if (JSON.stringify(existing) !== JSON.stringify(artifacts)) {
        const invalid = final + ".invalid-" + randomUUID();
        await fs.rename(final, invalid);
        await fs.rename(staging, final);
        await fs.rm(invalid, {recursive: true, force: true});
      }
    }
    const output = path.join(final, "package");
    const receipt = {...result, run, buildKey: key, artifactKey, output, artifacts, cacheHit: false,
      ...(result.packageRoot ? {packageRoot: output} : {}), logs: logDirectory,
      receipt: path.join(final, "builds", key + ".json")};
    await writeJson(receipt.receipt, receipt);
    await writeJson(path.join(logDirectory, "receipt.json"), receipt);
    await writeJson(path.join(root, ".cache/build", kind, key + ".json"), {buildKey: key, artifactKey});
    await selectArtifact(root, kind, receipt);
    console.error(`[build] ${kind} · package ready · ${output}`);
    return receipt;
  } finally {
    await fs.rm(staging, {recursive: true, force: true});
    await fs.rm(workDirectory, {recursive: true, force: true});
  }
}
