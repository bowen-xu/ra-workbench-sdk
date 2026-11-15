export type ReaderLifecycleState = "active" | "hidden" | "trimmed" | "suspended" | "disposed";

export type ReaderLifecycleEvent = "activate" | "hide" | "trim" | "suspend" | "dispose";

export function nextReaderLifecycleState(
  state: ReaderLifecycleState,
  event: ReaderLifecycleEvent,
): ReaderLifecycleState {
  if (state === "disposed" || event === "dispose") return "disposed";
  if (event === "activate") return "active";
  if (event === "hide") return state === "active" ? "hidden" : state;
  if (event === "trim") return state === "active" || state === "hidden" ? "trimmed" : state;
  if (event === "suspend") return state === "hidden" || state === "trimmed" ? "suspended" : state;
  return state;
}
