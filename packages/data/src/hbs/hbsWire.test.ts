import { expect, it } from "vitest";
import { HbsCommitError, applyTextPatch, type HbsCommitRequest, type HbsSnapshot } from "@research-assistant/core/hbs";
import { HbsWireAuthority, HbsWireClient, MemoryHbsRepository, encodeHbsCommit, type HbsWireEncoding } from "./index";

const initial: HbsSnapshot = { version: 1, saved: [{ id: "doc", label: "Document", text: "first\nvalue 80%\nlast" }], baseline: [{ id: "doc", label: "Document", text: "first\nvalue 80%\nlast" }] };
const modes: readonly HbsWireEncoding[] = [{ type: "snapshot" }, { type: "patch", calculate: (a, b) => a === b ? [] : [{ fromA: 0, toA: a.length, fromB: 0, toB: b.length }] }];
const request = (id = "write-1", base = initial, value = "changed"): HbsCommitRequest => ({ id, base, expectedVersion: base.version,
  updates: [{ id: "doc", saved: value, baseline: base.baseline[0]!.text }] });

it.each(modes)("uses real $type encoding with the same authority CAS and exact-request retry", async mode => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository), wires: string[] = [];
  const port = await HbsWireClient.connect({ request: async wire => { wires.push(wire); return authority.handle(wire); } }, mode);
  const update = request(); const result = await port.commit(update);
  expect(result.version).toBe(2); expect(repository.read().baseline).toEqual(initial.baseline);
  const commit = JSON.parse(wires[1]!) as Record<string, unknown>;
  expect(commit.encoding).toBe(mode.type); expect(commit).toHaveProperty(mode.type === "patch" ? "patches" : "snapshot");
  expect(await port.commit(update)).toEqual(result); expect(repository.read().version).toBe(2);
  await expect(port.commit(request("write-1", initial, "different"))).rejects.toThrow("MODEL_REQUEST_ID_REUSED");
  expect(await port.syncLatest(2)).toBeUndefined(); port.dispose();
});
it.each(modes)("rejects a stale $type commit with current complete S/B", async mode => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository);
  const port = await HbsWireClient.connect({ request: wire => authority.handle(wire) }, mode);
  await repository.commit(1, [{ id: "doc", saved: "external", baseline: initial.baseline[0]!.text }]);
  const error = await port.commit(request()).catch(error => error as unknown);
  expect(error).toBeInstanceOf(HbsCommitError); expect((error as HbsCommitError).snapshot.saved[0]!.text).toBe("external");
  expect(repository.read().version).toBe(2); port.dispose();
});
it("does not partially write S when B patch validation fails", async () => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository);
  const response = JSON.parse(await authority.handle(JSON.stringify({ type: "commit", id: "bad", expectedVersion: 1, encoding: "patch",
    patches: [{ id: "doc", saved: [{ from: 0, to: 5, insert: "new" }], baseline: [{ from: 99, to: 100, insert: "bad" }] }] }))) as { type: string; error: string };
  expect(response.type).toBe("rejection"); expect(response.error).toContain("MODEL_INVALID_PATCH"); expect(repository.read()).toEqual(initial);
});
it("uses repository CAS across independent authorities", async () => {
  const repository = new MemoryHbsRepository(initial), left = new HbsWireAuthority(repository), right = new HbsWireAuthority(repository);
  const replies = await Promise.all([left.handle(encodeHbsCommit(request("left"), modes[0]!)), right.handle(encodeHbsCommit(request("right"), modes[0]!))]);
  expect(replies.map(wire => (JSON.parse(wire) as { type: string }).type).sort()).toEqual(["receipt", "rejection"]);
  expect(repository.read().version).toBe(2);
});
it("keeps the old snapshot after an asynchronous durable write fails", async () => {
  const repository = new MemoryHbsRepository(initial, async () => { throw new Error("MODEL_STORAGE_FAILED: file write failed"); });
  const authority = new HbsWireAuthority(repository);
  const response = await authority.handle(encodeHbsCommit(request(), modes[0]!));
  expect(response).toContain("MODEL_STORAGE_FAILED"); expect(response).toContain("write-1"); expect(repository.read()).toEqual(initial);
});
it("retries the identical serialized request after its receipt is lost", async () => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository); let lost = false;
  const port = await HbsWireClient.connect({ request: async wire => {
    const response = await authority.handle(wire);
    if (wire.includes('"commit"') && !lost) { lost = true; throw new Error("NETWORK_ACK_LOST"); } return response;
  } }, modes[1]!);
  await expect(port.commit(request())).rejects.toThrow("MODEL_TRANSPORT_FAILED：NETWORK_ACK_LOST（request write-1）");
  expect((await port.commit(request())).version).toBe(2); expect(repository.read().version).toBe(2); port.dispose();
});
it("preserves CRLF and UTF-16 patch coordinates without depending on an editor runtime", () => {
  expect(applyTextPatch("a\r\n😀b", [{ from: 3, to: 5, insert: "λ" }])).toBe("a\r\nλb");
});
it("retains pushed snapshots while an asynchronous recovery store is still opening", async () => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository);
  let notify: ((wire: string) => void) | undefined;
  const port = await HbsWireClient.connect({ request: wire => authority.handle(wire), subscribe: listener => { notify = listener; return () => { notify = undefined; }; } }, modes[0]!);
  const next = await repository.commit(1, [{ id: "doc", saved: "external", baseline: initial.baseline[0]!.text }]);
  notify?.(JSON.stringify({ type: "snapshot", requestId: "push", snapshot: next }));
  expect(port.initialSnapshot).toEqual(next); port.dispose();
});
it("buffers a write arriving between the initial read and its reply", async () => {
  const repository = new MemoryHbsRepository(initial), authority = new HbsWireAuthority(repository);
  let notify: ((wire: string) => void) | undefined, unsubscribed = false;
  const port = await HbsWireClient.connect({ request: async wire => {
    const oldReply = await authority.handle(wire);
    const next = await repository.commit(1, [{ id: "doc", saved: "during handshake", baseline: initial.baseline[0]!.text }]);
    notify?.(JSON.stringify({ type: "snapshot", requestId: "push", snapshot: next })); return oldReply;
  }, subscribe: listener => { notify = listener; return () => { unsubscribed = true; }; } }, modes[0]!);
  expect(port.initialSnapshot.saved[0]!.text).toBe("during handshake"); port.dispose(); expect(unsubscribed).toBe(true);
});
