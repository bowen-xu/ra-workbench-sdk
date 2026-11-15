import { expect, it } from "vitest";
import { createStructuredDocumentAdapter } from "./adapters";
import { DocumentVersionConflict } from "./document";
import { HbsSession } from "./session";

const empty = { schemaVersion: 1, persistent: [], temporary: [] };
const resource = (id: string) => ({ label: id, resource: { kind: "paperMetadata", resourceId: id } });
const local = { ...empty, persistent: [resource("local")] };
const remote = { ...empty, persistent: [resource("remote")] };
const diff = (a: string, b: string) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }];

it.each(["incoming", "keep"] as const)("resolves a simultaneous ordinary S/B structural conflict with %s", async action => {
  const adapter = createStructuredDocumentAdapter(diff);
  let server: { version: number; saved: unknown; baseline: unknown } = { version: 1, saved: empty, baseline: empty }, sequence = 0;
  const port = { read: async () => server, commit: async (request: { expectedVersion: number; saved: unknown; baseline: unknown }) => {
    if (request.expectedVersion !== server.version) throw new DocumentVersionConflict(server, "id");
    server = { version: server.version + 1, saved: request.saved, baseline: request.baseline }; return server;
  } };
  const session = await HbsSession.open({ adapter, port, preservation: { load: () => undefined, save: () => undefined }, requestId: () => String(++sequence) });
  session.edit(local); server = { version: 2, saved: remote, baseline: remote }; session.receive(server);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  const conflict = session.getSnapshot().conflicts[0]; expect(conflict).toBeDefined();
  session.resolve(conflict!.id, action);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  await session.save(); for (let i = 0; i < 100; i++) await Promise.resolve();
  const expected = action === "incoming" ? remote : local;
  expect(session.getSnapshot().conflicts).toHaveLength(0);
  expect(session.getSnapshot().content).toEqual(expected);
  expect(session.getSnapshot().baselineProjection).toEqual(expected);
  expect(server.saved).toEqual(expected); expect(server.baseline).toEqual(expected);
  session.dispose();
});

it("does not turn a conflicting candidate selection into an accepted baseline", async () => {
  const adapter = createStructuredDocumentAdapter(diff);
  const initial = { version: 1, saved: empty, baseline: empty };
  const session = await HbsSession.open({ adapter, port: { read: async () => initial, commit: async () => { throw Error("unexpected commit"); } },
    preservation: { load: () => undefined, save: () => undefined }, requestId: () => "id" });
  session.edit(local, empty);
  session.receive({ version: 2, saved: remote, baseline: empty });
  const conflict = session.getSnapshot().conflicts[0]; expect(conflict).toBeDefined();
  session.resolve(conflict!.id, "incoming");
  await session.flushPreservation();
  expect(session.getSnapshot().content).toEqual(remote);
  expect(session.getSnapshot().baselineProjection).toEqual(empty);
  expect(session.getSnapshot().changes.length).toBeGreaterThan(0);
  session.dispose();
});
