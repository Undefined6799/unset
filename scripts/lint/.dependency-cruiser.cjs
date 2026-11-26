// Module boundaries (decision 34; Architecture and Development Guideline §1–§2; plan §7; rule AB-1).
// `allowed` (built from MATRIX) is the definition: an edge no row lists fails as `not-in-allowed`.
// The `forbidden` rules restate the boundaries so a failure names the one it breaks.
// A new edge is a new MATRIX row plus its fixture in scripts/lint/depcruise.test.ts, in the same PR.

/** Folders pds-admin and chat-admin may import (guideline §1). Adding one needs Alex's approval in the PR. */
const ZERO_DEP_ALLOWLIST = ["shared/admin-envelope/"];

/** Server-side render entries an interface may import from its app (guideline §1). P1.20 fixes the paths. */
const RENDER_ENTRIES = { admin: "apps/admin/render.tsx" };
// What interfaces/web may import from apps/web (ADR 0056 Consequences, P1.20c): the Svelte components, the theme file,
// the Tailwind entry and the legal texts directly in apps/web/legal/ (read as `?raw` by the legal pages). Not the
// React UI.
const WEB_COMPONENTS = "^apps/web/(lib/|app\\.css$|theme\\.css$|legal/[^/]+\\.md$)";
// Svelte code: the web process and the components it composes. Neither reaches the React UI in shared/ui.
const SVELTE_UI_FROM = "^(interfaces/web/|apps/web/lib/)";

/** Each vendor SDK is imported in exactly one adapter folder per runtime (guideline §1, O-7). */
const SDK_ADAPTERS = [
  { sdk: "pg", adapter: "infrastructure/postgres/" },
  { sdk: "undici", adapter: "infrastructure/net-guard/" },
  { sdk: "@atproto/oauth-client-node", adapter: "infrastructure/pds/" },
  { sdk: "@atproto/api", adapter: "infrastructure/pds/" },
  { sdk: "@aws-sdk/client-s3", adapter: "infrastructure/storage/" },
  // The indexer's stream reader (ADR 0052, P3.05s); @atproto/repo, @atproto/crypto and ws are its tests' stand-in PDS.
  { sdk: "@atproto/sync", adapter: "infrastructure/firehose/" },
  { sdk: "@atproto/xrpc-server", adapter: "infrastructure/firehose/" },
  { sdk: "@atproto/repo", adapter: "infrastructure/firehose/" },
  { sdk: "@atproto/crypto", adapter: "infrastructure/firehose/" },
  { sdk: "ws", adapter: "infrastructure/firehose/" },
  { sdk: "age-encryption", adapter: "infrastructure/seal/" },
  { sdk: "@atproto/lex[^/]*", adapter: "shared/lexicons/" },
  { sdk: "matrix-js-sdk", adapter: "apps/chat/matrix/" },
  { sdk: "@milkdown/[^/]*", adapter: "apps/web/lib/editor/" },
  { sdk: "prosemirror-[^/]*", adapter: "apps/web/lib/editor/" },
  // The Text editor's code block (P1.21v, code-block.ts): CodeMirror and its parsers' highlighting tags.
  { sdk: "@codemirror/[^/]*", adapter: "apps/web/lib/editor/" },
  { sdk: "@lezer/[^/]*", adapter: "apps/web/lib/editor/" },
  // ADR 0070 point 2.2: pictures are decoded only in infrastructure/image's sandboxed children, never in web.
  { sdk: "sharp", adapter: "infrastructure/image/" },
  { sdk: "@img/[^/]+", adapter: "infrastructure/image/" },
  // ADR 0080: web's outbound mail goes through infrastructure/email's one SMTP adapter.
  { sdk: "nodemailer", adapter: "infrastructure/email/" },
];

/** Node built-ins a domain may not import: I/O arrives as a passed-in dependency (README rule 1). */
const IO_BUILTINS = "fs|net|http|https|http2|dgram|dns|tls|child_process|worker_threads";

const escapeRegex = (path) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (paths) => `^(${paths.map(escapeRegex).join("|")})`;
const oneOfFiles = (paths) => `${anyOf(paths)}$`;

