# Editor input and responsive UI implementation plan

**Goal:** Improve the existing README editor across large, medium and phone layouts, with touch handled independently of viewport width.

**Design:** The approved conversation review: preserve in-place typography and BlockNote core; make insertion and block actions reachable without hover, provide touch formatting with and without a software keyboard, keep menus inside visible space, protect unsaved work and use the existing Iconoir pipeline. Banner/card schemas remain future work.

**Architecture:** Keep the existing headless integration and strict Trusted Types/CSP. No React BlockNote UI, storage, server save API or schema change. Work on the staging preview (5b0f406), which contains the requested editor; main does not yet contain it. Existing registered icons are reused; typography labels remain text when no approved icon exists. Declare the already shipped `prosemirror-history` 1.5.1 as a direct dependency to isolate reorder undo history (ADR 0038). Resolve the public UI entry to its existing pure presentation entry in browser builds (ADR 0039).

**Tech stack:** React 19.3.1, BlockNote core 0.56.0, TypeScript, CSS Modules, Vitest.

## Tasks

- [x] Add tested viewport placement and input-state handling in `apps/web/src/editor/`: menus flip, clamp and remeasure; touch uses selected-block actions and a visible formatting bar independently of width. Tests cover large touch, narrow mouse, keyboard viewport changes and focus in controls.
- [x] Improve `menus.tsx` and editor CSS: reuse Iconoir add/more/done/up/down/delete, touch-safe menu activation, explicit move actions, keyboard menu navigation, slash ARIA linkage, container-based columns and no negative narrow gutter. Preserve selection during formatting and avoid accidental activation while scrolling.
- [x] Improve form lifecycle and profile CSS: focus on edit, sticky Save/Cancel, dirty-only discard protection and unload warning; preserve native POST. Match reading and editing column thresholds at 640px (two) and 840px (three).
- [x] Apply the user's touch revision: remove desktop add/drag handles in touch mode and in phone layouts below 768px, including mouse previews; hold and drag a block's edge/background to reorder siblings; double tap there to open a native action sheet with Add, Move and Delete. Keep text selection and ordinary swipe scrolling intact, and expose the sheet through a labeled button as well.
- [x] Run focused tests, typecheck, lint, guards and build/budgets; compare baseline failures. Inspect real rendered editor at large, medium and phone widths. Request independent review and fix material findings.

## Review focus

- Wide touch/hybrid input must not depend on a phone-width breakpoint.
- Hardware-keyboard touch devices still need block actions; keyboard dismissal must not hide controls prematurely.
- Popovers must remain visible near every edge and inside scrolling containers, including the software keyboard viewport.
- Dirty state must clear when changes are undone and must not block the intended Save submission.
- Reordering must preserve nested blocks and produce one undoable operation.
- Finger movement before the hold threshold must scroll normally. Implicit pointer-capture transfer must not cancel an armed drag, and gesture click suppression must not swallow the action sheet's buttons.

## Sources

- BlockNote v0.56.0 `FormattingToolbarController`, `MobileFormattingToolbarController`, `useVirtualKeyboard`, desktop controller and suggestion middleware in https://github.com/TypeCellOS/BlockNote/tree/v0.56.0/packages/react/src/components .
- Existing architecture: `docs/ai/notes/area/web.md`, editor source, registered `shared/ui/icons`.
- ProseMirror history 1.5.1 `closeHistory`: installed `node_modules/prosemirror-history/src/history.ts`; see ADR 0038.
- Vite 8.3.4 client and SSR export conditions: installed `node_modules/vite/dist/node/chunks/node.js`; see ADR 0039.

## Verification log

Verified on 2026-10-26 with official Node 26.12.0 in an isolated worktree on `codex/editor-input-ui`.

- Focused editor/profile/README unit tests: **58 passed across 7 files**, including mouse input and resize at the phone breakpoint.
- Chromium browser tests: **18 passed**, covering 1440, 900 and 390px with mouse and touch, phone-to-desktop resize and back, hold-to-drag with finger drift, double-tap sheet, gesture cancellation, undo boundaries, keyboard navigation, discard and native POST.
- Production client and SSR builds: passed. Full lint and dependency boundaries: passed. All **313 guards**: passed. Scoped strict source typecheck for the web app and shared UI: passed.
- Lazy-island and JavaScript budgets: passed. Islands total 79,773 gzip bytes (81,920 cap); editor 193,277 gzip bytes (262,144 cap).
- Visual inspection: wide and medium touch layouts, phone editor and phone action sheet; no horizontal overflow or clipped controls. Physical iOS/Android selection and software-keyboard behavior remain unverified.
- Independent review found focus transition, tap target movement, undo grouping, pointer-capture and gesture activation issues; fixes are covered by unit and browser checks.
- `git diff --check`: passed. Existing identity/sidebar and persisted README schema are unchanged.

Three full-repository checks fail on the unchanged 5b0f406 baseline as well:

- Project-reference typecheck has a macOS case collision between `Markdown.tsx` and `markdown.ts`, producing declaration errors. The scoped source typecheck passes.
- Global CSS exceeds its existing 53,248-byte unminified cap: baseline 92,745 bytes, current 98,123. Current gzip CSS is 11,269 bytes and remains below its 12,288-byte cap; editor CSS passes its separate budget. No budget was relaxed.
- `styles_entry_emits_css_only` expects hashed names for five existing `:global` ProseMirror selectors. The exact same assertion fails on the baseline. The combined guard/style/island run has 326 passing tests and this one failure.

Local preview: `http://127.0.0.1:8081/fixture/editor`. No merge or deployment was performed.
