import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(path.join(root, "package.json"));
const compiler = require.resolve("typescript/bin/tsc");

test("compiled public HBS declarations preserve open options and contextual request sequence typing", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workbench-hbs-open-declaration-"));
  try {
    const installed = path.join(directory, "node_modules/@research-assistant/core");
    mkdirSync(installed, {recursive: true});
    execFileSync(process.execPath, [compiler, "-p", path.join(root, "packages/core/tsconfig.json"),
      "--noEmit", "false", "--declaration", "--declarationMap", "false",
      "--rootDir", path.join(root, "packages/core/src"), "--outDir", path.join(installed, "lib")], {stdio: "pipe"});
    const metadata = JSON.parse(readFileSync(path.join(root, "packages/core/package.json"), "utf8"));
    metadata.exports = Object.fromEntries(Object.entries(metadata.exports).map(([key, value]) => [key,
      value.startsWith("./src/") && value.endsWith(".ts") ? {types: "./lib/" + value.slice(6, -3) + ".d.ts", default: "./lib/" + value.slice(6, -3) + ".js"} : value]));
    writeFileSync(path.join(installed, "package.json"), JSON.stringify(metadata));
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({private: true, type: "module"}));
    writeFileSync(path.join(directory, "consumer.ts"), `
      import {HbsSession, type HbsSessionOptions, type HbsDocumentAdapter,
        type DocumentPort, type DocumentPreservation} from "@research-assistant/core/hbs";
      declare const adapter: HbsDocumentAdapter<string>;
      declare const port: DocumentPort<string>;
      declare const preservation: DocumentPreservation<string>;
      export const opened: Promise<HbsSession<string>> = HbsSession.open({adapter, port, preservation,
        requestId: sequence => {const numeric: number = sequence; return String(numeric);}});
      export const options: HbsSessionOptions<string> = {adapter, port, preservation, requestId: sequence => String(sequence)};
      // @ts-expect-error The original sequence contract is numeric.
      HbsSession.open({adapter, port, preservation, requestId: (sequence: string) => sequence});
      // @ts-expect-error Preservation remains required; this must not become any.
      HbsSession.open({adapter, port, requestId: (sequence: number) => String(sequence)});
    `);
    writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({compilerOptions: {
      strict: true, noEmit: true, types: [], skipLibCheck: false,
      target: "ES2022", lib: ["ES2022"], module: "ESNext", moduleResolution: "Bundler", listFiles: true,
    }, files: ["consumer.ts"]}));
    const result = spawnSync(process.execPath, [compiler, "-p", path.join(directory, "tsconfig.json"), "--pretty", "false"], {
      cwd: directory, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const declaration = readFileSync(path.join(installed, "lib/hbs/session.d.ts"), "utf8");
    assert.match(declaration, /static open<D>\(options: HbsSessionOptions<D>\)/u);
    for (const file of result.stdout.trim().split("\n")) {
      assert.doesNotMatch(file, /\/apps\/(?:web|desktop)\/|\/packages\/core\/src\/|\/node_modules\/@research-assistant\/core\/src\//u);
    }
  } finally {rmSync(directory, {recursive: true, force: true});}
});
