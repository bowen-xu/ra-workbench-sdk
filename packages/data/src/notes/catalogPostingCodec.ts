import {invalidNotePosting,validatePostingValues} from "./catalogPostingValidation";

/** Private index components only. Neither form contains resource identities,
 * permissions, authoring versions or a save receipt. This is not Roaring's
 * portable format. Old sparse rows remain valid without a rebuild. */
export type StoredNoteSearchPosting = Uint32Array | {
  readonly encoding: "u32-bitmap-v1";
  readonly count: number;
  readonly bytes: Uint8Array;
};

// Bounds bitmap decoding to at most 524288 components / 2 MiB output. Sparse or
// high ordinals use the original vector, never allocate up to an isolated ID.
const MAX_BITMAP_BYTES = 64 * 1024;
const BITMAP_OVERHEAD_BYTES = 64;

export function encodeNoteSearchPosting(values: Uint32Array): StoredNoteSearchPosting {
  validatePostingValues(values,2);
  const maximum = values.at(-1);
  if (maximum === undefined) return values;
  const length = Math.floor(maximum / 8) + 1;
  if (length > MAX_BITMAP_BYTES || length + BITMAP_OVERHEAD_BYTES > values.byteLength / 2) return values;
  const bytes = new Uint8Array(length);
  for (const component of values) bytes[component >>> 3]! |= 1 << (component & 7);
  return {encoding: "u32-bitmap-v1",count: values.length,bytes};
}

/** Validate before allocating decoded output; a corrupt declared count cannot
 * force allocation. Bitmap length, reserved components, canonical tail and
 * actual cardinality all participate in the persisted-format boundary. */
export function decodeNoteSearchPosting(value: unknown): Uint32Array {
  if (value === undefined) return new Uint32Array();
  if (value instanceof Uint32Array) {validatePostingValues(value,2);return value;}
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 3 || Object.keys(value).some(key => !["encoding","count","bytes"].includes(key))) return invalidNotePosting();
  const row = value as Partial<Exclude<StoredNoteSearchPosting,Uint32Array>>;
  const {bytes,count} = row;
  if (row.encoding !== "u32-bitmap-v1" || !(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_BITMAP_BYTES
    || bytes[0]! & 3 || bytes.at(-1) === 0 || !Number.isSafeInteger(count) || count === undefined || count < 1 || count > bytes.length * 8) return invalidNotePosting();
  let cardinality = 0;
  for (let bits of bytes) while (bits) {bits &= bits - 1;cardinality++;}
  if (cardinality !== count) return invalidNotePosting();
  const members = new Uint32Array(count);
  let index = 0;
  for (let byte = 0; byte < bytes.length; byte++) {
    let bits = bytes[byte]!;
    while (bits) {
      const bit = 31 - Math.clz32(bits & -bits);
      members[index++] = byte * 8 + bit;
      bits &= bits - 1;
    }
  }
  return members;
}
