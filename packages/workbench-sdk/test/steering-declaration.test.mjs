import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));

test('packed steering declarations retain contextual typing for rejection callbacks', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-steering-types-'));
  try {
    for (const name of ['core', 'writing', 'data']) {
      const installed = path.join(temporary, 'node_modules/@research-assistant', name);
      fs.mkdirSync(installed, {recursive: true});
      const result = spawnSync('tar', ['-xzf', path.join(root, '.tmp/artifacts', name + '-0.1.0.tgz'), '--strip-components=1', '-C', installed]);
      assert.equal(result.status, 0, result.stderr?.toString());
    }
    fs.writeFileSync(path.join(temporary, 'consumer.ts'), `
      import {AgentSteeringController} from '@research-assistant/data/agent';
      declare const owner: AgentSteeringController<{conversationId: string; turnId: string; documentId: string}>;
      owner.submit({conversationId: 'c', turnId: 't', documentId: 'd'}, 'text', undefined, undefined, undefined, undefined, async request => {
        const id: string = request.documentId;
        const inputId: string = request.inputId;
        // @ts-expect-error Public declarations retain the original numeric rejection.
        const wrong: number = request.documentId;
        void id; void inputId; void wrong;
        return false;
      });
    `);
    const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--strict', '--skipLibCheck', '--noEmit',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', 'consumer.ts'], {cwd: temporary, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {fs.rmSync(temporary, {recursive: true, force: true});}
});
