import fs from 'node:fs';
import path from 'node:path';

/** Tests use the same public URL mapping as the production plugin bundle.
 * The host input is a built Workbench distribution, without Workbench source. */
export function runtimeSdkTestPlugin(paths, directory = process.env.RA_WORKBENCH_SDK_DIRECTORY) {
  if (!directory) return undefined;
  const root = fs.realpathSync(directory);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'runtime-sdk.json'), 'utf8'));
  if (receipt.facadeBuild !== 'same-core-multi-entry') throw new Error('TEST_SDK_RUNTIME_INVALID');
  return {
    name: 'workbench-public-runtime-test-bindings', enforce: 'pre',
    resolveId(id) {
      // Pure package tests consume their complete packed exports. The finite
      // production runtime facades expose only the values used by plugins.
      if (/^@research-assistant\/(?:core|data|writing)(?:\/|$)/u.test(id)) return;
      const url = paths(id);
      if (typeof url !== 'string' || !url.startsWith('/sdk/v1/')) return;
      const file = path.join(root, url.slice(1));
      if (!fs.existsSync(file)) throw new Error('TEST_SDK_FACADE_MISSING: ' + url);
      return file;
    },
  };
}