/**
 * The files through which a domain is reached from outside domains/: its index.ts and each file its package.json
 * `exports` names (P0.09s, rule DC-2). Read here and never hard-coded, so a new subpath is a visible package.json
 * change in a domain PR. dependency-cruiser does not judge `exports` itself (18.7.0 resolves with
 * `exportsFields: []`, src/main/resolve-options/normalize.mjs:35), and a relative `../../domains/<x>/<file>.ts`
 * bypasses the map anyway. A conditional (non-string) export target names no file and so allows none.
 */
function domainEntryFiles() {
  const { existsSync, readdirSync, readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const root = join(__dirname, "../../domains");
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "package.json")))
    .flatMap((entry) => {
      const targets = Object.values(
        JSON.parse(readFileSync(join(root, entry.name, "package.json"), "utf8")).exports ?? {},
      );
      return ["./index.ts", ...targets]
        .filter((target) => typeof target === "string" && /^\.\/[\w./-]+$/.test(target) && !target.includes(".."))
        .map((target) => `domains/${entry.name}/${target.slice(2)}`);
    });
}
const DOMAIN_ENTRY_FILES = domainEntryFiles();
const npmPackage = (name) => `^(node_modules/)?${name}(/|$)`;

/**
 * The web process's own build (P1.20k): server.ts loads SvelteKit's adapter-node handler and the client manifest
 * through the package "imports" #kit/handler and #kit/manifest (interfaces/web/package.json), literal so semgrep's
 * computed-import rule passes. Their targets are under build/, which does not exist when lint runs, so the edges are
 * unresolved. Only this file, only these two specifiers.
 */
const WEB_SERVER_BUILD = { from: "interfaces/web/server.ts", modules: ["#kit/handler", "#kit/manifest"] };

