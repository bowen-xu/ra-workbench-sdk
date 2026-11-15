# Note query projections

Pure Rust helpers shared by native SQLite projection functions and the browser
IndexedDB adapter through WebAssembly. They own no note identity, permissions,
document state or HBS transitions. Persisted keys and normalization are derived,
versioned data and must be rebuilt when the version changes.

Collation uses ICU4X 2.3.1, `zh-CN`, numeric ordering and primary strength. The
browser query path reads persisted binary keys; it does not generate keys for
all notes on each query. ICU4X code/data uses Unicode-3.0; the redistribution
notice is in `apps/web/public/notices/icu4x.txt`.

Build prerequisites: a Rust compiler with its matching `wasm32-unknown-unknown`
standard library and `wasm-bindgen-cli` exactly 0.2.105. For a rustup-managed
compiler, provision these explicitly using `rustup target add
wasm32-unknown-unknown` and `cargo install wasm-bindgen-cli --version 0.2.105
--locked`. The preparation script never installs a global toolchain. A Homebrew
compiler cannot use the official rustup standard library even at the same release.
Use `NOTE_QUERY_RUSTC=/absolute/path/to/rustc` and
`NOTE_QUERY_WASM_BINDGEN=/absolute/path/to/wasm-bindgen` for an isolated toolchain.

Run `node scripts/prepare-note-query.mjs` from the repository. Generated JS,
declarations and Wasm are ignored under `apps/web/src/.generated/note-query`;
the builder fingerprints source, lockfile and tool versions. The browser loader
passes the bundled Wasm URL explicitly so Vite content hashing does not break
the generated JS's default relative filename. The override applies only to the
Wasm build; native tests and rustdoc continue to use their normal matching
toolchain. Browser build/dev scripts prepare these assets automatically. A
verified artifact with matching source and compiler commit is reused without
looking up the binding CLI or rebuilding; artifact bytes are checked against
the stored SHA-256 receipt. A fresh checkout or changed input still needs the
explicit matching toolchain described above. `pnpm check:note-query` exercises
the shared kernel and generated browser ABI.

Validation: `cargo test --locked --manifest-path packages/note-query/Cargo.toml`;
native/browser key parity must also be checked before changing ICU, compiler
Unicode data, options or the generated binding version. A derived search index
is never an authorization source or a replacement for canonical revision checks.
