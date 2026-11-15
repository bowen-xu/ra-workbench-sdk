import type {
  BuiltinCapabilityContract,
  BuiltinCapabilityRequirement,
  BuiltinPluginManifest,
} from "./contracts.js";

export type BuiltinCompositionErrorCode =
  | "plugin_invalid_contract" | "plugin_duplicate_id" | "plugin_unknown_id"
  | "plugin_api_incompatible" | "plugin_dependency_missing" | "plugin_dependency_incompatible"
  | "plugin_dependency_cycle" | "plugin_capability_duplicate" | "plugin_capability_missing"
  | "plugin_capability_incompatible" | "plugin_capability_ambiguous";

export interface BuiltinCompositionDiagnostic {
  readonly code: BuiltinCompositionErrorCode;
  readonly pluginId: string;
  readonly dependencyId?: string;
  readonly capabilityId?: string;
  readonly provider?: string;
  readonly expectedVersion?: number;
  readonly actualVersion?: number;
  readonly cycle?: readonly string[];
}

export class BuiltinPluginCompositionError extends Error {
  readonly code: BuiltinCompositionErrorCode;
  constructor(readonly diagnostic: BuiltinCompositionDiagnostic) {
    const subject = diagnostic.dependencyId ?? diagnostic.capabilityId ?? diagnostic.pluginId;
    super(`${diagnostic.code}: ${diagnostic.pluginId} / ${subject}`);
    this.name = "BuiltinPluginCompositionError";
    this.code = diagnostic.code;
  }
}

export interface BuiltinCapabilityBinding {
  readonly pluginId: string;
  readonly capabilityId: string;
  readonly version: number;
  readonly provider: string;
}

export interface BuiltinPluginComposition<T extends BuiltinPluginManifest> {
  /** Catalog/UI order is separate from dependency-first initialization order. */
  readonly plugins: readonly T[];
  readonly activationOrder: readonly T[];
  readonly bindings: readonly BuiltinCapabilityBinding[];
  readonly unavailableOptional: readonly BuiltinCompositionDiagnostic[];
}

function fail(diagnostic: BuiltinCompositionDiagnostic): never {
  throw new BuiltinPluginCompositionError(diagnostic);
}

function validId(id: string): boolean { return typeof id === "string" && id.trim() === id && id.length > 0; }
function validVersion(version: number): boolean { return Number.isSafeInteger(version) && version > 0; }

/** Resolve decoded declarations, without evaluating any plugin loader,
 * registering services, changing configuration or granting runtime authority. */
