export interface AgentInstructionTrust {
  readonly schemaVersion: 1;
  readonly manuscriptId: string;
  readonly revision: number;
  readonly granted: boolean;
  readonly rootMatches: boolean;
}
export function instructionTrustId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) || /^0{8}(-0{4}){3}-0{12}$/.test(value)) throw new Error("Invalid manuscript identity");
  return value.toLowerCase();
}
export function decodeAgentInstructionTrust(value: unknown): AgentInstructionTrust {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid instruction trust response");
  const row = value as Record<string, unknown>;
  const keys = ["schemaVersion", "manuscriptId", "revision", "granted", "rootMatches"];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)) || row.schemaVersion !== 1
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 0
    || typeof row.granted !== "boolean" || typeof row.rootMatches !== "boolean"
    || (row.rootMatches && !row.granted) || (row.revision === 0 && row.granted)) throw new Error("Invalid instruction trust response");
  return { schemaVersion: 1, manuscriptId: instructionTrustId(row.manuscriptId), revision: row.revision, granted: row.granted, rootMatches: row.rootMatches };
}
