import {
  normalizeReaderLocation,
  type ReaderHistoryMode,
  type ReaderLocation,
} from "./model";

export interface ReaderNavigationHistorySnapshot {
  readonly back: readonly ReaderLocation[];
  readonly current?: ReaderLocation;
  readonly forward: readonly ReaderLocation[];
  readonly canNavigateBack: boolean;
  readonly canNavigateForward: boolean;
}

export interface ReaderNavigationHistoryOptions {
  readonly minimumPointIntervalMs?: number;
  readonly now?: () => number;
}

function locationsEqual(left: ReaderLocation | undefined, right: ReaderLocation | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ReaderNavigationHistory {
  readonly #minimumPointIntervalMs: number;
  readonly #now: () => number;
  #back: ReaderLocation[] = [];
  #current: ReaderLocation | undefined;
  #forward: ReaderLocation[] = [];
  #lastSaveWasTransient = false;
  #lastSaveAt = Number.NEGATIVE_INFINITY;

  constructor(options: ReaderNavigationHistoryOptions = {}) {
    this.#minimumPointIntervalMs = options.minimumPointIntervalMs ?? 2_000;
    this.#now = options.now ?? Date.now;
  }

  snapshot(): ReaderNavigationHistorySnapshot {
    return {
      back: [...this.#back],
      ...(this.#current === undefined ? {} : { current: this.#current }),
      forward: [...this.#forward],
      canNavigateBack: this.#back.length > 0,
      canNavigateForward: this.#forward.length > 0,
    };
  }

  save(input: ReaderLocation, mode: ReaderHistoryMode = input.history ?? "hard"): void {
    if (mode === "skip") return;
    const location = normalizeReaderLocation({ ...input, history: undefined });
    if (location === undefined) throw new TypeError("Reader history requires a valid location");
    if (locationsEqual(this.#back.at(-1), location) || locationsEqual(this.#current, location)) return;

    const savedAt = this.#now();
    const followsRecentHardPoint = !this.#lastSaveWasTransient
      && savedAt - this.#lastSaveAt < this.#minimumPointIntervalMs;
    const replaceCurrent = mode === "transient"
      && (this.#lastSaveWasTransient || this.#forward.length > 0 || followsRecentHardPoint);

    if (replaceCurrent) {
      this.#current = this.#current?.pageIndex === location.pageIndex
        ? { ...this.#current, ...location }
        : location;
    } else {
      if (this.#current !== undefined) this.#back.push(this.#current);
      this.#current = location;
      this.#forward = [];
    }
    this.#lastSaveWasTransient = mode === "transient";
    this.#lastSaveAt = savedAt;
  }

  navigateBack(): ReaderLocation | undefined {
    const target = this.#back.pop();
    if (target === undefined) return undefined;
    if (this.#current !== undefined) this.#forward.push(this.#current);
    this.#current = target;
    return target;
  }

  navigateForward(): ReaderLocation | undefined {
    const target = this.#forward.pop();
    if (target === undefined) return undefined;
    if (this.#current !== undefined) this.#back.push(this.#current);
    this.#current = target;
    return target;
  }

  clear(): void {
    this.#back = [];
    this.#current = undefined;
    this.#forward = [];
    this.#lastSaveWasTransient = false;
    this.#lastSaveAt = Number.NEGATIVE_INFINITY;
  }
}
