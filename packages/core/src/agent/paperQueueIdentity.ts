/** Paper IDs remain opaque; preserve the existing queue scope contract and bytes. */
export function isAgentPaperQueueId(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && !value.includes("\0") && [...value].length <= 256;
}
