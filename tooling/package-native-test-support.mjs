import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {withCachedBuild} from './build-artifacts.mjs';

const root = process.cwd();
const receipt = await withCachedBuild({
  root, kind: 'test-support', toolchains: false,
  inputs: ['native', 'native-build.json', 'package.json', 'scripts', 'sdk-dependency.json'],
}, async context => {
  const profile = JSON.parse(await fs.readFile(path.join(root, 'native-build.json'), 'utf8'));
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const stage = path.join(context.workDirectory, profile.id, 'native');
  await fs.cp(path.join(root, 'native'), stage, {recursive: true,
    filter: file => !path.relative(path.join(root, 'native'), file).split(path.sep).includes('target')});
  const manifest = path.join(stage, 'Cargo.toml');
  await fs.writeFile(manifest, (await fs.readFile(manifest, 'utf8')).replaceAll('../.dependencies/sdk/native/', '../../../sdk/native/'));
  await fs.mkdir(context.output, {recursive: true});
  const file = `${profile.id}-native-test-support-${metadata.version}.tar.gz`;
  const result = spawnSync('tar', ['-czf', path.join(context.output, file), '-C', context.workDirectory, profile.id], {stdio: 'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('NATIVE_TEST_SUPPORT_PACK_FAILED');
  const sha256 = createHash('sha256').update(await fs.readFile(path.join(context.output, file))).digest('hex');
  await fs.writeFile(path.join(context.output, 'native-test-support.json'), JSON.stringify({formatVersion: 1,
    id: profile.id, version: metadata.version, file, sha256}, null, 2) + '\n');
  return {status: 'passed'};
});
console.log(JSON.stringify({status: receipt.status, output: receipt.output, cacheHit: receipt.cacheHit}));