export function resolveBuiltinPlugins<T extends BuiltinPluginManifest>(
  definitions: readonly T[], selectedPluginIds: readonly string[], coreCapabilities: readonly BuiltinCapabilityContract[],
): BuiltinPluginComposition<T> {
  const catalog = new Map<string, T>();
  for (const definition of definitions) {
    if (!validId(definition.id) || definition.id === "core") fail({code: "plugin_invalid_contract", pluginId: definition.id});
    if (catalog.has(definition.id)) fail({code: "plugin_duplicate_id", pluginId: definition.id});
    catalog.set(definition.id, definition);
  }
  const selected = new Set<string>();
  const requested = new Set<string>();
  const include = (id: string, consumer?: string): void => {
    const definition = catalog.get(id);
    if (!definition) fail({code: consumer ? "plugin_dependency_missing" : "plugin_unknown_id", pluginId: consumer ?? id, ...(consumer ? {dependencyId: id} : {})});
    if (selected.has(id)) return;
    if (definition.apiVersion !== 1) fail({code: "plugin_api_incompatible", pluginId: id, expectedVersion: 1, actualVersion: definition.apiVersion});
    selected.add(id);
    for (const dependency of definition.dependencies.required) include(dependency.id, id);
  };
  for (const id of selectedPluginIds) {
    if (requested.has(id)) fail({code: "plugin_duplicate_id", pluginId: id});
    requested.add(id); include(id);
  }
  const plugins = definitions.filter(definition => selected.has(definition.id));
  const unavailableOptional: BuiltinCompositionDiagnostic[] = [];
  const blockedProviders = new Map<string, Set<string>>();
  const dependencies = new Map<string, readonly string[]>();
  for (const plugin of plugins) {
    const seen = new Set<string>();
    const compatible: string[] = [];
    for (const [optional, values] of [[false, plugin.dependencies.required], [true, plugin.dependencies.optional]] as const) {
      for (const dependency of values) {
        if (!validId(dependency.id) || !validVersion(dependency.apiVersion) || seen.has(dependency.id))
          fail({code: "plugin_invalid_contract", pluginId: plugin.id, dependencyId: dependency.id});
        seen.add(dependency.id);
        const provider = selected.has(dependency.id) ? catalog.get(dependency.id) : undefined;
        const diagnostic: BuiltinCompositionDiagnostic | undefined = !provider
          ? {code: "plugin_dependency_missing", pluginId: plugin.id, dependencyId: dependency.id}
          : provider.apiVersion !== dependency.apiVersion
            ? {code: "plugin_dependency_incompatible", pluginId: plugin.id, dependencyId: dependency.id,
              expectedVersion: dependency.apiVersion, actualVersion: provider.apiVersion} : undefined;
        if (diagnostic) {
          if (!optional) fail(diagnostic);
          unavailableOptional.push(diagnostic);
          const blocked = blockedProviders.get(plugin.id) ?? new Set<string>();
          blocked.add(dependency.id); blockedProviders.set(plugin.id, blocked);
        } else compatible.push(dependency.id);
      }
    }
    dependencies.set(plugin.id, compatible);
  }
  const activationOrder: T[] = [];
  const complete = new Set<string>();
  const active: string[] = [];
  const visit = (id: string): void => {
    if (complete.has(id)) return;
    const cycleAt = active.indexOf(id);
    if (cycleAt >= 0) fail({code: "plugin_dependency_cycle", pluginId: id, cycle: [...active.slice(cycleAt), id]});
    active.push(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    active.pop(); complete.add(id); activationOrder.push(catalog.get(id)!);
  };
  for (const plugin of plugins) visit(plugin.id);

  const providers = new Map<string, Array<{readonly provider: string; readonly version: number}>>();
  const register = (owner: string, contracts: readonly BuiltinCapabilityContract[]): void => {
    const seen = new Set<string>();
    for (const contract of contracts) {
      if (!validId(contract.id) || !validVersion(contract.version))
        fail({code: "plugin_invalid_contract", pluginId: owner, capabilityId: contract.id});
      if (seen.has(contract.id)) fail({code: "plugin_capability_duplicate", pluginId: owner, capabilityId: contract.id, provider: owner});
      seen.add(contract.id);
      const values = providers.get(contract.id) ?? [];
      values.push({provider: owner, version: contract.version}); providers.set(contract.id, values);
    }
  };
  register("core", coreCapabilities);
  for (const plugin of plugins) register(plugin.id, plugin.provides);
  const bindings: BuiltinCapabilityBinding[] = [];
  const bind = (plugin: T, contract: BuiltinCapabilityRequirement, optional: boolean): void => {
    if (!validId(contract.id) || !validVersion(contract.version) || contract.provider !== undefined && !validId(contract.provider))
      fail({code: "plugin_invalid_contract", pluginId: plugin.id, capabilityId: contract.id});
    const available = (providers.get(contract.id) ?? []).filter(value =>
      (!contract.provider || value.provider === contract.provider) && !blockedProviders.get(plugin.id)?.has(value.provider));
    const compatible = available.filter(value => value.version === contract.version);
    let diagnostic: BuiltinCompositionDiagnostic | undefined;
    if (!available.length) diagnostic = {code: "plugin_capability_missing", pluginId: plugin.id, capabilityId: contract.id,
      ...(contract.provider ? {provider: contract.provider} : {})};
    else if (!compatible.length) diagnostic = {code: "plugin_capability_incompatible", pluginId: plugin.id, capabilityId: contract.id,
      ...(contract.provider ? {provider: contract.provider} : {}), expectedVersion: contract.version,
      ...(available.length === 1 ? {actualVersion: available[0]!.version} : {})};
    else if (compatible.length > 1) diagnostic = {code: "plugin_capability_ambiguous", pluginId: plugin.id, capabilityId: contract.id};
    if (diagnostic) {
      // Optional absence/incompatibility is a feature state; ambiguity is an
      // invalid assembly and cannot silently become an arbitrary provider.
      if (!optional || diagnostic.code === "plugin_capability_ambiguous") fail(diagnostic);
      unavailableOptional.push(diagnostic); return;
    }
    bindings.push({pluginId: plugin.id, capabilityId: contract.id, version: contract.version, provider: compatible[0]!.provider});
  };
  for (const plugin of plugins) {
    const seen = new Set<string>();
    for (const [optional, values] of [[false, plugin.consumes.required], [true, plugin.consumes.optional]] as const) {
      for (const contract of values) {
        if (seen.has(contract.id)) fail({code: "plugin_invalid_contract", pluginId: plugin.id, capabilityId: contract.id});
        seen.add(contract.id); bind(plugin, contract, optional);
      }
    }
  }
  return {plugins, activationOrder, bindings, unavailableOptional};
}
