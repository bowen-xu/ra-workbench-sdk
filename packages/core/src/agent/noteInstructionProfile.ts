import type { AgentSubmissionInput } from "./submission";
import { validateApplicationSkills } from "./skills";

/** Shared submission decoding has already checked byte bounds and dispositions.
 * Note hosts accept their own user profile plus bounded Session/Turn patches,
 * never workspace AGENTS. Generic decoding has checked layer order and limits. */
export function validateNoteInstructionProfile(input: AgentSubmissionInput, kind: "note" | "readingNote", id: string): void {
  const reject = (): never => { throw new Error("Invalid note instruction profile"); };
  validateApplicationSkills(input.skills);
  const instructions = input.instructions ?? [], configs = input.instructionConfigs ?? [];
  if (!instructions.length && !configs.length) return;
  const fragment = instructions[0], config = configs[0], layer = config?.layers[0];
  const scope = `${kind === "note" ? "note" : "reading-note"}:${id}`;
  const source = `agent/config.toml#profiles.${kind === "note" ? "note" : "reading_note"}`;
  if (instructions.length !== 1 || configs.length !== 1 || !fragment || !config || !layer
    || fragment.environmentId !== scope || fragment.scopeId !== scope || config.environment_id !== scope
    || fragment.sourceId !== source || layer.origin.source_id !== source || layer.origin.tier !== "user"
    || !/^[a-f0-9]{64}$/.test(fragment.revision) || layer.origin.revision !== fragment.revision
    || layer.instructions.fallback_filenames !== null || fragment.originalBytes > 65536
    || layer.instructions.max_bytes === null) return reject();
  let budget = layer.instructions.max_bytes;
  for (const override of config.layers.slice(1)) {
    const tier = override.origin.tier;
    if ((tier !== "session" && tier !== "turn")
      || override.origin.source_id !== `profile:${tier === "session" ? "Session" : "Turn"}`
      || !/^[a-f0-9]{64}$/.test(override.origin.revision)) return reject();
    budget = override.instructions.max_bytes ?? budget;
  }
  // Framework-free UTF-8 count; generic decoding has rejected lone surrogates.
  let bytes = 0;
  for (const character of fragment.text) {
    const point = character.codePointAt(0)!;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  if (bytes > budget) reject();
}
