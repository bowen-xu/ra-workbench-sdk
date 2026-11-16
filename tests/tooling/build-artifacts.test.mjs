import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
import {withCachedBuild} from "../../tooling/build-artifacts.mjs";

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-build-cache-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    await fs.writeFile(path.join(root, ".gitignore"), ".cache/\nartifacts/\n.dependencies/\n");
    await fs.writeFile(path.join(root, "source.ts"), "original");
    await fs.mkdir(path.join(root, ".dependencies/sdk"), {recursive: true});
    await fs.writeFile(path.join(root, ".dependencies/sdk/sdk-artifacts.json"), '{"version":"0.1.0"}');
    const options = {root, kind: "plugin", toolchains: false};
    let count = 0;
    const build = async ({output}) => {
      count++;
      await fs.mkdir(output, {recursive: true});
      await fs.writeFile(path.join(output, "entry.js"), "same output", {mode: 0o644});
      return {status: "passed", output};
    };
    await run({root, options, build, count: () => count});
  } finally {await fs.rm(root, {recursive: true, force: true});}
}

test("the project build reuses one verified immutable package across launchers", () => fixture(async ({options, build, count}) => {
  const first = await withCachedBuild({...options, args: ["--offline"]}, build);
  const second = await withCachedBuild(options, build);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.output, first.output);
  assert.equal(second.receipt, first.receipt);
  assert.equal(count(), 1);
}));

test("source and SDK changes invalidate inputs while preserving previous packages", () => fixture(async ({root, options, build, count}) => {
  const first = await withCachedBuild(options, build);
  await fs.writeFile(path.join(root, "source.ts"), "changed");
  const second = await withCachedBuild(options, build);
  assert.notEqual(second.buildKey, first.buildKey);
  assert.equal(second.output, first.output);
  await fs.writeFile(path.join(root, ".dependencies/sdk/sdk-artifacts.json"), '{"version":"0.1.1"}');
  const third = await withCachedBuild(options, build);
  assert.notEqual(third.buildKey, second.buildKey);
  assert.equal(count(), 3);
}));

test("corrupt, missing, permission-changed and additional artifact files trigger a rebuild", () => fixture(async ({options, build, count}) => {
  let result = await withCachedBuild(options, build);
  for (const damage of [
    output => fs.writeFile(path.join(output, "entry.js"), "corrupt"),
    output => fs.unlink(path.join(output, "entry.js")),
    output => fs.chmod(path.join(output, "entry.js"), 0o600),
    output => fs.writeFile(path.join(output, "unexpected.js"), "unexpected"),
  ]) {
    await damage(result.output);
    result = await withCachedBuild(options, build);
    assert.equal(result.cacheHit, false);
    assert.equal(await fs.readFile(path.join(result.output, "entry.js"), "utf8"), "same output");
  }
  assert.equal(count(), 5);
}));

test("concurrent publishers produce a complete reusable package and atomic index", () => fixture(async ({options, build}) => {
  const results = await Promise.all(Array.from({length: 4}, () => withCachedBuild(options, build)));
  assert.equal(new Set(results.map(result => result.output)).size, 1);
  const reused = await withCachedBuild(options, () => {throw new Error("unexpected build");});
  assert.equal(reused.cacheHit, true);
}));

test("failed builds and source changes never replace the last successful artifact", () => fixture(async ({root, options, build}) => {
  await withCachedBuild(options, build);
  const latest = path.join(root, "artifacts/plugin/latest.json");
  const before = await fs.readFile(latest, "utf8");
  await fs.writeFile(path.join(root, "source.ts"), "next");
  const failed = await withCachedBuild(options, async () => ({status: "failed"}));
  assert.equal(failed.status, "failed");
  assert.equal(await fs.readFile(latest, "utf8"), before);
  await assert.rejects(withCachedBuild(options, async context => {
    const result = await build(context);
    await fs.writeFile(path.join(root, "source.ts"), "changed during build");
    return result;
  }), /build_inputs_changed/u);
  assert.equal(await fs.readFile(latest, "utf8"), before);
}));

test("packages remain reusable when compilation caches and historical logs are removed", () => fixture(async ({root, options, build, count}) => {
  const first = await withCachedBuild(options, build);
  await fs.rm(path.join(root, ".cache"), {recursive: true});
  const second = await withCachedBuild(options, build);
  assert.equal(second.cacheHit, true);
  assert.equal(second.output, first.output);
  assert.equal(count(), 1);
  assert.equal((await fs.stat(second.receipt)).isFile(), true);
}));

test("isolated source archives build and reuse packages without Git metadata", () => fixture(async ({root, options, build, count}) => {
  await fs.rm(path.join(root, ".git"), {recursive: true});
  await fs.mkdir(path.join(root, "src/build"), {recursive: true});
  await fs.rename(path.join(root, "source.ts"), path.join(root, "src/build/entry.ts"));
  await withCachedBuild(options, build);
  assert.equal((await withCachedBuild(options, build)).cacheHit, true);
  await fs.writeFile(path.join(root, "src/build/entry.ts"), "changed");
  assert.equal((await withCachedBuild(options, build)).cacheHit, false);
  assert.equal(count(), 2);
}));

test("source archive builds exclude generated resources while tracking authored sources", () => fixture(async ({root, options, build, count}) => {
  await fs.rm(path.join(root, ".git"), {recursive: true});
  await fs.mkdir(path.join(root, "apps/web/src/build"), {recursive: true});
  const source = path.join(root, "apps/web/src/build/document.ts");
  await fs.writeFile(source, "authored source");
  const selected = {...options, inputs: ["apps/web"], exclude: ["apps/web/public/dictionary"]};
  const generatedBuild = async context => {
    await fs.mkdir(path.join(root, "apps/web/src/.generated"), {recursive: true});
    await fs.mkdir(path.join(root, "apps/web/public/dictionary"), {recursive: true});
    await fs.writeFile(path.join(root, "apps/web/src/.generated/query.js"), "generated Wasm loader");
    await fs.writeFile(path.join(root, "apps/web/public/dictionary/manifest.json"), "generated dictionary");
    return build(context);
  };
  const first = await withCachedBuild(selected, generatedBuild);
  assert.equal((await withCachedBuild(selected, generatedBuild)).cacheHit, true);
  await fs.writeFile(source, "changed source");
  const changed = await withCachedBuild(selected, generatedBuild);
  assert.notEqual(changed.buildKey, first.buildKey);
  assert.equal(count(), 2);
}));
