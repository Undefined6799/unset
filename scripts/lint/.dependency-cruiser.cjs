// Module boundaries (decision 34; Architecture and Development Guideline §1–§2; plan §7; rule AB-1).
// `allowed` (built from MATRIX) is the definition: an edge no row lists fails as `not-in-allowed`.
// The `forbidden` rules restate the boundaries so a failure names the one it breaks.
// A new edge is a new MATRIX row plus its fixture in scripts/lint/depcruise.test.ts, in the same PR.

/** Folders pds-admin and chat-admin may import (guideline §1). Adding one needs Alex's approval in the PR. */
const ZERO_DEP_ALLOWLIST = ["shared/admin-envelope/"];

/** Server-side render entries an interface may import from its app (guideline §1). P1.20 fixes the paths. */
const RENDER_ENTRIES = { http: "apps/web/render.tsx", admin: "apps/admin/render.tsx" };

/** Each vendor SDK is imported in exactly one adapter folder per runtime (guideline §1, O-7). */
const SDK_ADAPTERS = [
  { sdk: "pg", adapter: "infrastructure/postgres/" },
  { sdk: "undici", adapter: "infrastructure/net-guard/" },
  { sdk: "@atproto/oauth-client-node", adapter: "infrastructure/pds/" },
  { sdk: "@atproto/api", adapter: "infrastructure/pds/" },
  { sdk: "@aws-sdk/client-s3", adapter: "infrastructure/storage/" },
  { sdk: "age-encryption", adapter: "infrastructure/seal/" },
  { sdk: "@atproto/lex[^/]*", adapter: "shared/lexicons/" },
  { sdk: "matrix-js-sdk", adapter: "apps/chat/matrix/" },
];

/** Node built-ins a domain may not import: I/O arrives as a passed-in dependency (README rule 1). */
const IO_BUILTINS = "fs|net|http|https|http2|dgram|dns|tls|child_process|worker_threads";

