import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: node install-artifacts.mjs <SDK artifact directory> <consumer project>');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'sdk-artifacts.json'), 'utf8'));
const pin = JSON.parse(await fs.readFile(path.join(destination, 'sdk-dependency.json'), 'utf8'));
if (manifest.formatVersion !== 1 || manifest.version !== pin.version) throw new Error('SDK_ARTIFACT_VERSION_MISMATCH');
const installed = path.join(destination, '.dependencies/sdk');
async function installationFiles(directory, relative = '') {
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error('SDK_INSTALLATION_NOT_REGULAR: ' + directory);
  const files = [];
  for (const entry of (await fs.readdir(path.join(directory, relative), {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.isDirectory() && ['target', 'node_modules', '.cache'].includes(entry.name)) continue;
    const file = path.posix.join(relative, entry.name);
    if (file === 'installation.json') continue;
    if (entry.isDirectory()) files.push(...await installationFiles(directory, file));
    else if (entry.isFile()) {
      const target = path.join(directory, file), stat = await fs.stat(target);
      files.push({file, mode: stat.mode & 0o777, sha256: createHash('sha256').update(await fs.readFile(target)).digest('hex')});
    } else throw new Error('SDK_INSTALLATION_NOT_REGULAR: ' + file);
  }
  return files;
}
try {
  const state = JSON.parse(await fs.readFile(path.join(installed, 'installation.json'), 'utf8'));
  if (JSON.stringify(state.manifest) === JSON.stringify(manifest)
    && JSON.stringify(state.files) === JSON.stringify(await installationFiles(installed))) {
    console.log('Reusing verified public SDK ' + pin.version + ' for ' + destination);
    process.exit(0);
  }
} catch (error) {
  if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError)
    && !error.message.startsWith('SDK_INSTALLATION_NOT_REGULAR:')) throw error;
}
const stage = installed + '.staging-' + process.pid;
await fs.mkdir(stage, {recursive: true});
for (const artifact of manifest.artifacts) {
  if (!/^\d+\.\d+\.\d+$/.test(artifact.version) || !/^[a-z0-9-]+-\d+\.\d+\.\d+\.(?:tgz|tar\.gz)$/.test(artifact.file)) {
    throw new Error('SDK_ARTIFACT_METADATA_INVALID');
  }
  const bytes = await fs.readFile(path.join(source, artifact.file));
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('SDK_ARTIFACT_CHANGED: ' + artifact.file);
  if (artifact.kind === 'web') {
    await fs.mkdir(path.join(stage, 'web'), {recursive: true});
    await fs.writeFile(path.join(stage, 'web', artifact.file), bytes);
    const unpacked = path.join(stage, 'web', artifact.name.split('/')[1]);
    await fs.mkdir(unpacked, {recursive: true});
    const extracted = spawnSync('tar', ['-xzf', path.join(stage, 'web', artifact.file), '--strip-components=1', '-C', unpacked], {stdio: 'inherit'});
    if (extracted.status !== 0) throw new Error('SDK_WEB_ARTIFACT_EXTRACT_FAILED');
  } else if (['native', 'tooling', 'query-web'].includes(artifact.kind)) {
    const directory = artifact.kind === 'native' ? path.join(stage, 'native') : artifact.kind === 'query-web' ? path.join(stage, 'note-query') : stage;
    await fs.mkdir(directory, {recursive: true});
    const archive = path.join(stage, artifact.file);
    await fs.writeFile(archive, bytes);
    const listing = spawnSync('tar', ['-tzf', archive], {encoding: 'utf8'});
    if (listing.status !== 0 || listing.stdout.split('\n').filter(Boolean).some(file => path.isAbsolute(file) || file.split('/').includes('..'))) {
      throw new Error('SDK_ARTIFACT_PATH_INVALID');
    }
    const extraction = spawnSync('tar', ['-xzf', archive, '-C', directory], {stdio: 'inherit'});
    if (extraction.status !== 0) throw new Error('SDK_ARTIFACT_EXTRACT_FAILED');
  } else throw new Error('SDK_ARTIFACT_KIND_INVALID');
}
await fs.writeFile(path.join(stage, 'sdk-artifacts.json'), JSON.stringify(manifest, null, 2) + '\n');
const files = await installationFiles(stage);
const previousFiles = await installationFiles(installed).catch(error => {
  if (error.code === 'ENOENT' || error.message.startsWith('SDK_INSTALLATION_NOT_REGULAR:')) return [];
  throw error;
});
const priorByPath = new Map(previousFiles.map(file => [file.file, file]));
for (const file of files) {
  const prior = priorByPath.get(file.file);
  const previous = path.join(installed, file.file), target = path.join(stage, file.file);
  if (prior?.sha256 === file.sha256 && prior.mode === file.mode) {
    const stat = await fs.stat(previous);
    await fs.utimes(target, stat.atime, stat.mtime);
  } else {
    const now = new Date();
    await fs.utimes(target, now, now);
  }
}
await fs.writeFile(path.join(stage, 'installation.json'), JSON.stringify({manifest, files}, null, 2) + '\n');
const previous = installed + '.previous-' + process.pid;
await fs.rename(installed, previous).catch(error => {if (error.code !== 'ENOENT') throw error;});
try {await fs.rename(stage, installed);}
catch (error) {await fs.rename(previous, installed).catch(() => {}); throw error;}
await fs.rm(previous, {recursive: true, force: true});
console.log('Installed public SDK ' + pin.version + ' for ' + destination);
