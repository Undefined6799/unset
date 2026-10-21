# Build-only PDS presentation checks

ADR 0027 and P2.24g keep `apps/pds` presentation-only. The MATRIX defines its
own source/assets, exact public UI files and required CSS, React and JSX runtime.
`PDS_UI_PUBLIC_ENTRIES` is also the reference check's candidate list. Only PDS
gains the public-entry DC-2 exception; other consumers and shared packages keep
their existing index boundary. The UI root barrel and private components fail.
Every dependency/optional/peer/dev field is checked, including unused entries.
Runtime declarations are shared-ui `*` and React `19.3.0`; dev-only compiler,
Vitest and React types are named and pinned. No actual workspace is created here.

The ownership guard parses shipped sources using installed SWC 1.16.18
(`node_modules/@swc/core/index.d.ts`, `index.js:198–205`). Parse errors fail.
It rejects identifiers for fetch, XHR, WebSocket, EventSource and browser stores;
static member access through window/self/globalThis; document.cookie reads or
writes; navigator beacon/credentials/service-worker access; named local session,
authentication and handle-resolution owners and router constructors. It rejects
server/start/bin/api/route/auth/session/storage/SDK file roles and package
bin/main/start/serve/server/dev roles. Tests are excluded from shipped scanning.
Translated account labels, SafeHref, avatar display props, controlled visual
state, children, native callbacks and control slots remain valid.

This names known patterns, not all possible semantics. Computed dynamic property
names, obfuscated/aliased browser objects and differently named local auth logic
still require review. Native source integration and isolated native tests must
prove unchanged upstream ownership; this guard is not native auth coverage.

The independent `apps/pds` 1500 nonblank TS/TSX line bucket is an initial estimate
and warning only. Existing budgets stay intact. CSS remains a hard 53248 bytes
unminified / 12288 bytes min-gzip per bundle/page. A later paired PDS build must
supply its actual outputs before PDS CSS coverage is claimed. No island allowance
is assigned to PDS. Existing inventory scan roots already cover apps and tests.

Native image/entrypoint smoke files belong at
`tests/integration/pds-ui/*.image.test.ts`: normal CI runs images serially after
units without the ordinary integration project's Postgres lifecycle. Conditional
skips stay forbidden. Browser specs belong under `tests/e2e/pds/`; Playwright
1.64.0's existing `*.spec.ts` match is recursive (`lib/util.js:97–110`). The normal
CI execution assertion discovers recursively, compares full relative paths from
the expected test/config root, and rejects a conflicting report root. Absolute
report paths are normalized against that root, never by an arbitrary suffix.
The skip allowance remains empty. No extra opt-in suite is needed.
