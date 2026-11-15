# Dependency patches

## CodeMirror autocomplete 6.20.3

`@codemirror__autocomplete@6.20.3.patch` adds an opt-in `virtualize` configuration
for the shared formula/writing completion presentation. The application enables
it through `components/text-editor/virtualCompletion.ts`.

The single-template transactional row cache and viewport rendering boundary are
adapted from VS Code commit `e1a22a1ad4034ef7d2af09c5e0777d619cbb500b`,
`src/vs/base/browser/ui/list/rowCache.ts` and `listView.ts` (MIT, Microsoft).
The patch includes the complete upstream MIT license as `VSCODE-LICENSE.txt`;
the application notice retains it for distributed builds.

Adaptations use native scrolling and CodeMirror's measurement scheduler rather
than VS Code's workbench services, scrollbars and event infrastructure. A stable
list reuses connected rows within a transaction; only viewport rows, two buffer
rows on either side and the ARIA active row remain mounted. All candidates stay
in the existing engine. Matching, ranking, provider cancellation, info resolution,
snippets and accepting a candidate remain upstream behavior. Lists with section
headers use upstream's original renderer because their row heights can vary.

Rendering uses cached scroll geometry; synchronous input/selection transactions
never read scroll layout after writing candidates. Redundant measurements do not
rewrite stable DOM, and unchanged icon/detail content roots survive filtering.
The application replaces CM's Unicode/emoji type icons with local Lucide SVG
paths through `icons: false` plus public `addToOptions`. A browser trace isolated
the remaining broad-prefix stall to native selection/layout with these font
glyphs; merely reducing rows or moving the same work into a frame was insufficient.
No delayed text input, browser-specific selection override or font is introduced.

Both ESM and CommonJS distributions are patched. The package is version-pinned
and the patch is registered in `pnpm-workspace.yaml`/`pnpm-lock.yaml`; upgrading
it requires reviewing/reapplying the patch and running the shared completion,
writing completion, formula completion and real-browser scroll/selection checks.
Do not edit installed `node_modules` files.
