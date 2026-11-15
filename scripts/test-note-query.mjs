import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

// Use exactly the generated browser ABI, without changing the root package type.
const root = fileURLToPath(new URL("../", import.meta.url));
const generated = resolve(root, ".tmp/note-query/web");
const module = await import(`data:text/javascript;base64,${readFileSync(resolve(generated,"research_note_query_wasm.js")).toString("base64")}`);
module.initSync({module: readFileSync(resolve(generated, "research_note_query_wasm_bg.wasm"))});
assert.equal(module.note_collation_version(), "icu4x-2.3.1/zh-CN/kn-primary/v1");
assert.match(module.note_normalization_version(), /^rust-unicode-/u);
const strings = ["", "阿", "八", "笔记2", "笔记10", "张", "中", "😀", "é", "E", "a-b", "a_b", "a/b", "x\0y",
  ...Array.from({length: 200}, (_, index) => `研究${index}`)];
const compare = new Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"}).compare;
const keys = strings.map(text => Buffer.from(module.note_sort_key(text)));
let pairs = 0;
for (let left = 0; left < strings.length; left++) for (let right = left; right < strings.length; right++) {
  assert.equal(Math.sign(Buffer.compare(keys[left], keys[right])), Math.sign(compare(strings[left], strings[right])));
  assert.equal(Math.sign(Buffer.compare(module.note_reverse_key(keys[left]), module.note_reverse_key(keys[right]))), -Math.sign(Buffer.compare(keys[left], keys[right])) || 0);
  pairs++;
}
assert.deepEqual(module.note_query_terms("\uFEFF中 文 A*a İ ΟΣ\u0085 x\0y"), ["中", "文", "a*a", "i\u0307", "ος\u0085", "x\0y"]);
assert.equal(module.note_display_title("\n\uFEFF正文\n尾行", "摘录", "标题"), "正文");
assert.equal(module.note_display_title("a".repeat(99) + "😀", "", ""), "a".repeat(99));
assert.throws(() => module.note_query_terms("中".repeat(171)));
console.log(`note-query browser ABI: ${strings.length} strings, ${pairs} collation/reverse pairs; normalization/title/limits passed`);
