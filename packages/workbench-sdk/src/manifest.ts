import type {BuiltinCapabilityContract, BuiltinCapabilityRequirement, BuiltinPluginManifest, BuiltinPluginRequirement} from "./contracts.js";

export const WORKBENCH_API_VERSION = 1;
export const WORKBENCH_UI_RUNTIME = "react@19.2.8/react-dom@19.2.8";
export const WORKBENCH_NATIVE_PROTOCOL_VERSION = 1;

interface RuntimePluginMetadata extends BuiltinPluginManifest {
  readonly version: string;
}

interface RuntimePluginFrontendEntry {
  readonly entry: string;
  readonly styles: readonly string[];
  readonly uiRuntime: string;
}

export interface RuntimeNativePluginEntry {
  readonly protocolVersion: number;
  readonly os: "macos" | "linux" | "windows";
  readonly arch: "aarch64" | "x86_64";
  readonly entry: string;
}

interface RuntimePluginManifestV1 extends RuntimePluginMetadata, RuntimePluginFrontendEntry {
  readonly formatVersion: 1;
  readonly native?: never;
}

interface RuntimePluginManifestV2Frontend extends RuntimePluginMetadata, RuntimePluginFrontendEntry {
  readonly formatVersion: 2;
  readonly native?: RuntimeNativePluginEntry;
}

interface RuntimePluginManifestV2Native extends RuntimePluginMetadata {
  readonly formatVersion: 2;
  readonly native: RuntimeNativePluginEntry;
  readonly entry?: never;
  readonly styles?: never;
  readonly uiRuntime?: never;
}

export type RuntimeFrontendPluginManifest = RuntimePluginManifestV1 | RuntimePluginManifestV2Frontend;
/** Decoded metadata is neither activation nor permission to execute native code. */
export type RuntimePluginManifest = RuntimeFrontendPluginManifest | RuntimePluginManifestV2Native;

export function hasPluginFrontend(manifest: RuntimePluginManifest): manifest is RuntimeFrontendPluginManifest {
  return manifest.entry !== undefined;
}

export type PluginPackageErrorCode = "plugin_manifest_invalid" | "plugin_api_incompatible"
  | "plugin_ui_runtime_incompatible" | "plugin_native_protocol_incompatible";
export interface PluginPackageDiagnostic {
  readonly code: PluginPackageErrorCode;
  readonly pluginId: string;
  readonly field?: string;
  readonly expectedVersion?: string | number;
  readonly actualVersion?: string | number;
}

export class PluginPackageError extends Error {
  readonly code: PluginPackageErrorCode;
  constructor(readonly diagnostic: PluginPackageDiagnostic) {
    super(`${diagnostic.code}: ${diagnostic.pluginId}${diagnostic.field ? ` / ${diagnostic.field}` : ""}`);
    this.name = "PluginPackageError";
    this.code = diagnostic.code;
  }
}

function invalid(pluginId: string, field: string): never {
  throw new PluginPackageError({code: "plugin_manifest_invalid", pluginId, field});
}

function object(value: unknown, pluginId: string, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(pluginId, field);
  return value as Record<string, unknown>;
}

function text(value: unknown, pluginId: string, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value) invalid(pluginId, field);
  return value;
}

function version(value: unknown, pluginId: string, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid(pluginId, field);
  return value;
}

function list<T>(value: unknown, pluginId: string, field: string, decode: (value: unknown, field: string) => T): readonly T[] {
  if (!Array.isArray(value)) invalid(pluginId, field);
  return value.map((item, index) => decode(item, `${field}[${index}]`));
}

