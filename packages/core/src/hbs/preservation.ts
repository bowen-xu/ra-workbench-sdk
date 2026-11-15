import { applyTextPatch, createTextPatch, type TextPatch } from "./patch";
import { createDraft, paragraph, type ModelDraft, type ModelSnapshot } from "./model";
import type { TextDiff } from "./textDiff";
import type { MaybePromise } from "./ports";

export interface HbsPreservation {
  readonly content: string;
  readonly observed: ModelSnapshot;
  readonly input: Pick<ModelDraft, "base" | "baseline" | "kind" | "syncBase">;
  readonly ordinary: readonly TextPatch[];
}
export interface HbsPreservationStore {
  readonly durable: boolean;
  /** Resource-owned adapter: reads and writes must remain ordered across all
   * sessions using that resource. Cross-process epochs/CAS belong to storage. */
  load(): MaybePromise<HbsPreservation | undefined>;
  save(value: HbsPreservation): MaybePromise<void>;
}
export function capturePreservation(observed: ModelSnapshot, draft: ModelDraft | undefined, id: string, calculate: TextDiff): HbsPreservation {
  const input = draft ?? createDraft(observed, id, paragraph(observed.saved, id).text);
  return { content: input.value, observed, input: { base: input.base, ...(input.syncBase===undefined?{}:{syncBase:input.syncBase}),baseline: input.baseline, kind: input.kind },
    ordinary: createTextPatch(input.baseline, input.editedBaseline ?? input.baseline, calculate) };
}
export function restorePreservation(value: HbsPreservation, id: string): ModelDraft {
  paragraph(value.observed.saved, id);
  return { id, value: value.content, ...value.input, editedBaseline: applyTextPatch(value.input.baseline, value.ordinary) };
}
export class MemoryHbsPreservationStore implements HbsPreservationStore {
  readonly durable = false;
  private value: HbsPreservation | undefined;
  load(): HbsPreservation | undefined { return this.value && clone(this.value); }
  save(value: HbsPreservation): void { this.value = clone(value); }
}
function clone(value: HbsPreservation): HbsPreservation {
  return { ...value, input: { ...value.input }, ordinary: value.ordinary.map(patch => ({ ...patch })),
    observed: { ...value.observed, saved: value.observed.saved.map(item => ({ ...item })), baseline: value.observed.baseline.map(item => ({ ...item })) } };
}

/** Serializes asynchronous database/file checkpoints. An earlier completion
 * never reports that a later H is durable. Errors do not poison later retries. */
export class HbsCheckpointWriter {
  private tail: Promise<void> | undefined;
  private sequence = 0;
  constructor(private readonly store: HbsPreservationStore,
    private readonly complete: (record: HbsPreservation, error?: unknown) => void) {}
  write(record: HbsPreservation): void | Promise<void> {
    const sequence = ++this.sequence;
    const done = (error?: unknown) => { if (sequence === this.sequence) this.complete(record, error); };
    const run = () => {
      try {
        const result = this.store.save(record);
        if (result) return Promise.resolve(result).then(() => done(), error => done(error));
        done();
      } catch (error) { done(error); }
    };
    const result = this.tail ? this.tail.then(run) : run();
    if (result) {
      const settled = Promise.resolve(result).then(() => { if (this.tail === settled) this.tail = undefined; });
      this.tail = settled; return settled;
    }
  }
}
