/** Versioned contracts: importing this package never initializes a workbench. */
export type {BuiltinPluginRequirement, BuiltinCapabilityContract, BuiltinCapabilityRequirement, BuiltinPluginManifest} from "./contracts.js";
export {decodePluginManifest, assertPluginCompatibility, hasPluginFrontend, PluginPackageError,
  WORKBENCH_API_VERSION, WORKBENCH_UI_RUNTIME, WORKBENCH_NATIVE_PROTOCOL_VERSION} from "./manifest.js";
export type {RuntimePluginManifest, RuntimeFrontendPluginManifest, RuntimeNativePluginEntry,
  PluginPackageDiagnostic, PluginPackageErrorCode} from "./manifest.js";
