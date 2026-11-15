/** These original Native codes prove rejection only before any Unknown attempt. */
export function isAgentSteeringRejection(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  return ["invalid", "conflict", "closed", "capacity", "notSteerable", "activeTurnNotSteerable", "expectedTurnMismatch"].includes(String(code));
}