const escapeRegex = (path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (paths) => `^(${paths.map(escapeRegex).join("|")})`;
const oneOfFiles = (paths) => `${anyOf(paths)}$`;
const npmPackage = (name) => `^(node_modules/)?${name}(/|$)`;

/**
 * The unresolvable edge allowed (P1.23w; architecture Amendment 2026-10-06 21:45Z; Alex 21:49Z): apps/web's server
 * build is the package export `@unset/apps-web/server`. dependency-cruiser does not follow that exports subpath into
 * the excluded dist/, so it reports the edge as unresolved. The render loader is the product importer. P1.26's
 * harness loads the same build for `Island`, which has to be that module so it shares IslandRunContext with the
 * production render. Only these files, only this specifier.
 */
const RENDER_BUILD_MODULE = "@unset/apps-web/server";
const RENDER_BUILD_IMPORT = { from: "interfaces/http/web/render-entry.ts", module: RENDER_BUILD_MODULE };
const E2E_SERVER_BUILD = { from: "tests/e2e/fixtures/servers.ts", module: RENDER_BUILD_MODULE };
const UNRESOLVED_BUILD_IMPORTERS = [RENDER_BUILD_IMPORT.from, E2E_SERVER_BUILD.from];

const NPM = { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled"] };
const CORE = { dependencyTypes: ["core"] };
// An app's Vite build config (P1.23v; architecture record 2026-10-06-p116-retention-usage-and-p124-icon-source.md,
// amendments 20:20Z and 20:55Z): it runs in Node at build time only, so it may import node:crypto and
// scripts/ui/css-scope.ts, and nothing imports it. Three rules implement that one allowance: app-only-shared exempts
// the config, app-build-config-imports narrows what it may reach, and app-build-config-not-imported keeps it a leaf. Exactly apps/<app>/vite.config.ts; a file of that name deeper in an app is product code.
const APP_BUILD_CONFIG = "^apps/[^/]+/vite\\.config\\.ts$";
// Root files count as tooling only when they are config files (vitest.config.ts); so does an app's build config.
const TOOLING = `^(scripts|tests)/|^[^/]+\\.config\\.[cm]?[jt]s$|\\.test\\.(ts|tsx|mts|cts)$|${APP_BUILD_CONFIG}`;
// The files that never ship (P1.28p): defined once in tooling.ts, which specifiers.ts reads too. Node 26 loads a
// TypeScript ES module through require() (doc/api/modules.md "Loading ECMAScript modules using require()";
// doc/api/typescript.md "Type stripping").
const { TOOLING_PATTERN } = require("./tooling.ts");
const FAKE = "\\.fake\\.[cm]?tsx?$";
const ADMIN_SERVICES = "^interfaces/(pds-admin|chat-admin)/";
const LEAF_SHARED = "^shared/(ui|ui-build|islands|lexicons|admin-envelope|host-pin)/";
// The lexicon build scripts and the Node built-ins they may import, each named exactly (P1.31d). Adding one loosens a
// guard: a check-path PR with an architecture ruling and Alex's typed word.
const LEXICON_SCRIPTS = "^shared/lexicons/scripts/";
const LEXICON_SCRIPT_BUILTINS = ["fs", "path", "os", "url", "child_process"];
// A module under infrastructure/ or shared/ and the one file others may import from it (rule DC-2).
const WORKSPACE_WITH_INDEX = "(?:infrastructure|shared)/[^/]+/";
const INDEX_FILE = `^${WORKSPACE_WITH_INDEX}index\\.ts$`;
// A browser island (P1.23): one component per *.island.tsx under apps/web/src/islands/ or shared/ui/islands/. It may
// import the kit and the island runtime, shared/islands (P1.25o, for P1.25i's move).
const ISLAND = "\\.island\\.tsx$";
// The npm modules an island may import, each named exactly (architecture ruling 2026-10-06, P1.23q): today only
// React's JSX runtime (ADR 0015). Adding an entry loosens a guard: a check-path PR naming the module and why the
// island needs it, with an architecture ruling and Alex's typed word. A vendor SDK never goes here; it gets its own
// adapter folder (SDK_ADAPTERS).
const ISLAND_NPM_MODULES = ["react/jsx-runtime"];
// A bare specifier resolved to exactly that module (a file, or a folder's index), never another subpath.
const npmModule = (spec) => `^(node_modules/)?${escapeRegex(spec)}(\\.js|/index\\.js)?$`;
// Non-TypeScript assets (a CSS Module) are imported directly; they export no code.
const ASSET = "\\.css$";

/** The allowlist matrix. Each row: a name, the importing folder, and what it may reach. */
// P2.24g / ADR 0027: the only public code entries for the build-only PDS consumer.
const PDS_UI_PUBLIC_ENTRIES = ["shared/ui/presentation.ts", "shared/ui/components/Header/BrandHeader.tsx"];
const PDS_CSS = [
  "shared/ui/src/base.css",
  "shared/ui/src/tokens.css",
  "shared/ui/src/layers.css",
  ...["Navigation", "Button", "Input", "Avatar", "Header"].map(
    (name) => `shared/ui/components/${name}/${name}.module.css`,
  ),
];
const PDS_SOURCE = "^apps/pds/(src/.*\\.(ts|tsx|css)|(?:index|presentation)\\.tsx?)$";
const PDS_PRODUCTION = "^apps/pds/(?!.*\\.test\\.(ts|tsx|mts|cts)$)";
const PDS_TARGETS = [
  PDS_SOURCE,
  oneOfFiles(PDS_UI_PUBLIC_ENTRIES),
  oneOfFiles(PDS_CSS),
  npmModule("react"),
  npmModule("react/jsx-runtime"),
];
const MATRIX = [
  { name: "pds-presentation", from: { path: "^apps/pds/" }, to: PDS_TARGETS.map((path) => ({ path })) },
  {
    name: "app",
    from: { path: "^apps/([^/]+)/", pathNot: "^apps/pds/" },
    to: [{ path: "^apps/$1/" }, { path: "^shared/" }, NPM],
  },
  {
    name: "interface",
    from: { path: "^interfaces/([^/]+)/", pathNot: ADMIN_SERVICES },
    to: [{ path: "^interfaces/$1/" }, { path: "^(domains|infrastructure|shared)/" }, CORE, NPM],
  },
  {
    name: "interface-http-render",
    from: { path: "^interfaces/http/" },
    to: [{ path: oneOfFiles([RENDER_ENTRIES.http]) }],
  },
  {
    name: "interface-http-render-build",
    from: { path: oneOfFiles([RENDER_BUILD_IMPORT.from]) },
    to: [{ path: oneOfFiles([RENDER_BUILD_IMPORT.module]), couldNotResolve: true }],
  },
  {
    name: "interface-admin-render",
    from: { path: "^interfaces/admin/" },
    to: [{ path: oneOfFiles([RENDER_ENTRIES.admin]) }],
  },
  {
    name: "admin-service",
    from: { path: "^(interfaces/(pds-admin|chat-admin)/)" },
    to: [{ path: "^$1" }, { path: anyOf(ZERO_DEP_ALLOWLIST) }, CORE],
  },
  {
    name: "domain",
    from: { path: "^domains/([^/]+)/" },
    to: [
      { path: "^domains/$1/" },
      { path: "^domains/[^/]+/index\\.ts$" },
      { path: "^shared/(errors|lexicons)/" },
      { path: "^shared/config/", dependencyTypes: ["type-only"] },
      CORE,
    ],
  },
  {
    name: "infrastructure",
    from: { path: "^infrastructure/([^/]+)/", pathNot: "^infrastructure/net-guard/" },
    to: [{ path: "^infrastructure/($1|net-guard|seal)/" }, { path: "^(domains|shared)/" }, CORE, NPM],
  },
  {
    name: "net-guard",
    from: { path: "^infrastructure/net-guard/" },
    to: [{ path: "^infrastructure/net-guard/" }, { path: npmPackage("undici") }, CORE],
  },
  { name: "shared", from: { path: "^shared/", pathNot: LEAF_SHARED }, to: [{ path: "^shared/" }, CORE, NPM] },
  // The lexicon build scripts (P1.31d; architecture record 2026-10-12-p131-depcruise-and-lexicon-choices item 2): they
  // generate code that ships in the trusted lexicons package, so they stay inside it. They read and write files and run
  // the pinned lex and biome binaries by execFile (P1.31 as-built item 11), so they reach exactly
  // LEXICON_SCRIPT_BUILTINS and no other built-in; nothing outside them imports one (lexicon-scripts-not-imported).
  {
    name: "shared-lexicons-scripts",
    from: { path: LEXICON_SCRIPTS },
    to: [{ path: "^shared/lexicons/" }, { ...CORE, path: `^(${LEXICON_SCRIPT_BUILTINS.join("|")})$` }, NPM],
  },
  { name: "shared-ui-lexicons", from: { path: "^(shared/(ui|lexicons)/)" }, to: [{ path: "^$1" }, NPM] },
  // The island runtime (define, props, readProps, slot), its own workspace from P1.25i (P1.25o; book edit
  // 2026-10-07-p125l-islands-lazy-chunks): it ships to the browser, so no Node built-in, and it never imports the
  // kit, which reaches it only through its index.
  { name: "shared-ui-islands", from: { path: "^shared/ui/" }, to: [{ path: "^shared/islands/index\\.ts$" }] },
  { name: "shared-islands", from: { path: "^shared/islands/" }, to: [{ path: "^shared/islands/" }, NPM] },
  // The UI build runners (P1.25h moved them; P1.25w, architecture ruling 2026-10-07-p125h-follow-ups N2): pure by
  // design, IO injected by scripts/ui, so no Node built-in, and shared/ui only as types through its index.
  {
    name: "shared-ui-build",
    from: { path: "^shared/ui-build/" },
    to: [{ path: "^shared/ui-build/" }, { path: "^shared/ui/index\\.ts$", dependencyTypes: ["type-only"] }, NPM],
  },
  { name: "shared-admin-envelope", from: { path: "^(shared/admin-envelope/)" }, to: [{ path: "^$1" }, CORE] },
  // shared/host-pin (P1.33o): a leaf, the same shape as shared-admin-envelope. Only its own files and Node
  // built-ins. No npm package and no other shared module. A *.test.ts stays on the tooling row, so its vitest
  // import is not this row. dependency-cruiser 18.5.0 substitutes $1 from the from path (doc/rules-reference.md,
  // group matching) and matches `path` as a regular expression.
  { name: "shared-host-pin", from: { path: "^(shared/host-pin/)" }, to: [{ path: "^$1" }, CORE] },
  // The deploy preflight (P1.30; architecture record 2026-10-07-p130-preflight-location-and-yaml): product code under
  // deployment/, a leaf that reaches only itself, Node built-ins and the yaml parser. It runs verify-images as a
  // child process, never by import, so no edge to scripts/. Outside itself it may import two files: the edge reader
  // deployment/edge/caddyfile.ts, so C18 reads the Caddyfile with the parser the edge tests use and no second one
  // (P1.30r, for P1.30u; architecture record 2026-10-07-p130s-networks-and-caddyfile-reader item 2; Alex's
  // "Allow import", 2026-10-12T02:16:16Z), and shared/host-pin/index.ts only (P1.33i, DC-2; Alex's typed line
  // "yes P1.33i scripts/lint depcruise deployment-preflight row shared/host-pin", 2026-10-14). dependency-cruiser
  // 18.5.0 matches `to.path` as a regular expression against the resolved path (doc/rules-reference.md, `path`).
  // The edge may still never import the preflight (edge-not-preflight).
  {
    name: "deployment-preflight",
    from: { path: "^deployment/preflight/" },
    to: [
      { path: "^deployment/preflight/" },
      { path: "^deployment/edge/caddyfile\\.ts$" },
      { path: "^shared/host-pin/index\\.ts$" },
      { path: npmPackage("yaml") },
      CORE,
    ],
  },
  { name: "tooling", from: { path: TOOLING, pathNot: PDS_PRODUCTION }, to: [{}] },
];

const forbidden = (name, comment, from, to, severity = "error") => ({ name, comment, severity, from, to });

module.exports = {
  allowedSeverity: "error",
  allowed: MATRIX.flatMap((row) => row.to.map((to) => ({ comment: `MATRIX row ${row.name}`, from: row.from, to }))),
  forbidden: [
    forbidden(
      "no-app-to-app",
      "An app imports nothing from another app (guideline §2).",
      { path: "^apps/([^/]+)/" },
      { path: "^apps/", pathNot: "^apps/$1/" },
    ),
    forbidden(
      "app-only-shared",
      "Among repository folders an app imports only its own folder and shared/ (guideline §1).",
      { path: "^apps/", pathNot: APP_BUILD_CONFIG },
      { path: "^(?!apps/|shared/|node_modules/)[^/]+/" },
    ),
    forbidden(
      "app-render-entry-only",
      "From outside apps/, only interfaces/http and interfaces/admin import an app, and only its render entry (guideline §1).",
      { pathNot: `^apps/|^interfaces/(http|admin)/|${TOOLING}` },
      { path: "^apps/" },
    ),
    forbidden(
      "app-render-entry-only",
      "interfaces/http imports only the web render entry (guideline §1).",
      { path: "^interfaces/http/" },
      { path: "^apps/", pathNot: oneOfFiles([RENDER_ENTRIES.http]) },
    ),
    forbidden(
      "app-render-entry-only",
      "interfaces/admin imports only the admin render entry (guideline §1).",
      { path: "^interfaces/admin/" },
      { path: "^apps/", pathNot: oneOfFiles([RENDER_ENTRIES.admin]) },
    ),
    forbidden(
      "no-interface-to-interface",
      "Each interface is its own process; shared code goes to shared/ or a domain (guideline §1, O-2).",
      { path: "^interfaces/([^/]+)/" },
      { path: "^interfaces/", pathNot: "^interfaces/$1/" },
    ),
    forbidden(
      "domain-pure",
      "Domains do not depend on infrastructure, interfaces or apps (guideline §2).",
      { path: "^domains/" },
      { path: "^(infrastructure|interfaces|apps)/" },
    ),
    forbidden(
      "domain-cross-via-index",
      "A domain reaches another domain only through its index.ts (README readable-code rule 3).",
      { path: "^domains/([^/]+)/" },
      { path: "^domains/", pathNot: ["^domains/$1/", "^domains/[^/]+/index\\.ts$"] },
    ),
    forbidden(
      "infra-shared-via-index",
      "From outside, a module under infrastructure/ or shared/ is reached only through its index.ts, tests included (rule DC-2). A *.fake.ts is exempt (fake-only-in-composition-root governs it, and an index.ts never exports one), and so is CSS.",
      { pathNot: `^${WORKSPACE_WITH_INDEX}|^apps/pds/` },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: [INDEX_FILE, FAKE, ASSET] },
    ),
    forbidden(
      "infra-shared-via-index",
      "PDS reaches only its two reviewed public UI entries (ADR 0027 / DC-2); CSS is checked by its MATRIX row.",
      { path: "^apps/pds/" },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: [INDEX_FILE, ASSET, oneOfFiles(PDS_UI_PUBLIC_ENTRIES)] },
    ),
    forbidden(
      "infra-shared-via-index",
      "Another infrastructure/ or shared/ module is reached only through its index.ts (rule DC-2).",
      { path: `^(${WORKSPACE_WITH_INDEX})` },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: ["^$1", INDEX_FILE, FAKE, ASSET] },
    ),
    forbidden(
      "domain-no-io-builtins",
      "Domains are the functional core: I/O arrives as a passed-in dependency (README rule 1).",
      { path: "^domains/" },
      { ...CORE, path: `^(node:)?(${IO_BUILTINS})(/|$)` },
    ),
    forbidden(
      "no-product-imports-tooling",
      "scripts/ and tests/ are tooling; product code never imports them (invariant 13).",
      { pathNot: TOOLING },
      { path: "^(scripts|tests)/" },
    ),
    forbidden(
      "no-product-imports-tooling-set",
      "Tests, check scripts, fixtures and vectors never ship; no file outside that set imports one inside it (P1.28p).",
      { pathNot: TOOLING_PATTERN },
      { path: TOOLING_PATTERN },
    ),
    forbidden(
      "infrastructure-not-entry",
      "Infrastructure implements domain contracts and never reaches an entry point (guideline §2).",
      { path: "^infrastructure/" },
      { path: "^(interfaces|apps)/" },
    ),
    forbidden(
      "shared-leaf",
      "shared/ has no product meaning and imports no product folder (guideline §1).",
      { path: "^shared/" },
      { path: "^(apps|interfaces|domains|infrastructure)/" },
    ),
    forbidden(
      "admin-services-zero-deps",
      "pds-admin and chat-admin import only node:*, their own folder and ZERO_DEP_ALLOWLIST (§5.2).",
      { path: "^(interfaces/(pds-admin|chat-admin)/)" },
      { pathNot: ["^$1", ...ZERO_DEP_ALLOWLIST.map((p) => `^${escapeRegex(p)}`)], dependencyTypesNot: ["core"] },
    ),
    forbidden(
      "allowlist-zero-deps",
      "A ZERO_DEP_ALLOWLIST folder imports only node:* and its own files, so nothing reaches the admin services transitively.",
      { path: `(${anyOf(ZERO_DEP_ALLOWLIST)})` },
      { pathNot: "^$1", dependencyTypesNot: ["core"] },
    ),
    ...SDK_ADAPTERS.map(({ sdk, adapter }) =>
      forbidden(
        "vendor-sdk-one-adapter",
        `${sdk} is imported only in ${adapter} (guideline §1, O-7).`,
        { pathNot: `^${escapeRegex(adapter)}` },
        { path: npmPackage(sdk) },
      ),
    ),
    forbidden(
      "net-guard-leaf",
      "net-guard imports only node:*, undici and its own files (plan §5.4).",
      { path: "^infrastructure/net-guard/", pathNot: "\\.test\\.ts$" },
      { pathNot: ["^infrastructure/net-guard/", npmPackage("undici")], dependencyTypesNot: ["core"] },
    ),
    forbidden(
      "net-guard-leaf",
      "net-guard tests never ship, so they may also import fast-check and vitest (ruling 2026-10-04, rule TE-6).",
      { path: "^infrastructure/net-guard/.*\\.test\\.ts$" },
      {
        pathNot: ["^infrastructure/net-guard/", npmPackage("undici"), npmPackage("fast-check"), npmPackage("vitest")],
        dependencyTypesNot: ["core"],
      },
    ),
    forbidden(
      "web-not-admin",
      "The public web surface imports nothing admin (§5.7).",
      { path: "^(apps/web|interfaces/http)/" },
      { path: "(^|/)admin/" },
    ),
    forbidden(
      "island-import-boundary",
      "An island ships to the browser: a *.island.tsx imports only shared/ui, shared/islands, the npm modules in ISLAND_NPM_MODULES and type-only modules, never server code (P1.23q, P1.25o; plan §5.1).",
      { path: ISLAND },
      {
        pathNot: ["^shared/ui/", "^shared/islands/", ...ISLAND_NPM_MODULES.map(npmModule)],
        dependencyTypesNot: ["type-only"],
      },
    ),
    forbidden(
      "lexicon-scripts-not-imported",
      "The lexicon build scripts are tooling inside the lexicons package; no file outside shared/lexicons/scripts/ imports one (P1.31d).",
      { pathNot: LEXICON_SCRIPTS },
      { path: LEXICON_SCRIPTS },
    ),
    forbidden(
      "edge-not-preflight",
      "The edge is trusted base and the preflight is product: no deployment/edge/ file, tests included, imports deployment/preflight/ (P1.28g; architecture amendment 8 item 2 in 2026-10-07-p130s-networks-and-caddyfile-reader.md).",
      { path: "^deployment/edge/" },
      { path: "^deployment/preflight/" },
    ),
    // P1.28k (architecture amendment 8, second note, 2026-10-08 01:10Z): an import nothing here can follow escapes every
    // path rule above, so our own relative and @unset/* specifiers must resolve. UNRESOLVED_BUILD_IMPORTERS are the
    // exception, and only for RENDER_BUILD_MODULE. How a specifier may be spelled (no root-absolute path, URL scheme
    // or undeclared package) is the raw-specifier allowlist in scripts/lint/specifiers.ts, because these rules see
    // only where it resolved.
    forbidden(
      "specifier-must-resolve",
      "A relative or @unset/* specifier must resolve (P1.28k).",
      { pathNot: oneOfFiles(UNRESOLVED_BUILD_IMPORTERS) },
      { couldNotResolve: true, path: "^(\\.{1,2}(/|$)|@unset/)" },
    ),
    forbidden(
      "specifier-must-resolve",
      "These files' only unresolved import is the web server build (P1.28k, P1.23w, P1.26).",
      { path: oneOfFiles(UNRESOLVED_BUILD_IMPORTERS) },
      { couldNotResolve: true, path: "^(\\.{1,2}(/|$)|@unset/)", pathNot: oneOfFiles([RENDER_BUILD_MODULE]) },
    ),
    forbidden(
      "fake-only-in-composition-root",
      "A *.fake.ts is imported only by tests and interfaces/*/compose.ts (rule TE-1).",
      { pathNot: ["^tests/", "\\.test\\.(ts|tsx|mts|cts)$", "^interfaces/[^/]+/compose\\.ts$"] },
      { path: FAKE },
    ),
    forbidden(
      "fake-only-in-composition-root",
      "compose.ts reaches a fake only by a dynamic import() after its UNSET_ENV check (rule TE-1).",
      { path: "^interfaces/[^/]+/compose\\.ts$" },
      { path: FAKE, dynamic: false },
    ),
    forbidden(
      "app-build-config-imports",
      "An app's vite.config.ts imports only Node built-ins, npm, its own app, shared/ and scripts/ui/css-scope.ts (P1.23v).",
      { path: "^apps/([^/]+)/vite\\.config\\.ts$" },
      {
        pathNot: ["^apps/$1/", "^shared/", "^scripts/ui/css-scope\\.ts$"],
        dependencyTypesNot: ["core", ...NPM.dependencyTypes],
      },
    ),
    forbidden(
      "app-build-config-not-imported",
      "An app's vite.config.ts is build-time tooling; no module imports it (P1.23v).",
      {},
      { path: APP_BUILD_CONFIG },
    ),
    forbidden("no-circular", "No dependency cycles.", {}, { circular: true }),
    forbidden(
      "no-orphans",
      "A module nothing imports is usually dead code.",
      { orphan: true, pathNot: [TOOLING, "\\.d\\.ts$"] },
      {},
      "warn",
    ),
  ],
  options: {
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    // dependency-cruiser 18.5.0 sets exportsFields to [] by default (src/main/resolve-options/normalize.mjs:35), so a
    // package that publishes only an `exports` map (no `main`) never resolved and escaped every path rule. Read the
    // map with Node's conditions (types/options.d.mts:310, enhanced-resolve 5.26.0) (P1.31d).
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default"] },
    // Own build outputs and fixture folders only (P1.33f). A `(^|/)` prefix also matched
    // node_modules/yaml/dist, and dependency-cruiser 18.5.0 then drops that module
    // (types/filter-types.d.mts, IExcludeType.path), so no row ever saw the import.
    // yaml 2.9.1 resolves to dist/index.js (node_modules/yaml/package.json, `main`).
    // `deployment/dist` has no extra segment; scripts and tests emit a dist too.
    exclude: {
      path: [
        "^(dist|coverage|\\.worktrees|graphify-out)/",
        "^(apps|interfaces|domains|infrastructure|shared|deployment|scripts|tests)/(dist|coverage)/",
        "^(apps|interfaces|domains|infrastructure|shared|deployment|scripts|tests)/.+/((dist|coverage)/)",
        "^scripts/guards/fixtures/",
        "^scripts/lint/semgrep/fixtures/",
        // The docs site is not product code. Its vendored FlexSearch bundle (and Hugo's
        // public/ and resources/ output) is browser JavaScript; the bundle contains a
        // Node require("worker_threads") that is not an import the matrix governs (P0.09).
        "^docs/site/(assets/js/vendor|public|resources)/",
      ],
    },
  },
};

// The tables the tests check. Non-enumerable, so the config schema (no extra keys) never sees them.
Object.defineProperties(module.exports, {
  ZERO_DEP_ALLOWLIST: { value: ZERO_DEP_ALLOWLIST },
  RENDER_ENTRIES: { value: RENDER_ENTRIES },
  RENDER_BUILD_IMPORT: { value: RENDER_BUILD_IMPORT },
  E2E_SERVER_BUILD: { value: E2E_SERVER_BUILD },
  SDK_ADAPTERS: { value: SDK_ADAPTERS },
  MATRIX: { value: MATRIX },
  PDS_UI_PUBLIC_ENTRIES: { value: PDS_UI_PUBLIC_ENTRIES },
  LEXICON_SCRIPT_BUILTINS: { value: LEXICON_SCRIPT_BUILTINS },
});
