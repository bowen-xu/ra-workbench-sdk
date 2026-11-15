export interface BuiltinPluginRequirement {
  readonly id: string;
  readonly apiVersion: number;
}

export interface BuiltinCapabilityContract {
  readonly id: string;
  readonly version: number;
}

export interface BuiltinCapabilityRequirement extends BuiltinCapabilityContract {
  /** Core and a particular plugin are explicit provider identities, not permissions. */
  readonly provider?: string;
}

/** Declarative assembly input. Availability does not authorize a model/tool run. */
export interface BuiltinPluginManifest {
  readonly id: string;
  readonly apiVersion: number;
  readonly dependencies: {
    readonly required: readonly BuiltinPluginRequirement[];
    readonly optional: readonly BuiltinPluginRequirement[];
  };
  readonly provides: readonly BuiltinCapabilityContract[];
  readonly consumes: {
    readonly required: readonly BuiltinCapabilityRequirement[];
    readonly optional: readonly BuiltinCapabilityRequirement[];
  };
}
