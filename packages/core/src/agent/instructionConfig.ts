/** Frozen native configuration inputs, not filesystem or tool grants. */
export interface AgentInstructionConfigSnapshot {
  readonly environment_id: string;
  readonly layers: readonly {
    readonly origin: { readonly tier: string; readonly source_id: string; readonly revision: string };
    readonly instructions: { readonly max_bytes: number | null; readonly fallback_filenames: readonly string[] | null };
  }[];
}
const tiers = ["application", "user", "workspace", "directory", "session", "turn"];
export function decodeInstructionConfigs(value: unknown, fail: () => never): readonly AgentInstructionConfigSnapshot[] {
  const bytes = (text: string): number => {
    let length = 0;
    for (const character of text) {
      const code = character.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) return fail();
      length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return length;
  };
  const object = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
    return row;
  };
  const name = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim() || bytes(value) > 1024 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return fail();
    return value;
  };
  if (!Array.isArray(value) || value.length > 64 || bytes(JSON.stringify(value)) > 1048576) return fail();
  const environments = new Set<string>();
  let layerCount = 0;
  return value.map((entry) => {
    const row = object(entry, ["environment_id", "layers"]);
    const environment_id = name(row.environment_id);
    if (environments.has(environment_id) || !Array.isArray(row.layers)) return fail();
    environments.add(environment_id);
    layerCount += row.layers.length;
    if (layerCount > 256) return fail();
    let previous = -1;
    const sources = new Set<string>();
    const layers = row.layers.map((entry) => {
      const layer = object(entry, ["origin", "instructions"]);
      const origin = object(layer.origin, ["tier", "source_id", "revision"]);
      const tier = typeof origin.tier === "string" ? origin.tier : fail();
      const rank = tiers.indexOf(tier);
      const source_id = name(origin.source_id);
      const revision = name(origin.revision);
      const key = JSON.stringify([tier, source_id]);
      if (rank < 0 || rank < previous || sources.has(key)) return fail();
      sources.add(key); previous = rank;
      const patch = object(layer.instructions, ["max_bytes", "fallback_filenames"]);
      const max_bytes = patch.max_bytes;
      if (max_bytes !== null && (typeof max_bytes !== "number" || !Number.isSafeInteger(max_bytes) || max_bytes < 0 || max_bytes > 1048576)) return fail();
      let fallback_filenames: string[] | null = null;
      if (patch.fallback_filenames !== null) {
        if (!Array.isArray(patch.fallback_filenames) || patch.fallback_filenames.length > 64) return fail();
        fallback_filenames = patch.fallback_filenames.map((filename) => {
          if (typeof filename !== "string" || bytes(filename) > 255 || filename === "." || filename === ".." || /[\\/:\u0000-\u001f\u007f-\u009f]/u.test(filename)) return fail();
          return filename;
        });
      }
      return { origin: { tier, source_id, revision }, instructions: { max_bytes, fallback_filenames } };
    });
    return { environment_id, layers };
  });
}
