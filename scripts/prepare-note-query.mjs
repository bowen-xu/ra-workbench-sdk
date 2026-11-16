import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crate = resolve(root, "packages/note-query");
const output = resolve(root, ".cache/note-query/web");
const target = resolve(root, ".cache/cargo/note-query");
const cliVersion = "0.2.105";

function run(command, args, inherit = false, environment = process.env) {
  const result = spawnSync(command, args, {cwd: root, env: environment, encoding: "utf8", stdio: inherit ? "inherit" : "pipe"});
  if (result.error || result.status !== 0) throw new Error(`note_query_build_failed: ${command} ${args.join(" ")}\n${result.error?.message ?? ""}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout?.trim() ?? "";
}

/** Never installs or changes a global Rust toolchain. NOTE_QUERY_RUSTC and
 * NOTE_QUERY_WASM_BINDGEN may point to an explicitly provisioned local toolchain. */
export function prepareNoteQuery() {
  const cli = process.env.NOTE_QUERY_WASM_BINDGEN ?? "wasm-bindgen";
  const rustc = process.env.NOTE_QUERY_RUSTC ?? process.env.RUSTC ?? "rustc";
  const version = run(rustc, ["--version"]);
  // Reusing a verified artifact needs neither a CLI lookup nor another build.
  // Compiler distribution affects std metadata when compiling, but not the
  // pure query rules of an already built artifact at the same compiler commit.
  const sourceHash = createHash("sha256").update(version.replace(/\s+\(Homebrew\)$/u, "")).update(cliVersion);
  for (const file of ["Cargo.toml", "src/lib.rs", "wasm/Cargo.toml", "wasm/Cargo.lock", "wasm/src/lib.rs"]) sourceHash.update(file).update(readFileSync(resolve(crate,file)));
  sourceHash.update(readFileSync(fileURLToPath(import.meta.url)));
  const sourceFingerprint = sourceHash.digest("hex");
  const receipt = resolve(output,"receipt.json");
  const artifacts = ["research_note_query_wasm.js","research_note_query_wasm_bg.wasm","research_note_query_wasm.d.ts"];
  if (existsSync(receipt) && artifacts.every(file => existsSync(resolve(output,file)))) {
    const saved = JSON.parse(readFileSync(receipt,"utf8"));
    if (saved.sourceFingerprint === sourceFingerprint && artifacts.every(file => saved.artifactHashes?.[file] === createHash("sha256").update(readFileSync(resolve(output,file))).digest("hex"))) return;
  }
  const bindgen = run(cli, ["--version"]);
  if (bindgen !== `wasm-bindgen ${cliVersion}`) throw new Error(`note_query_bindgen_version: expected ${cliVersion}; got ${bindgen}`);
  const hash = createHash("sha256").update(version).update(bindgen);
  for (const file of ["Cargo.toml", "src/lib.rs", "wasm/Cargo.toml", "wasm/Cargo.lock", "wasm/src/lib.rs"]) hash.update(file).update(readFileSync(resolve(crate, file)));
  const fingerprint = hash.digest("hex");
  run("cargo", ["build", "--manifest-path", resolve(crate, "wasm/Cargo.toml"), "--locked", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--target-dir", target], true, {...process.env,RUSTC: rustc});
  const staging = `${output}.staging-${process.pid}`;
  mkdirSync(staging, {recursive: true});
  try {
    run(cli, [resolve(target, "wasm32-unknown-unknown/release/research_note_query_wasm.wasm"), "--target", "web", "--out-dir", staging]);
    const artifactHashes = Object.fromEntries(artifacts.map(file => [file,createHash("sha256").update(readFileSync(resolve(staging,file))).digest("hex")]));
    writeFileSync(resolve(staging, "receipt.json"), JSON.stringify({fingerprint,sourceFingerprint,artifactHashes,rustc: version,bindgen}, null, 2) + "\n");
    // Each generated directory belongs only to this builder, never user data.
    rmSync(output, {recursive: true, force: true});
    renameSync(staging, output);
  } finally { rmSync(staging, {recursive: true, force: true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { prepareNoteQuery(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Install wasm32-unknown-unknown for the selected Rust compiler and wasm-bindgen-cli 0.2.105, or set NOTE_QUERY_RUSTC / NOTE_QUERY_WASM_BINDGEN to a prepared local toolchain. See packages/note-query/README.md.");
    process.exitCode = 1;
  }
}
