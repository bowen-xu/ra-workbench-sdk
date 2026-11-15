import {expect,it} from "vitest";
import {updateNoteSearchPostingBatch as update} from "./catalogPostingBatch";

it("applies the last decision per component without mutating the persisted vector",() => {
  const before = Uint32Array.of(2,8,0xffff_ffff);
  expect([...update(before,[[8,false],[3,true],[8,true],[0xffff_ffff,false],[7,false]])]).toEqual([2,3,8]);
  expect([...before]).toEqual([2,8,0xffff_ffff]);
});

it("preserves input identity for final membership no-ops",() => {
  const before = Uint32Array.of(2,8);
  expect(update(before,[])).toBe(before);
  expect(update(before,[[2,true],[7,false]])).toBe(before);
  expect(update(before,[[2,false],[2,true],[5,true],[5,false]])).toBe(before);
  expect([...update(before,[[2,false],[8,false]])]).toEqual([]);
  expect([...update(new Uint32Array(),[[0xffff_ffff,true],[2,true]])]).toEqual([2,0xffff_ffff]);
});

it("matches a set oracle for mixed dense, sparse, repeated and unsigned updates",() => {
  let seed = 0x71a2fe34;
  const next = () => {seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;return seed;};
  for (let run = 0; run < 128; run++) {
    const initial = new Set(Array.from({length: run * 3},() => run % 2 ? next() % 256 + 2 : Math.max(2,next())));
    const before = Uint32Array.from([...initial].sort((a,b) => a - b)), snapshot = before.slice();
    const updates = Array.from({length: 256},() => [run % 2 ? next() % 256 + 2 : Math.max(2,next()),Boolean(next() & 0x100)] as const);
    for (const [component,include] of updates) {if (include) initial.add(component);else initial.delete(component);}
    expect([...update(before,updates)]).toEqual([...initial].sort((a,b) => a - b));
    expect(before).toEqual(snapshot);
  }
});

it("retains corruption diagnostics even when the proposed update is empty",() => {
  for (const value of [Uint32Array.of(1),Uint32Array.of(3,2),Uint32Array.of(2,2),new Uint16Array([2])])
    expect(() => update(value as Uint32Array,[])).toThrow("note_search_postings_invalid");
  for (const component of [-1,0,1,2.5,Number.NaN,Number.POSITIVE_INFINITY,0x1_0000_0000])
    expect(() => update(new Uint32Array(),[[component,true]])).toThrow("note_search_postings_invalid");
  expect(() => update(new Uint32Array(),[[2,1 as unknown as boolean]])).toThrow("note_search_postings_invalid");
});
