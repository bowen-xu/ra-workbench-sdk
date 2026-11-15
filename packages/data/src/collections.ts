import type { CollectionMutation, CollectionState } from "@research-assistant/core/collections";
/** Mutations are atomic and reject stale snapshots; no operation deletes literature. */
export interface CollectionGateway {
  read(): Promise<CollectionState>;
  mutate(mutation: CollectionMutation, expectedRevision: number): Promise<CollectionState>;
}
