import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root = process.cwd();
const profile = JSON.parse(await fs.readFile(path.join(root, 'native-build.json'), 'utf8'));
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const stage = path.join(root, '.tmp/native-test-support', profile.id, 'native');
await fs.rm(path.dirname(stage), {recursive: true, force: true});
await fs.cp(path.join(root, 'native'), stage, {recursive: true,
  filter: file => !path.relative(path.join(root, 'native'), file).split(path.sep).includes('target')});
const manifest = path.join(stage, 'Cargo.toml');
await fs.writeFile(manifest, (await fs.readFile(manifest, 'utf8')).replaceAll('../.dependencies/sdk/native/', '../../../sdk/native/'));
const output = path.join(root, '.tmp/artifacts');
await fs.mkdir(output, {recursive: true});
const file = `${profile.id}-native-test-support-${metadata.version}.tar.gz`;
const result = spawnSync('tar', ['-czf', path.join(output, file), '-C', path.dirname(path.dirname(stage)), profile.id], {stdio: 'inherit'});
if (result.status !== 0) throw new Error('NATIVE_TEST_SUPPORT_PACK_FAILED');
const sha256 = createHash('sha256').update(await fs.readFile(path.join(output, file))).digest('hex');
await fs.writeFile(path.join(output, 'native-test-support.json'), JSON.stringify({formatVersion: 1,
  id: profile.id, version: metadata.version, file, sha256}, null, 2) + '\n');
