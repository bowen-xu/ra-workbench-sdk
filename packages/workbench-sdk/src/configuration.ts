/** Finite settings schema supported by the current built-in workbench. */
export type ConfigurationSchema =
  | { readonly type: "boolean" }
  | { readonly type: "string"; readonly enum: readonly string[] }
  | { readonly type: "object"; readonly properties: Readonly<Record<string, ConfigurationSchema>> };

export type ConfigurationScope =
  | { readonly kind: "application" }
  | { readonly kind: "resource"; readonly resourceId: string };

export interface ConfigurationSetting<T = unknown> {
  readonly key: string;
  readonly schema: ConfigurationSchema;
  readonly defaultValue: T;
  readonly scopes: readonly ConfigurationScope["kind"][];
  readonly effect: "immediate";
}

export interface PluginConfigurationDeclaration {
  readonly owner: string;
  readonly settings: readonly ConfigurationSetting[];
}

export interface ConfigurationInspection<T> {
  readonly defaultValue: T;
  readonly applicationValue?: T;
  readonly resourceValue?: T;
  readonly value: T;
  readonly origin: "default" | ConfigurationScope["kind"];
  /** Invalid historical bytes are retained; a valid update can replace them. */
  readonly invalidScopes: readonly ConfigurationScope["kind"][];
}

/** An App-bound view of one plugin's declared settings. It contains no secrets,
 * storage handle, owner selector or global registration method. */
export interface PluginConfiguration {
  readonly owner: string;
  get<T>(key: string, scope?: ConfigurationScope): T;
  inspect<T>(key: string, scope?: ConfigurationScope): ConfigurationInspection<T>;
  /** undefined removes this scope's override. Validation precedes persistence. */
  update(key: string, value: unknown, scope?: ConfigurationScope): void;
  subscribe(key: string, changed: () => void): () => void;
}