function resource(value: unknown, pluginId: string, field: string): string {
  const path = text(value, pluginId, field);
  // Package paths are canonical relative POSIX paths, not URLs or encoded paths.
  // The loader must additionally check real paths/symlinks against its root.
  if (/[:\\%?#\u0000-\u001f\u007f]/u.test(path) || path.startsWith("/") ||
      path.split("/").some(part => !part || part === "." || part === "..")) invalid(pluginId, field);
  return path;
}

function nativeEntry(value: unknown, pluginId: string): RuntimeNativePluginEntry {
  const native = object(value, pluginId, "native");
  for (const field of Object.keys(native)) {
    if (!["protocolVersion", "os", "arch", "entry"].includes(field)) invalid(pluginId, `native.${field}`);
  }
  const protocolVersion = version(native.protocolVersion, pluginId, "native.protocolVersion");
  const os = text(native.os, pluginId, "native.os");
  if (os !== "macos" && os !== "linux" && os !== "windows") invalid(pluginId, "native.os");
  const arch = text(native.arch, pluginId, "native.arch");
  if (arch !== "aarch64" && arch !== "x86_64") invalid(pluginId, "native.arch");
  return {protocolVersion, os, arch, entry: resource(native.entry, pluginId, "native.entry")};
}

/** Decode untrusted JSON into owned records before resolving dependencies.
 * Filesystem containment and existence remain loader responsibilities. */
export function decodePluginManifest(value: {readonly formatVersion: 1; readonly [key: string]: unknown}): RuntimePluginManifestV1;
export function decodePluginManifest(value: unknown): RuntimePluginManifest;
export function decodePluginManifest(value: unknown): RuntimePluginManifest {
  const raw = object(value, "<unknown>", "manifest");
  const id = text(raw.id, "<unknown>", "id");
  if (!/^[a-z][a-z0-9_-]*$/u.test(id) || id === "core") invalid(id, "id");
  if (raw.formatVersion !== 1 && raw.formatVersion !== 2) invalid(id, "formatVersion");
  const packageVersion = text(raw.version, id, "version");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)) invalid(id, "version");
  const dependencies = object(raw.dependencies, id, "dependencies");
  const consumes = object(raw.consumes, id, "consumes");
  const dependency = (input: unknown, field: string): BuiltinPluginRequirement => {
    const item = object(input, id, field);
    return {id: text(item.id, id, `${field}.id`), apiVersion: version(item.apiVersion, id, `${field}.apiVersion`)};
  };
  const capability = (input: unknown, field: string): BuiltinCapabilityContract => {
    const item = object(input, id, field);
    return {id: text(item.id, id, `${field}.id`), version: version(item.version, id, `${field}.version`)};
  };
  const requirement = (input: unknown, field: string): BuiltinCapabilityRequirement => {
    const item = object(input, id, field);
    return {...capability(item, field), ...(item.provider === undefined ? {} : {provider: text(item.provider, id, `${field}.provider`)})};
  };
  const apiVersion = version(raw.apiVersion, id, "apiVersion");
  const frontend = raw.formatVersion === 1 || ["entry", "styles", "uiRuntime"].some(field => field in raw)
    ? {
      entry: resource(raw.entry, id, "entry"),
      styles: list(raw.styles, id, "styles", (item, field) => resource(item, id, field)),
      uiRuntime: text(raw.uiRuntime, id, "uiRuntime"),
    } : undefined;
  const metadata = {
    id, version: packageVersion, apiVersion,
    dependencies: {
      required: list(dependencies.required, id, "dependencies.required", dependency),
      optional: list(dependencies.optional, id, "dependencies.optional", dependency),
    },
    provides: list(raw.provides, id, "provides", capability),
    consumes: {
      required: list(consumes.required, id, "consumes.required", requirement),
      optional: list(consumes.optional, id, "consumes.optional", requirement),
    },
  };
  // Version 1 keeps its original decoded shape, including ignoring unknown
  // metadata. A native declaration is meaningful only in explicit version 2.
  if (raw.formatVersion === 1 && frontend) return {formatVersion: 1, ...metadata, ...frontend};
  const native = "native" in raw ? nativeEntry(raw.native, id) : undefined;
  if (frontend) return {formatVersion: 2, ...metadata, ...frontend, ...(native ? {native} : {})};
  if (!native) invalid(id, "entry");
  return {formatVersion: 2, ...metadata, native};
}

/** Must run before importing executable package resources. */
export function assertPluginCompatibility(manifest: RuntimePluginManifest): void {
  if (manifest.apiVersion !== WORKBENCH_API_VERSION) throw new PluginPackageError({
    code: "plugin_api_incompatible", pluginId: manifest.id,
    expectedVersion: WORKBENCH_API_VERSION, actualVersion: manifest.apiVersion,
  });
  if (hasPluginFrontend(manifest) && manifest.uiRuntime !== WORKBENCH_UI_RUNTIME) throw new PluginPackageError({
    code: "plugin_ui_runtime_incompatible", pluginId: manifest.id,
    expectedVersion: WORKBENCH_UI_RUNTIME, actualVersion: manifest.uiRuntime,
  });
  if (manifest.native) {
    // This finite metadata compatibility does not authorize a Core service or
    // capability. The legacy writing preview keeps its original v1-only gate,
    // while the writing project profile uses the closed v2 protocol.
    const domainV2 = manifest.id === "literature_library" || manifest.id === "writing_projects";
    if (manifest.native.protocolVersion !== WORKBENCH_NATIVE_PROTOCOL_VERSION
      && !(domainV2 && manifest.native.protocolVersion === 2)) throw new PluginPackageError({
      code: "plugin_native_protocol_incompatible", pluginId: manifest.id,
      expectedVersion: domainV2 ? "1|2" : WORKBENCH_NATIVE_PROTOCOL_VERSION,
      actualVersion: manifest.native.protocolVersion,
    });
  }
}
