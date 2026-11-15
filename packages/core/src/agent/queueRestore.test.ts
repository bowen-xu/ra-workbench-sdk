import { expect, it } from "vitest";
import { decodeAgentQueueCommand } from "./submission";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const edit = {type: "restore", inputId: id(1), sourceInputId: id(2), index: 1, text: "edited", userInput: []};
it("strictly decodes an atomic queue restore and rejects forged provenance and invalid positions", () => {
  const command = {requestId: id(3), expectedRevision: 2, edit};
  expect(decodeAgentQueueCommand(command)).toEqual(command);
  for (const index of [-1, 65, 0.5, NaN, "1"]) expect(() => decodeAgentQueueCommand({...command, edit: {...edit, index}})).toThrow();
  expect(() => decodeAgentQueueCommand({...command, edit: {...edit, origin: {kind: "note", resourceId: id(4)}}})).toThrow();
  expect(() => decodeAgentQueueCommand({...command, edit: {...edit, paused: true}})).toThrow();
});