const NPM = { dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled"] };
const CORE = { dependencyTypes: ["core"] };
// An app's Vite build config (P1.23v; architecture record 2026-10-06-p116-retention-usage-and-p124-icon-source.md,
// amendments 20:20Z and 20:55Z): it runs in Node at build time only, so it may import Node built-ins, and nothing
// imports it. It once also reached scripts/ui/css-scope.ts, which left with the React screens (a25d62a, P1.38v).
// Three rules implement that one allowance: app-only-shared exempts the config, app-build-config-imports narrows what
// it may reach, and app-build-config-not-imported keeps it a leaf. Exactly apps/<app>/vite.config.ts; a file of that
// name deeper in an app is product code.
const APP_BUILD_CONFIG = "^apps/[^/]+/vite\\.config\\.ts$";
// Root files count as tooling only when they are config files (vitest.config.ts); so does an app's build config.
const TOOLING = `^(scripts|tests)/|^[^/]+\\.config\\.[cm]?[jt]s$|\\.test\\.(ts|tsx|mts|cts)$|${APP_BUILD_CONFIG}`;
// The files that never ship (P1.28p): defined once in tooling.ts, which specifiers.ts reads too. Node 26 loads a
// TypeScript ES module through require() (doc/api/modules.md "Loading ECMAScript modules using require()";
// doc/api/typescript.md "Type stripping").
const { TOOLING_PATTERN } = require("./tooling.ts");
const FAKE = "\\.fake\\.[cm]?tsx?$";
const ADMIN_SERVICES = "^interfaces/(pds-admin|chat-admin)/";
const LEAF_SHARED = "^shared/(ui|ui-build|lexicons|admin-envelope|host-pin|safe-href)/";
// The lexicon build scripts and the Node built-ins they may import, each named exactly (P1.31d). Adding one loosens a
// guard: a check-path PR with an architecture ruling and Alex's typed word.
const LEXICON_SCRIPTS = "^shared/lexicons/scripts/";
const LEXICON_SCRIPT_BUILTINS = ["fs", "path", "os", "url", "child_process"];
// A module under infrastructure/ or shared/ and the one file others may import from it (rule DC-2).
const WORKSPACE_WITH_INDEX = "(?:infrastructure|shared)/[^/]+/";
const INDEX_FILE = `^${WORKSPACE_WITH_INDEX}index\\.ts$`;
// Non-TypeScript assets (a CSS Module) are imported directly; they export no code.
const ASSET = "\\.css$";
// P1.20c (ADR 0055 point 4): the Svelte Icon draws the pinned Iconoir data, read through @unset/shared-ui's
// "./icons.json" export, because shared/ui's index.ts brings React. It and the chat page's byte-identical copy (P6.10)
// are the only files that may.
const SVELTE_ICON = "^apps/(web|chat)/lib/components/icon/icon\\.svelte$";
const ICON_DATA = "^shared/ui/icons/icons\\.json$";
// The web's font route reads the two woff2 files from shared/ui/fonts, their one copy in the repository (Alex
// 2026-11-18 12:10Z: no identical copies), through @unset/shared-ui's "./fonts/*.woff2" export. Only that file may,
// and only those files, as the Icon may only icons.json.
const FONT_READER = "^interfaces/web/src/lib/server/fonts\\.ts$";
const FONT_DATA = "^shared/ui/fonts/[A-Za-z]+-Variable\\.woff2$";
// P1.20c: stock shadcn-svelte dialog-content.svelte imports its own folder's index.ts, which re-exports it. The only
// cycle allowed, and only inside that folder.
const STOCK_DIALOG = "^apps/web/lib/components/ui/dialog/";
// P1.20c: svelte.config.js exists only for svelte-check to read (nothing imports it), like a vite.config.ts.
const SVELTE_CHECK_CONFIG = "^apps/web/svelte\\.config\\.js$";

/** The allowlist matrix. Each row: a name, the importing folder, and what it may reach. */
const MATRIX = [
  { name: "app", from: { path: "^apps/([^/]+)/" }, to: [{ path: "^apps/$1/" }, { path: "^shared/" }, NPM] },
  {
    name: "interface",
    from: { path: "^interfaces/([^/]+)/", pathNot: ADMIN_SERVICES },
    to: [{ path: "^interfaces/$1/" }, { path: "^(domains|infrastructure|shared)/" }, CORE, NPM],
  },
  {
    // SvelteKit's own modules ($app/env, $app/forms, ...), which only SvelteKit's Vite plugin resolves (kit 3.2.0
    // types/index.d.ts declares them, `declare module '$app/env'`).
    name: "interface-web-sveltekit",
    from: { path: "^interfaces/web/" },
    to: [{ path: "^\\$app/[a-z-]+$", couldNotResolve: true }],
  },
  {
    // ADR 0056 Consequences: the web process composes the Svelte components, the theme and the Tailwind entry that
    // live in apps/web (P1.20c). Only those; never apps/web's React UI, and apps/web never imports interfaces/.
    name: "interface-web-components",
    from: { path: "^interfaces/web/" },
    to: [{ path: WEB_COMPONENTS }],
  },
  {
    name: "interface-web-build",
    from: { path: oneOfFiles([WEB_SERVER_BUILD.from]) },
    to: [{ path: oneOfFiles(WEB_SERVER_BUILD.modules), couldNotResolve: true }],
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
  // The link checker (P1.20i; Alex 2026-11-18): a leaf with no dependencies, so the Svelte UI can use it without the
  // React kit. shared/ui reaches it only through its index and re-exports safeHref, so no React caller changes.
  { name: "shared-ui-safe-href", from: { path: "^shared/ui/" }, to: [{ path: "^shared/safe-href/index\\.ts$" }] },
  { name: "shared-safe-href", from: { path: "^(shared/safe-href/)" }, to: [{ path: "^$1" }] },
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
  // child process, never by import, so no edge to scripts/. Outside itself it may import three files, exactly:
  // deployment/edge/adapted.ts and adapted-rules.ts, so C18 judges what `caddy adapt` prints with the edge's own
  // comparison and rules and no second copy (P1.39c, ADR 0046 decision 4; Alex's line "loosen preflight imports for
  // adapted rules at 9ea2394", 2026-11-15), and shared/host-pin/index.ts only (P1.33i, DC-2; Alex's typed line
  // "yes P1.33i scripts/lint depcruise deployment-preflight row shared/host-pin", 2026-10-14). dependency-cruiser
  // 18.5.0 matches `to.path` as a regular expression against the resolved path (doc/rules-reference.md, `path`).
  // The Caddyfile reader this row once named (P1.30r) was deleted in P1.39e, and its entry with it.
  // The edge may still never import the preflight (edge-not-preflight).
  {
    name: "deployment-preflight",
    from: { path: "^deployment/preflight/" },
    to: [
      { path: "^deployment/preflight/" },
      { path: "^deployment/edge/adapted\\.ts$" },
      { path: "^deployment/edge/adapted-rules\\.ts$" },
      { path: "^shared/host-pin/index\\.ts$" },
      { path: npmPackage("yaml") },
      CORE,
    ],
  },
  { name: "tooling", from: { path: TOOLING }, to: [{}] },
];

// The web process's server-side files (ADR 0056 decision 2): only these may reach a domain or infrastructure.
const WEB_SERVER_FILES = [
  "^interfaces/web/server\\.ts$",
  "^interfaces/web/vite\\.config\\.ts$",
  "^interfaces/web/src/hooks\\.server\\.ts$",
  "^interfaces/web/src/lib/server/",
  "^interfaces/web/src/routes/.*\\.server\\.ts$",
  "^interfaces/web/src/routes/.*\\+server\\.ts$",
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
      "From outside apps/, only interfaces/admin and web import an app, each only what its own rule allows (guideline §1).",
      { pathNot: `^apps/|^interfaces/(admin|web)/|${TOOLING}` },
      { path: "^apps/" },
    ),
    forbidden(
      "web-components-only",
      "interfaces/web imports only apps/web's Svelte components, theme and Tailwind entry (ADR 0056, P1.20c).",
      { path: "^interfaces/web/" },
      { path: "^apps/", pathNot: WEB_COMPONENTS },
    ),
    forbidden(
      "svelte-no-react-ui",
      "The web process and the Svelte components take only icons.json from shared/ui, never its React UI (ADR 0055, P1.20c).",
      { path: SVELTE_UI_FROM, pathNot: FONT_READER },
      { path: "^shared/ui/", pathNot: ICON_DATA },
    ),
    forbidden(
      "svelte-no-react-ui",
      "The web's font route takes only the two font files from shared/ui.",
      { path: FONT_READER },
      { path: "^shared/ui/", pathNot: FONT_DATA },
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
      "domain-via-exports",
      "From apps/, interfaces/, infrastructure/ or shared/, a domain is reached only through its index.ts or a file its package.json exports names, tests included (P0.09s, rule DC-2).",
      { path: "^(apps|interfaces|infrastructure|shared)/" },
      { path: "^domains/", pathNot: oneOfFiles(DOMAIN_ENTRY_FILES) },
    ),
    forbidden(
      "infra-shared-via-index",
      "From outside, a module under infrastructure/ or shared/ is reached only through its index.ts, tests included (rule DC-2). A *.fake.ts is exempt (fake-only-in-composition-root governs it, and an index.ts never exports one), and so is CSS.",
      { pathNot: [`^${WORKSPACE_WITH_INDEX}`, SVELTE_ICON, FONT_READER] },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: [INDEX_FILE, FAKE, ASSET] },
    ),
    forbidden(
      "infra-shared-via-index",
      "The Svelte Icon reaches shared/ only through an index.ts, and shared/ui's icons.json through its package export.",
      { path: SVELTE_ICON },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: [INDEX_FILE, FAKE, ASSET, ICON_DATA] },
    ),
    forbidden(
      "infra-shared-via-index",
      "The web's font route reaches shared/ only through an index.ts, and shared/ui's fonts through their package export.",
      { path: FONT_READER },
      { path: `^${WORKSPACE_WITH_INDEX}`, pathNot: [INDEX_FILE, FAKE, ASSET, FONT_DATA] },
    ),
    forbidden(
      "infra-shared-via-index",
      "Outside shared/ui, the fonts are read through the @unset/shared-ui/fonts export, never by a path.",
      { pathNot: "^shared/ui/" },
      { path: FONT_DATA, dependencyTypes: ["local"] },
    ),
    forbidden(
      "infra-shared-via-index",
      "Outside shared/ui, icons.json is read through the @unset/shared-ui/icons.json export, never by a path (P1.20c).",
      { pathNot: "^shared/ui/" },
      { path: ICON_DATA, dependencyTypes: ["local"] },
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
      { path: "^(apps/web|interfaces/web)/" },
      { path: "(^|/)admin/" },
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
    // path rule above, so our own relative and @unset/* specifiers must resolve, with no exception since P1.20k
    // deleted the React render build. How a specifier may be spelled (no root-absolute path, URL scheme or undeclared
    // package) is the raw-specifier allowlist in scripts/lint/specifiers.ts, because these rules see only where it
    // resolved.
    forbidden(
      "specifier-must-resolve",
      "A relative or @unset/* specifier must resolve (P1.28k).",
      {},
      { couldNotResolve: true, path: "^(\\.{1,2}(/|$)|@unset/)" },
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
      "An app's vite.config.ts imports only Node built-ins, npm, its own app and shared/ (P1.23v).",
      { path: "^apps/([^/]+)/vite\\.config\\.ts$" },
      {
        pathNot: ["^apps/$1/", "^shared/"],
        dependencyTypesNot: ["core", ...NPM.dependencyTypes],
      },
    ),
    forbidden(
      "app-build-config-not-imported",
      "An app's vite.config.ts is build-time tooling; no module imports it (P1.23v).",
      {},
      { path: APP_BUILD_CONFIG },
    ),
    forbidden(
      "svelte-screens-no-core",
      "In the web process only server files (*.server.ts, hooks.server.ts, server.ts, lib/server/) reach a domain or infrastructure; a screen or universal load never does (ADR 0056 decision 2).",
      { path: "^interfaces/web/", pathNot: WEB_SERVER_FILES },
      { path: "^(domains|infrastructure)/" },
    ),
    forbidden(
      "web-routes-no-postgres",
      "A web route reaches the database only through an operation in lib/server, never by importing infrastructure/postgres (P1.20t).",
      { path: "^interfaces/web/src/routes/" },
      { path: "^infrastructure/postgres/" },
    ),
    forbidden(
      "sveltekit-web-only",
      "Only the web process, its screens and the chat page (ADR 0099) import Svelte or SvelteKit; domains, infrastructure and shared stay framework-free (ADR 0056 decision 3).",
      { pathNot: "^(interfaces/web|apps/web|apps/chat)/" },
      { path: "^(node_modules/)?(svelte|@sveltejs/[^/]+)(/|$)" },
    ),
    forbidden(
      "no-circular",
      "No dependency cycles; stock shadcn-svelte's dialog barrel is the one exception (P1.20c).",
      { pathNot: STOCK_DIALOG },
      { circular: true },
    ),
    forbidden(
      "no-circular",
      "A cycle that starts in the stock dialog folder must stay inside it.",
      { path: STOCK_DIALOG },
      { circular: true, pathNot: STOCK_DIALOG },
    ),
    forbidden(
      "no-orphans",
      "A module nothing imports is usually dead code.",
      // SvelteKit's route files and hooks are entry points SvelteKit loads itself (ADR 0054); svelte-check reads
      // apps/web's svelte.config.js (P1.20c). A test's stand-in child process is started by path (ADR 0070).
      {
        orphan: true,
        pathNot: [
          TOOLING,
          "\\.d\\.ts$",
          "^interfaces/web/src/(routes/|hooks\\.server\\.ts$)",
          SVELTE_CHECK_CONFIG,
          "^infrastructure/image/fixtures/[a-z-]+-child\\.ts$",
        ],
      },
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
        // SvelteKit's build output and generated types (interfaces/web/.gitignore).
        "^interfaces/web/(build|\\.svelte-kit)/",
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
  WEB_SERVER_BUILD: { value: WEB_SERVER_BUILD },
  SDK_ADAPTERS: { value: SDK_ADAPTERS },
  MATRIX: { value: MATRIX },
  DOMAIN_ENTRY_FILES: { value: DOMAIN_ENTRY_FILES },
  LEXICON_SCRIPT_BUILTINS: { value: LEXICON_SCRIPT_BUILTINS },
});
