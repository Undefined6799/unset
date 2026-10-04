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

const NPM = { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled"] };
const CORE = { dependencyTypes: ["core"] };
// Root files count as tooling only when they are config files (vitest.config.ts, this file).
const TOOLING =
  "^(scripts|tests)/|^[^/]+\\.config\\.[cm]?[jt]s$|^\\.dependency-cruiser\\.cjs$|\\.test\\.(ts|tsx|mts|cts)$";
const FAKE = "\\.fake\\.[cm]?tsx?$";
const ADMIN_SERVICES = "^interfaces/(pds-admin|chat-admin)/";
const LEAF_SHARED = "^shared/(ui|lexicons|admin-envelope)/";

/** The allowlist matrix. Each row: a name, the importing folder, and what it may reach. */
const MATRIX = [
  { name: "app", from: { path: "^apps/([^/]+)/" }, to: [{ path: "^apps/$1/" }, { path: "^shared/" }, NPM] },
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
  { name: "shared-ui-lexicons", from: { path: "^(shared/(ui|lexicons)/)" }, to: [{ path: "^$1" }, NPM] },
  { name: "shared-admin-envelope", from: { path: "^(shared/admin-envelope/)" }, to: [{ path: "^$1" }, CORE] },
  { name: "tooling", from: { path: TOOLING }, to: [{}] },
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
      { path: "^apps/" },
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
      { path: "^infrastructure/net-guard/" },
      { pathNot: ["^infrastructure/net-guard/", npmPackage("undici")], dependencyTypesNot: ["core"] },
    ),
    forbidden(
      "web-not-admin",
      "The public web surface imports nothing admin (§5.7).",
      { path: "^(apps/web|interfaces/http)/" },
      { path: "(^|/)admin/" },
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
    exclude: { path: "(^|/)(dist|coverage|\\.worktrees|graphify-out|scripts/guards/fixtures)/" },
  },
};

// The tables the tests check. Non-enumerable, so the config schema (no extra keys) never sees them.
Object.defineProperties(module.exports, {
  ZERO_DEP_ALLOWLIST: { value: ZERO_DEP_ALLOWLIST },
  RENDER_ENTRIES: { value: RENDER_ENTRIES },
  SDK_ADAPTERS: { value: SDK_ADAPTERS },
  MATRIX: { value: MATRIX },
});
