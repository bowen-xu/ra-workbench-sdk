import type { NalState, NalMutation, NalAnnotation } from "@research-assistant/core/nal";
export interface NalAnnotationRequest {
  readonly targetKind: "concept" | "statement";
  readonly targetId: string;
  readonly title: string;
}
export interface NalGateway {
  read(): Promise<NalState>;
  mutate(mutation: NalMutation, expectedRevision: number): Promise<NalState>;
  /** Reuses the target's single note, including archived/trashed notes. */
  ensureAnnotation(request: NalAnnotationRequest): Promise<NalAnnotation>;
}

export interface NalQueryStore {
  readonly revision: number;
  readonly definitions: readonly import("@research-assistant/core/nal").NalQueryCollection[];
  readonly cache: unknown;
  readonly legacyImported: boolean;
}
export interface NalQueryGateway {
  read(): Promise<NalQueryStore>;
  save(value: Omit<NalQueryStore, "revision">, expectedRevision: number): Promise<NalQueryStore>;
}
