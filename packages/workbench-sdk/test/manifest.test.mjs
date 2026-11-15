import assert from "node:assert/strict";
import {test} from "node:test";
import {assertPluginCompatibility, decodePluginManifest, hasPluginFrontend, WORKBENCH_UI_RUNTIME, WORKBENCH_NATIVE_PROTOCOL_VERSION} from "../lib/index.js";
import {resolveBuiltinPlugins} from "../lib/composition.js";

function manifest(overrides = {}) {
  return {
    formatVersion: 1, id: "note_manager", version: "1.0.0", apiVersion: 1,
    entry: "assets/note-manager.js", styles: ["assets/note-manager.css"], uiRuntime: WORKBENCH_UI_RUNTIME,
    dependencies: {required: [], optional: []}, provides: [], consumes: {required: [], optional: []},
    ...overrides,
  };
}

test("decoded compatible package resolves with the existing dependency policy", () => {
  const raw = manifest();
  const decoded = decodePluginManifest(raw);
  assertPluginCompatibility(decoded);
  const resolved = resolveBuiltinPlugins([decoded], [decoded.id], []);
  assert.deepEqual(resolved.activationOrder, [decoded]);
  raw.styles.push("later.css");
  assert.deepEqual(decoded.styles, ["assets/note-manager.css"]);
});

test("API/runtime mismatch retains identity and expected/actual versions before import", () => {
  for (const [changes, expected] of [
    [{apiVersion: 2}, {code: "plugin_api_incompatible", expectedVersion: 1, actualVersion: 2}],
    [{uiRuntime: "react@other"}, {code: "plugin_ui_runtime_incompatible", expectedVersion: WORKBENCH_UI_RUNTIME, actualVersion: "react@other"}],
  ]) {
    assert.throws(() => assertPluginCompatibility(decodePluginManifest(manifest(changes))), error => {
      assert.deepEqual(error.diagnostic, {pluginId: "note_manager", ...expected}); return true;
    });
  }
});

test("untrusted nested manifests fail with a precise field instead of a runtime TypeError", () => {
  for (const [input, field] of [
    [null, "manifest"], [manifest({dependencies: null}), "dependencies"],
    [manifest({styles: "style.css"}), "styles"],
    [manifest({consumes: {required: [null], optional: []}}), "consumes.required[0]"],
    [manifest({provides: [{id: "catalog", version: "1"}]}), "provides[0].version"],
    [manifest({id: "core"}), "id"], [manifest({formatVersion: 3}), "formatVersion"],
  ]) assert.throws(() => decodePluginManifest(input), error => {
    assert.equal(error.code, "plugin_manifest_invalid"); assert.equal(error.diagnostic.field, field); return true;
  });
});

test("entry and stylesheet paths cannot carry URLs, traversal or encoded separators", () => {
  for (const path of ["/entry.js", "../entry.js", "assets/../entry.js", "./entry.js", "assets//entry.js",
    "https://host/entry.js", "C:\\entry.js", "assets/%2e%2e/entry.js", "entry.js?x", "entry.js#x", "entry\0.js"]) {
    for (const changes of [{entry: path}, {styles: [path]}]) {
      assert.throws(() => decodePluginManifest(manifest(changes)), {code: "plugin_manifest_invalid"});
    }
  }
});

test("decoded package dependencies retain the original absence, duplicate and cycle diagnostics", () => {
  const required = {required: [{id: "provider", apiVersion: 1}], optional: []};
  const consumer = decodePluginManifest(manifest({dependencies: required}));
  assert.throws(() => resolveBuiltinPlugins([consumer], [consumer.id], []), {code: "plugin_dependency_missing"});
  assert.throws(() => resolveBuiltinPlugins([consumer, consumer], [consumer.id], []), {code: "plugin_duplicate_id"});
  const provider = decodePluginManifest(manifest({id: "provider", dependencies: {
    required: [{id: consumer.id, apiVersion: 1}], optional: [],
  }}));
  assert.throws(() => resolveBuiltinPlugins([consumer, provider], [consumer.id], []), {code: "plugin_dependency_cycle"});
});

function nativeManifest(overrides = {}) {
  const {entry: _entry, styles: _styles, uiRuntime: _uiRuntime, ...metadata} = manifest();
  return {...metadata, formatVersion: 2, id: "writing_projects",
    native: {protocolVersion: 1, os: "macos", arch: "aarch64", entry: "native/writing-host"}, ...overrides};
}

test("version 1 retains its decoded shape without interpreting unknown native metadata", () => {
  const decoded = decodePluginManifest(manifest({native: {args: ["ignored legacy metadata"]}}));
  assert.equal(decoded.formatVersion, 1);
  assert.equal("native" in decoded, false);
  assert.equal(hasPluginFrontend(decoded), true);
  assertPluginCompatibility(decoded);
});

test("native-only version 2 owns its declaration without requiring a UI runtime", () => {
  const raw = nativeManifest();
  const decoded = decodePluginManifest(raw);
  assert.equal(hasPluginFrontend(decoded), false);
  assert.equal("entry" in decoded, false);
  assert.equal("styles" in decoded, false);
  assert.equal("uiRuntime" in decoded, false);
  assert.deepEqual(decoded.native, raw.native);
  raw.native.entry = "changed-after-decoding";
  assert.equal(decoded.native.entry, "native/writing-host");
  assertPluginCompatibility(decoded);
});

test("version 2 accepts a frontend alone or together with the same package's backend", () => {
  for (const raw of [manifest({formatVersion: 2}), {...nativeManifest(),
    entry: "entry.js", styles: [], uiRuntime: WORKBENCH_UI_RUNTIME}]) {
    const decoded = decodePluginManifest(raw);
    assert.equal(hasPluginFrontend(decoded), true);
    assertPluginCompatibility(decoded);
  }
});

