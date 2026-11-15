import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {isDeepStrictEqual} from "node:util";

const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

/** Match the one freshly compiled first-party Writing archive to its installed
 * files. A package name alone never exempts a dependency from license checks. */
export async function verifyWritingPublicArtifact({archive, sha256, compiled, installed}) {
  if (digest(await fs.readFile(archive)) !== sha256) throw new Error("writing_public_archive_changed");
  const listing = spawnSync("tar", ["-tzf", archive], {encoding: "utf8", maxBuffer: 4 * 1024 * 1024});
  if (listing.status !== 0) throw new Error("writing_public_archive_unreadable");
  const entries = listing.stdout.trimEnd().split("\n").filter(name => !name.endsWith("/"));
  if (!entries.length || entries.length > 4096 || new Set(entries).size !== entries.length
    || entries.some(name => !/^package\/(?:package\.json|lib\/[A-Za-z0-9_./-]+)$/u.test(name)
      || name.split("/").includes(".."))) throw new Error("writing_public_archive_members_invalid");

  async function files(directory) {
    const result = new Map();
    async function visit(current) {
      for (const name of (await fs.readdir(current)).sort()) {
        const file = path.join(current, name), info = await fs.lstat(file);
        if (info.isDirectory()) await visit(file);
        else if (info.isFile() && info.size <= 64 * 1024 * 1024) result.set(path.relative(directory, file).split(path.sep).join("/"), await fs.readFile(file));
        else throw new Error("writing_public_artifact_not_regular");
      }
    }
    await visit(directory);
    return result;
  }
  const installedRoot = await fs.realpath(installed);
  const original = await files(compiled), actual = await files(installedRoot);
  const names = entries.map(name => name.slice("package/".length)).sort();
  if (!isDeepStrictEqual([...original.keys()].sort(), names) || !isDeepStrictEqual([...actual.keys()].sort(), names)) {
    throw new Error("writing_public_artifact_members_changed");
  }
  const proof = [];
  for (const file of names) {
    const result = spawnSync("tar", ["-xOf", archive, "package/" + file], {maxBuffer: 64 * 1024 * 1024});
    if (result.status !== 0) throw new Error("writing_public_archive_member_unreadable");
    const packed = result.stdout;
    if (!packed.equals(actual.get(file))) throw new Error("writing_public_installed_bytes_changed");
    if (file === "package.json") {
      const metadata = JSON.parse(packed.toString("utf8"));
      if (metadata.name !== "@research-assistant/writing"
        || !isDeepStrictEqual(metadata, JSON.parse(original.get(file).toString("utf8")))) throw new Error("writing_public_artifact_metadata_changed");
    } else if (!packed.equals(original.get(file))) throw new Error("writing_public_compiled_bytes_changed");
    proof.push({file, compiledSha256: digest(original.get(file)), archiveSha256: digest(packed), installedSha256: digest(actual.get(file))});
  }
  if (digest(await fs.readFile(archive)) !== sha256) throw new Error("writing_public_archive_changed");
  return {name: "@research-assistant/writing", directory: installedRoot, archive, sha256, files: proof,
    metadataFormatting: "pnpm may format package.json; its complete parsed fields must remain identical"};
}
