import {expect,it} from "vitest";
import {decodeNoteSearchPosting as decode,encodeNoteSearchPosting as encode} from "./catalogPostingCodec";
import {noteSearchCandidateOrdinals,updateNoteSearchPosting} from "./catalogSearchTokens";

it("keeps deployed sparse vectors and isolated high components without allocating a bitmap",() => {
  for (const values of [new Uint32Array(),new Uint32Array([2,3]),new Uint32Array([2,0xffff_ffff]),Uint32Array.from({length: 128},(_,i) => i === 127 ? 0xffff_fffe : i + 2)]) {
    expect(encode(values)).toBe(values);
    expect(decode(values)).toBe(values);
  }
  expect(decode(undefined)).toEqual(new Uint32Array());
});

it("stores dense components compactly and preserves exact candidate identities",() => {
  const values = Uint32Array.from({length: 5000},(_,i) => i + 2), record = encode(values);
  expect(record).not.toBeInstanceOf(Uint32Array);
  if (record instanceof Uint32Array) throw Error("dense record was not selected");
  expect(record.encoding).toBe("u32-bitmap-v1");
  expect(record.count).toBe(5000);
  expect(record.bytes.byteLength).toBeLessThan(values.byteLength / 16);
  expect(decode(structuredClone(record))).toEqual(values);
  expect(noteSearchCandidateOrdinals(decode(record))).toEqual(noteSearchCandidateOrdinals(values));
});

it("moves back to sparse storage after removals without changing membership",() => {
  let values = decode(encode(Uint32Array.from({length: 400},(_,i) => i + 2)));
  for (let component = 2; component < 390; component++) values = updateNoteSearchPosting(values,component,false);
  const sparse = encode(values);
  expect(sparse).toBeInstanceOf(Uint32Array);
  expect([...decode(sparse)]).toEqual(Array.from({length: 12},(_,i) => i + 390));
});

it("bounds bitmap size and accepts the highest permitted bitmap component",() => {
  const values = Uint32Array.from({length: 40000},(_,i) => i === 39999 ? 524287 : i + 2), record = encode(values);
  expect(record).not.toBeInstanceOf(Uint32Array);
  if (record instanceof Uint32Array) throw Error("bounded bitmap expected");
  expect(record.bytes.length).toBe(65536);
  expect(decode(record)).toEqual(values);
  values[39999] = 524288;
  expect(encode(values)).toBe(values);
});

it("rejects corrupt records before trusting cardinality or allocating output",() => {
  const good = {encoding: "u32-bitmap-v1",count: 1,bytes: new Uint8Array([4])};
  const invalid: unknown[] = [null,"record",[2,3],new Uint8Array([2]),new Uint16Array([2]),new Uint32Array([2,2]),new Uint32Array([3,2]),new Uint32Array([1]),
    {},{...good,encoding: "future"},{...good,extra: true},{...good,count: 0},{...good,count: -1},{...good,count: 1.5},{...good,count: Number.NaN},
    {...good,count: Number.MAX_SAFE_INTEGER},{...good,count: 2},{...good,bytes: [4]},{...good,bytes: new Uint8Array()},
    {...good,bytes: new Uint8Array([1])},{...good,bytes: new Uint8Array([2])},{...good,bytes: new Uint8Array([4,0])},{...good,bytes: new Uint8Array(65537)}];
  for (const value of invalid) expect(() => decode(value)).toThrow(/note_search_postings_invalid/u);
  for (const value of [new Uint32Array([0]),new Uint32Array([2,2]),new Uint32Array([4,2])]) expect(() => encode(value)).toThrow(/note_search_postings_invalid/u);
});
