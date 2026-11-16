import {withCachedBuild} from "../tooling/build-artifacts.mjs";
import {rewriteEsmImports} from './rewrite-esm-imports.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(path.join(root, 'packages/workbench-sdk/package.json'));
const compiler = require.resolve('typescript/bin/tsc');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`SDK_BUILD_FAILED: ${command} exited with ${result.status}`);
}
function exportsForArtifact(value) {
  if (typeof value === 'string' && value.startsWith('./src/') && value.endsWith('.ts')) {
    const stem = './lib/' + value.slice(6, -3);
    return {types: stem + '.d.ts', default: stem + '.js'};
  }
  if (typeof value === 'string' && value.startsWith('./src/') && value.endsWith('.json')) return './lib/' + value.slice(6);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, exportsForArtifact(child)]));
  }
  return value;
}
async function buildSdk(context) {
  const output = context.output;
  const entries = [];
  async function record(file, name, version, kind) {
    const bytes = await fs.readFile(path.join(output, file));
    entries.push({file, name, version, kind, sha256: createHash('sha256').update(bytes).digest('hex')});
  }
  await fs.mkdir(output, {recursive: true});
  for (const name of ['core', 'writing', 'data', 'workbench-sdk']) {
    const source = path.join(root, 'packages', name);
    const stage = path.join(context.workDirectory, 'packages', name);
    const metadata = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    await fs.rm(stage, {recursive: true, force: true});
    await fs.mkdir(stage, {recursive: true});
    const configuration = {
      extends: path.join(source, 'tsconfig.json'),
      compilerOptions: {noEmit: false, declaration: true, declarationMap: false, composite: false,
        rootDir: path.join(source, 'src'), outDir: path.join(stage, 'lib')},
      include: [path.join(source, 'src')], exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.testSupport.ts'].map(pattern => path.join(source, pattern)),
    };
    const configFile = path.join(stage, 'tsconfig.json');
    await fs.writeFile(configFile, JSON.stringify(configuration, null, 2) + '\n');
    run(process.execPath, [compiler, '-p', configFile]);
    await fs.cp(path.join(source, 'src'), path.join(stage, 'lib'), {recursive: true,
      filter: async file => (await fs.stat(file)).isDirectory() || file.endsWith('.json')});
    await rewriteEsmImports(path.join(stage, 'lib'), require('typescript'));
    if (name === 'workbench-sdk') await fs.cp(path.join(stage, 'lib'), path.join(source, 'lib'), {recursive: true});
    metadata.exports = exportsForArtifact(metadata.exports);
    metadata.files = ['lib'];
    for (const group of ['dependencies', 'devDependencies']) {
      for (const [id, version] of Object.entries(metadata[group] ?? {})) {
        if (version.startsWith('workspace:')) {
          const dependency = JSON.parse(await fs.readFile(path.join(root, 'packages', id.split('/')[1], 'package.json'), 'utf8'));
          metadata[group][id] = dependency.version;
        }
      }
    }
    delete metadata.scripts;
    delete metadata.devDependencies;
    if (name === 'core') {
      await fs.cp(path.join(source, 'prompts'), path.join(stage, 'prompts'), {recursive: true});
      metadata.files.push('prompts');
    }
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
    const archive = `${name}-${metadata.version}.tgz`;
    run('pnpm', ['--config.verify-deps-before-run=false', 'pack', '--out', path.join(output, archive)], stage);
    await record(archive, metadata.name, metadata.version, 'web');
  }
  for (const name of ['agent-api', 'workbench-native-sdk', 'semantic-engine-api', 'note-query']) {
    const source = path.join(root, 'packages', name);
    const stage = path.join(context.workDirectory, 'native-packages', name);
    await fs.rm(stage, {recursive: true, force: true});
    await fs.mkdir(stage, {recursive: true});
    for (const entry of await fs.readdir(source, {withFileTypes: true})) {
      if (['target', 'node_modules', '.tmp', '.git'].includes(entry.name)) continue;
      await fs.cp(path.join(source, entry.name), path.join(stage, entry.name), {recursive: true, preserveTimestamps: true,
        filter: file => !path.relative(source, file).split(path.sep).some(part => ["target", "node_modules", ".tmp", ".git"].includes(part))});
    }
    const cargo = await fs.readFile(path.join(stage, 'Cargo.toml'), 'utf8');
    const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
    const crate = cargo.match(/^name = "([^"]+)"/m)?.[1];
    if (!version || !crate) throw new Error('SDK_CRATE_METADATA_INVALID: ' + name);
    const archive = `${name}-${version}.tar.gz`;
    run('tar', ['-czf', path.join(output, archive), '-C', path.dirname(stage), name]);
    await record(archive, crate, version, 'native');
  }
  const sdkVersion = JSON.parse(await fs.readFile(path.join(root, 'packages/workbench-sdk/package.json'), 'utf8')).version;
  run(process.execPath, [path.join(root, 'scripts/prepare-note-query.mjs')]);
  const queryArchive = 'note-query-web-' + sdkVersion + '.tar.gz';
  run('tar', ['-czf', path.join(output, queryArchive), '-C', path.join(root, '.cache/note-query'), 'web']);
  await record(queryArchive, '@research-assistant/note-query-web', sdkVersion, 'query-web');
  const toolingArchive = 'tooling-' + sdkVersion + '.tar.gz';
  run('tar', ['-czf', path.join(output, toolingArchive), '-C', root, 'tooling']);
  await record(toolingArchive, '@research-assistant/sdk-build-tools', sdkVersion, 'tooling');
  await fs.copyFile(path.join(root, 'scripts/install-artifacts.mjs'), path.join(output, 'install-sdk.mjs'));
  await fs.writeFile(path.join(output, 'sdk-artifacts.json'), JSON.stringify({formatVersion: 1, version: JSON.parse(await fs.readFile(path.join(root, 'packages/workbench-sdk/package.json'), 'utf8')).version, artifacts: entries}, null, 2) + '\n');
  return {status: 'passed', output};
}

const receipt = await withCachedBuild({root, kind: 'sdk', inputs: ['packages', 'scripts', 'tooling', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', '.cargo']}, buildSdk);
if (receipt.cacheHit) {
  await fs.mkdir(path.join(root, ".cache/work"), {recursive: true});
  const exports = await fs.mkdtemp(path.join(root, '.cache/work/sdk-exports-'));
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(receipt.output, 'sdk-artifacts.json'), 'utf8'));
    const sdk = manifest.artifacts.find(value => value.name === '@research-assistant/workbench-sdk');
    run('tar', ['-xzf', path.join(receipt.output, sdk.file), '-C', exports]);
    const declarations = path.join(root, 'packages/workbench-sdk/lib');
    await fs.rm(declarations, {recursive: true, force: true});
    await fs.cp(path.join(exports, 'package/lib'), declarations, {recursive: true});
  } finally {await fs.rm(exports, {recursive: true, force: true});}
}
console.log(JSON.stringify({status: receipt.status, output: receipt.output, receipt: receipt.receipt, cacheHit: receipt.cacheHit}));