test("version 2 rejects missing entry kinds and every partial frontend declaration", () => {
  const {native: _native, ...noEntries} = nativeManifest();
  assert.throws(() => decodePluginManifest(noEntries), {code: "plugin_manifest_invalid"});
  const fields = {entry: "entry.js", styles: [], uiRuntime: WORKBENCH_UI_RUNTIME};
  for (let selection = 1; selection < 7; selection++) {
    const partial = Object.fromEntries(Object.entries(fields).filter((_field, index) => selection & (1 << index)));
    assert.throws(() => decodePluginManifest({...nativeManifest(), ...partial}), {code: "plugin_manifest_invalid"});
  }
});

test("native declarations reject unsupported shapes and every unknown execution field", () => {
  const base = nativeManifest().native;
  for (const [native, field] of [
    [null, "native"], [[], "native"], [{...base, protocolVersion: 0}, "native.protocolVersion"],
    [{...base, protocolVersion: 1.1}, "native.protocolVersion"], [{...base, protocolVersion: "1"}, "native.protocolVersion"],
    [{...base, os: "darwin"}, "native.os"], [{...base, arch: "arm64"}, "native.arch"],
    ...["args", "env", "cwd", "methods", "unexpected"].map(field => [{...base, [field]: []}, `native.${field}`]),
  ]) assert.throws(() => decodePluginManifest(nativeManifest({native})), error => {
    assert.equal(error.code, "plugin_manifest_invalid"); assert.equal(error.diagnostic.field, field); return true;
  });
});

test("native entry uses the same canonical relative path policy", () => {
  for (const entry of ["/host", "../host", "native/../host", "./host", "native//host", "https://host",
    "C:\\host", "native/%2e%2e/host", "host?x", "host#x", "host\0"]) {
    assert.throws(() => decodePluginManifest(nativeManifest({native: {...nativeManifest().native, entry}})), error => {
      assert.equal(error.code, "plugin_manifest_invalid"); assert.equal(error.diagnostic.field, "native.entry"); return true;
    });
  }
});

test("native protocol compatibility is distinct from UI compatibility and host platform support", () => {
  const decoded = decodePluginManifest(nativeManifest({native: {...nativeManifest().native, protocolVersion: 3}}));
  assert.throws(() => assertPluginCompatibility(decoded), error => {
    assert.deepEqual(error.diagnostic, {pluginId: "writing_projects", code: "plugin_native_protocol_incompatible",
      expectedVersion: "1|2", actualVersion: 3}); return true;
  });
  for (const os of ["macos", "linux", "windows"]) for (const arch of ["aarch64", "x86_64"])
    assertPluginCompatibility(decodePluginManifest(nativeManifest({native: {...nativeManifest().native, os, arch}})));
  assert.throws(() => assertPluginCompatibility(decodePluginManifest({...nativeManifest(),
    entry: "entry.js", styles: [], uiRuntime: "react@other"})), {code: "plugin_ui_runtime_incompatible"});
});

test("known domain v2 metadata compatibility preserves the legacy constant and rejects other native profiles", () => {
  assert.equal(WORKBENCH_NATIVE_PROTOCOL_VERSION, 1, "the original public v1 constant remains unchanged");
  for (const id of ["literature_library", "writing_projects"]) for (const protocolVersion of [1, 2]) {
    const provides = id === "literature_library" ? ["literature.note-trace-decision"]
      : protocolVersion === 1 ? ["writing.import-preview"] : ["writing.project-files", "writing.import-preview"];
    const decoded = decodePluginManifest(nativeManifest({id,
      provides: provides.map(id => ({id, version: 1})),
      native: {...nativeManifest().native, protocolVersion}}));
    assertPluginCompatibility(decoded);
    assert.deepEqual(resolveBuiltinPlugins([decoded], [decoded.id], []).activationOrder, [decoded]);
  }
  for (const [id, protocolVersion, expectedVersion] of [
    ["literature_library", 3, "1|2"], ["writing_projects", 3, "1|2"], ["other_native", 2, 1],
  ]) assert.throws(() => assertPluginCompatibility(decodePluginManifest(nativeManifest({id,
    native: {...nativeManifest().native, protocolVersion}}))), error => {
    assert.deepEqual(error.diagnostic, {pluginId: id, code: "plugin_native_protocol_incompatible", expectedVersion,
      actualVersion: protocolVersion});
    return true;
  });
});

test("duplicate-review metadata decodes in native-only and combined packages without importing code", () => {
  const provides = ["literature.note-trace-decision", "literature.catalog-read", "literature.catalog-save",
    "literature.nal-query-collections", "literature.nal-bootstrap", "literature.nal-annotation",
    "literature.nal-mutation", "literature.duplicate-review"].map(id => ({id, version: 1}));
  for (const frontend of [false, true]) {
    const raw = nativeManifest({id: "literature_library",
      native: {...nativeManifest().native, protocolVersion: 2},
      provides: frontend ? [{id: "literature.catalog", version: 1},
        {id: "literature.citations", version: 1}, ...provides] : provides,
      ...(frontend ? {entry: "index.js", styles: [], uiRuntime: WORKBENCH_UI_RUNTIME} : {})});
    const decoded = decodePluginManifest(raw);
    assertPluginCompatibility(decoded);
    assert.equal(hasPluginFrontend(decoded), frontend);
    assert.equal(decoded.provides.length, frontend ? 10 : 8);
    assert.deepEqual(decoded.provides.at(-1), {id: "literature.duplicate-review", version: 1});
    assert.deepEqual(resolveBuiltinPlugins([decoded], [decoded.id], []).activationOrder, [decoded]);
  }
});
