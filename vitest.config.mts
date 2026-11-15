import {configDefaults, defineConfig} from "vitest/config";
export default defineConfig({test: {exclude: [...configDefaults.exclude, ".tmp/**", ".dependencies/**", "packages/*/lib/**", "packages/workbench-sdk/test/**"],
 execArgv: process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage") ? ["--no-experimental-webstorage"] : [],
}});
