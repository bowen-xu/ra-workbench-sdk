/** Frozen catalog metadata and host-resolved invocation policy, never file grants. */
export interface AgentSubmissionSkill {
  readonly descriptor: {
    readonly identity: { readonly environment_id: string; readonly source_id: string; readonly revision: string };
    readonly name: string;
    readonly description: string;
    readonly allow_implicit_invocation: boolean;
  };
  readonly explicit: boolean;
}
/** Mirrors native application skill admission for hosts without manuscript roots.
 * Metadata does not grant file access; native discovery/load remains authoritative. */
export function validateApplicationSkills(skills: readonly AgentSubmissionSkill[] = []): void {
  for (const skill of skills) {
    const { environment_id, source_id } = skill.descriptor.identity;
    if (environment_id !== "application" || !source_id.startsWith(".agents/skills/")) {
      throw new Error("Invalid application skill scope");
    }
  }
}
export function decodeSubmissionSkills(value: unknown, fail: () => never): readonly AgentSubmissionSkill[] {
  const bytes = (value: string): number => {
    let total = 0;
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) return fail();
      total += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    return total;
  };
  const object = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) return fail();
    return row;
  };
  const name = (value: unknown, limit = 1024): string => {
    if (typeof value !== "string" || !value.trim() || bytes(value) > limit || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return fail();
    return value;
  };
  if (!Array.isArray(value) || value.length > 256 || bytes(JSON.stringify(value)) > 2097152) return fail();
  const sources = new Set<string>();
  let descriptionBytes = 0;
  return value.map((entry) => {
    const row = object(entry, ["descriptor", "explicit"]);
    const descriptor = object(row.descriptor, ["identity", "name", "description", "allow_implicit_invocation"]);
    const identity = object(descriptor.identity, ["environment_id", "source_id", "revision"]);
    const environment_id = name(identity.environment_id), source_id = name(identity.source_id), revision = name(identity.revision);
    const key = JSON.stringify([environment_id, source_id]);
    if (sources.has(key)) return fail();
    sources.add(key);
    const description = descriptor.description;
    if (typeof description !== "string" || !description.trim() || description.includes("\0") || bytes(description) > 65536) return fail();
    descriptionBytes += bytes(description);
    if (descriptionBytes > 1048576 || typeof descriptor.allow_implicit_invocation !== "boolean" || typeof row.explicit !== "boolean") return fail();
    return { descriptor: { identity: { environment_id, source_id, revision }, name: name(descriptor.name, 256), description, allow_implicit_invocation: descriptor.allow_implicit_invocation }, explicit: row.explicit };
  });
}
