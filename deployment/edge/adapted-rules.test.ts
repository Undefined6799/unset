// P1.39b (ADR 0046 decision 3): the edge's rules on Caddy's adapted config. Each reviewed config in adapted/ passes
// with real values in place of the sentinels, and each rule has a red built by changing one of them. No container:
// the configs themselves are proved against the built image in adapted.image.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { SENTINELS } from "./adapted.ts";
import {
  type AdaptedEnv,
  adaptedProblems,
  CHAT_DOOR_PATH,
  CHAT_MATRIX_PATH,
  DEV_APP,
  DEV_CHAT,
  DEV_DOCS,
  DEV_LISTENER,
  DEV_PROXY_ADDRESS,
  DEV_TLS,
  DOCS_CSP,
  type EdgeMode,
  type EnvName,
  type Json,
  PAGE_CSP,
} from "./adapted-rules.ts";

const EDGE = import.meta.dirname;
type Obj = Record<string, Json>;
const o = (value: Json | undefined): Obj => value as Obj;
const a = (value: Json | undefined): Json[] => value as Json[];
const copy = (value: Json): Json => JSON.parse(JSON.stringify(value)) as Json;

const PDS = { PDS_HOST: "pds.example.org", PDS_UPSTREAM: "pds:3000" } as const;
/** The envs with a reviewed config: each mode, and dev-chat, the source stack's dev edge with the chat site (P6.02). */
type Case = EdgeMode | "dev-chat";
const ENVS: Readonly<Record<Case, AdaptedEnv>> = {
  shipped: { ...PDS, ACME_EMAIL: "edge@example.org" },
  local: { ...PDS, APP_HOST: "app.example.org", APP_UPSTREAM: "web:8080" },
  dev: { ...PDS, ...DEV_APP, ...DEV_DOCS },
  "dev-chat": { ...PDS, ...DEV_APP, ...DEV_DOCS, ...DEV_CHAT },
};
const FILES: Readonly<Record<Case, string>> = { shipped: "prod", local: "local", dev: "dev", "dev-chat": "dev-chat" };
/** The mode the rules judge a case in: dev-chat is dev with the chat site's values set. */
const modeOf = (each: Case): EdgeMode => (each === "dev-chat" ? "dev" : each);
const CASES = ["shipped", "local", "dev", "dev-chat"] as const;

/** What Caddy adapts for `mode` with ENVS' values: the reviewed text with each sentinel replaced. */
function adapted(mode: Case): Json {
  const text = readFileSync(join(EDGE, "adapted", `${FILES[mode]}.generated.json`), "utf8");
  const names = Object.keys(ENVS[mode]) as EnvName[];
  return JSON.parse(names.reduce((out, name) => out.replaceAll(SENTINELS[name], ENVS[mode][name] as string), text));
}

// Where things sit in an adapted config, for a red to change in place.
const servers = (config: Json): Obj => o(o(o(o(config).apps).http).servers);
const publicServer = (config: Json): Obj =>
  Object.values(servers(config))
    .map(o)
    .find((server) => !String(a(server.listen)[0]).startsWith("127.")) as Obj;
const healthServer = (config: Json): Obj =>
  Object.values(servers(config))
    .map(o)
    .find((server) => String(a(server.listen)[0]).startsWith("127.")) as Obj;
const siteRoute = (config: Json, host: string): Obj =>
  a(publicServer(config).routes)
    .map(o)
    .find((route) => JSON.stringify(route.match) === JSON.stringify([{ host: [host] }])) as Obj;
/** A site's handlers: the security headers and the like, then the one subroute that is the site's `route`. */
const site = (config: Json, host: string): Json[] => a(o(a(o(a(siteRoute(config, host).handle)[0]).routes)[0]).handle);
/** The routes inside a site's `route`: the zones first, the deny routes, then the upstream. */
const inner = (config: Json, host: string): Json[] =>
  a(
    site(config, host)
      .map(o)
      .find((handler) => handler.handler === "subroute")?.routes,
  );
const handlerIn = (routes: Json[], name: string): Obj =>
  routes
    .flatMap((route) => a(o(route).handle))
    .map(o)
    .find((handler) => handler.handler === name) as Obj;
const proxy = (config: Json, host: string): Obj => handlerIn(inner(config, host), "reverse_proxy");
const zones = (config: Json, host: string): Obj => o(handlerIn(inner(config, host), "rate_limit").rate_limits);
const request = (config: Json, host: string): Obj => o(o(proxy(config, host).headers).request);
const tls = (config: Json): Obj => o(o(o(config).apps).tls);
const P = PDS.PDS_HOST;
const APP_LOCAL = "app.example.org";
const APP_DEV = DEV_APP.APP_HOST;
const respond = (status: number): Json => ({ handler: "static_response", status_code: status });
const routeNamed = (config: Json, host: string, text: string): number =>
  inner(config, host).findIndex((route) => JSON.stringify(route).includes(text));

type Red = readonly [what: string, mode: Case, change: (config: Json) => void, reason: string];

// The too-many-tries error route of a site (snippets/too-many-tries.caddy), and the three routes inside it: the
// navigation's Content-Type, the headers every 429 gets, and the page.
const errorRoutes = (config: Json): Json[] => a(o(publicServer(config).errors).routes);
const errorRoute = (config: Json, host: string): Obj =>
  errorRoutes(config)
    .map(o)
    .find((route) => JSON.stringify(route.match) === JSON.stringify([{ host: [host] }])) as Obj;
const pageRoutes = (config: Json, host: string): Obj[] =>
  a(o(a(o(a(o(a(errorRoute(config, host).handle)[0]).routes)[0]).handle)[0]).routes).map(o);
const page = (config: Json, host: string): Obj => o(a(pageRoutes(config, host)[2]?.handle)[0]);
const editPage = (config: Json, host: string, edit: (body: string) => string): void => {
  const respond = page(config, host);
  respond.body = edit(String(respond.body));
};
const NOT_THE_PAGE = (host: string) => `{$${host}}: the error route is not the ruled too-many-tries page`;
const PAGE = (host: string, problem: string) => `{$${host}}: the too-many-tries page ${problem}`;

const SHAPE: Red[] = [
  [
    "a top-level key",
    "shipped",
    (c) => void Object.assign(o(c), { storage: {} }),
    "the config holds a key the rules do not read",
  ],
  [
    "a third app",
    "shipped",
    (c) => void Object.assign(o(o(c).apps), { pki: {} }),
    "apps holds a key the rules do not read",
  ],
  [
    "a server key",
    "local",
    (c) => void Object.assign(publicServer(c), { protocols: ["h1"] }),
    "a server holds a key the rules do not read",
  ],
  [
    "a route group",
    "local",
    (c) => void Object.assign(o(inner(c, P)[0]), { group: "g" }),
    "a route holds a key the rules do not read",
  ],
  [
    "a matcher the rules do not read",
    "local",
    (c) => void Object.assign(o(inner(c, P)[0]), { match: [{ remote_ip: { ranges: ["10.0.0.0/8"] } }] }),
    "a matcher holds a key the rules do not read",
  ],
  [
    "a matcher under not",
    "dev",
    (c) => void Object.assign(o(a(o(a(o(inner(c, APP_DEV)[1]).match)[0]).not)[0]), { expression: "true" }),
    "a matcher holds a key the rules do not read",
  ],
  [
    "a handler the rules do not read",
    "local",
    (c) => void a(o(inner(c, P)[0]).handle).push({ handler: "rewrite", uri: "/" }),
    "a handler the rules do not read",
  ],
  [
    "a handler key",
    "local",
    (c) => void Object.assign(proxy(c, P), { load_balancing: {} }),
    "a reverse_proxy handler holds a key the rules do not read",
  ],
  [
    "a zone key",
    "local",
    (c) => void Object.assign(o(zones(c, P).global), { burst: 1 }),
    "a zone holds a key the rules do not read",
  ],
  [
    "a zone matcher the rules do not read",
    "local",
    (c) => void Object.assign(o(Object.values(zones(c, P))[0]), { match: [{ query: {} }] }),
    "a matcher holds a key the rules do not read",
  ],
  [
    "a transport key",
    "local",
    (c) => void Object.assign(o(proxy(c, P).transport), { tls: {} }),
    "a transport holds a key the rules do not read",
  ],
  [
    "a response header change at an upstream",
    "local",
    (c) => void Object.assign(o(proxy(c, P).headers), { response: {} }),
    "an upstream's headers holds a key the rules do not read",
  ],
  [
    "a request header operation the rules do not read",
    "local",
    (c) => void Object.assign(request(c, P), { add: { "X-Forwarded-For": ["1.2.3.4"] } }),
    "an upstream's request headers holds a key the rules do not read",
  ],
  ["the admin API on", "shipped", (c) => void Object.assign(o(c), { admin: {} }), "the admin API is not off"],
  [
    "config persisted",
    "shipped",
    (c) => void Object.assign(o(o(c).admin), { config: { persist: true } }),
    "the admin API is not off",
  ],
];

const SERVERS: Red[] = [
  [
    "a health site that answers elsewhere",
    "shipped",
    (c) => void Object.assign(healthServer(c), { listen: ["0.0.0.0:8081"] }),
    "not exactly one health site on loopback",
  ],
  [
    "a second site without an upstream",
    "shipped",
    (c) => void Object.assign(servers(c), { extra: { listen: ["127.0.0.1:9000"] } }),
    "not exactly one public server",
  ],
  [
    "no public server",
    "shipped",
    (c) => void Object.assign(o(o(o(c).apps).http), { servers: { health: healthServer(c) } }),
    "not exactly one public server",
  ],
  [
    "a plain-http listener",
    "shipped",
    (c) => void a(publicServer(c).listen).push(":80"),
    "the public server is not on :443 alone",
  ],
  [
    "a dev site on every address",
    "dev",
    (c) => void Object.assign(publicServer(c), { listen: [":443"] }),
    "not bound to the edge's newt_edge address alone",
  ],
  [
    "automatic HTTPS changed",
    "shipped",
    (c) => void Object.assign(publicServer(c), { automatic_https: { disable: true } }),
    "the public server changes automatic HTTPS",
  ],
  [
    "another timeout",
    "local",
    (c) => void Object.assign(publicServer(c), { read_timeout: 1 }),
    "a server does not keep the shared timeouts",
  ],
  [
    "a trusted proxy outside dev",
    "local",
    (c) => void Object.assign(publicServer(c), { trusted_proxies: { source: "static", ranges: ["10.0.0.0/8"] } }),
    "a server trusts a proxy outside dev",
  ],
  [
    "a client address header outside dev",
    "shipped",
    (c) => void Object.assign(publicServer(c), { client_ip_headers: ["X-Forwarded-For"] }),
    "a server trusts a proxy outside dev",
  ],
  [
    "a wider trusted range",
    "dev",
    (c) => void Object.assign(o(publicServer(c).trusted_proxies), { ranges: ["10.250.37.0/24"] }),
    `${DEV_LISTENER} does not trust exactly ${DEV_PROXY_ADDRESS}`,
  ],
  [
    "left to right",
    "dev",
    (c) => void delete publicServer(c).trusted_proxies_strict,
    `${DEV_LISTENER} does not read right to left`,
  ],
  [
    "another client address header",
    "dev",
    (c) => void a(publicServer(c).client_ip_headers).push("X-Real-IP"),
    `${DEV_LISTENER} reads a header other than X-Forwarded-For`,
  ],
  [
    "a catch-all site",
    "local",
    (c) => void a(publicServer(c).routes).push({ handle: [respond(200)] }),
    "the public server holds a site other than the env's own",
  ],
  [
    "a site for a second host",
    "shipped",
    (c) => void a(o(a(siteRoute(c, P).match)[0]).host).push("other.example.org"),
    "the public server holds a site other than the env's own",
  ],
  [
    "a site route that falls through",
    "local",
    (c) => void delete siteRoute(c, P).terminal,
    "the public server holds a site other than the env's own",
  ],
  [
    "an access log for another name",
    "shipped",
    (c) => void Object.assign(o(o(publicServer(c).logs).logger_names), { "other.example.org": ["log0"] }),
    "the access log does not name exactly the env's sites",
  ],
  [
    "no site for the PDS",
    "local",
    (c) => void Object.assign(publicServer(c), { routes: [siteRoute(c, APP_LOCAL)] }),
    "{$PDS_HOST}: no site",
  ],
];

const CERTIFICATES: Red[] = [
  [
    "another ACME directory",
    "shipped",
    (c) =>
      void Object.assign(o(a(o(a(o(tls(c).automation).policies)[0]).issuers)[0]), { ca: "https://ca.example.org/dir" }),
    "the certificates are not Let's Encrypt's for {$PDS_HOST} alone",
  ],
  [
    "an internal issuer beside it",
    "shipped",
    (c) => void a(o(a(o(tls(c).automation).policies)[0]).issuers).push({ module: "internal" }),
    "the certificates are not Let's Encrypt's for {$PDS_HOST} alone",
  ],
  [
    "a certificate for another name",
    "shipped",
    (c) => void a(o(a(o(tls(c).automation).policies)[0]).subjects).push("other.example.org"),
    "the certificates are not Let's Encrypt's for {$PDS_HOST} alone",
  ],
  [
    "a file certificate under prod",
    "shipped",
    (c) => void Object.assign(publicServer(c), { tls_connection_policies: [{}] }),
    "a file certificate outside dev and local",
  ],
  [
    "another leaf file",
    "local",
    (c) => void Object.assign(o(a(o(tls(c).certificates).load_files)[0]), { certificate: "/etc/caddy/leaf.pem" }),
    "a certificate other than the local (tls)",
  ],
  [
    "the dev leaf under local",
    "local",
    (c) => void Object.assign(o(a(o(tls(c).certificates).load_files)[0]), { certificate: DEV_TLS[0], key: DEV_TLS[1] }),
    "a certificate other than the local (tls)",
  ],
  [
    "the local leaf under dev",
    "dev",
    (c) =>
      void Object.assign(o(a(o(tls(c).certificates).load_files)[0]), {
        certificate: "/run/secrets/local_tls_cert",
        key: "/run/secrets/local_tls_key",
      }),
    "a certificate other than the dev (tls)",
  ],
  [
    "an issuer beside the leaf",
    "dev",
    (c) => void Object.assign(tls(c), { automation: { policies: [{ issuers: [{ module: "internal" }] }] } }),
    "a certificate other than the dev (tls)",
  ],
  [
    "a second leaf",
    "local",
    (c) => void a(o(tls(c).certificates).load_files).push({ certificate: "/a", key: "/b", tags: ["cert1"] }),
    "a certificate other than the local (tls)",
  ],
  [
    "the leaf selected for another name",
    "local",
    (c) => void a(o(o(a(publicServer(c).tls_connection_policies)[0]).match).sni).push("other.example.org"),
    "the local leaf is not selected for exactly the env's hosts",
  ],
  [
    "another certificate selected",
    "dev",
    (c) =>
      void Object.assign(o(a(publicServer(c).tls_connection_policies)[0]), {
        certificate_selection: { any_tag: ["cert1"] },
      }),
    "the dev leaf is not selected for exactly the env's hosts",
  ],
  [
    "a client certificate rule on the fallback policy",
    "dev",
    (c) => void Object.assign(o(a(publicServer(c).tls_connection_policies)[1]), { client_authentication: {} }),
    "the dev leaf is not selected for exactly the env's hosts",
  ],
];

const SITES: Red[] = [
  [
    "a handler beside the site",
    "local",
    (c) => void a(siteRoute(c, P).handle).push(respond(200)),
    "{$PDS_HOST}: not exactly one plain route",
  ],
  [
    "a matched site body",
    "local",
    (c) => void Object.assign(o(a(o(a(siteRoute(c, P).handle)[0]).routes)[0]), { match: [{ path: ["/x"] }] }),
    "{$PDS_HOST}: not exactly one plain route",
  ],
  [
    "a second route in the site",
    "local",
    (c) => void site(c, P).push({ handler: "subroute", routes: [] }),
    "{$PDS_HOST}: not exactly one plain route",
  ],
  [
    "zones behind a matcher",
    "local",
    (c) => void Object.assign(o(inner(c, P)[0]), { match: [{ path: ["/xrpc/*"] }] }),
    "{$PDS_HOST}: the route does not apply the zones first",
  ],
  [
    "a route before the zones",
    "local",
    (c) => void inner(c, P).unshift({ match: [{ path: ["/open"] }], handle: [respond(200)] }),
    "{$PDS_HOST}: the route does not apply the zones first",
  ],
  [
    "an upstream before the zones",
    "local",
    (c) => void a(o(inner(c, APP_LOCAL)[0]).handle).reverse(),
    "{$APP_HOST}: the route does not apply the zones first",
  ],
  ["no zones", "local", (c) => void a(o(inner(c, APP_LOCAL)[0]).handle).shift(), "{$APP_HOST}: 0 rate_limit blocks"],
  [
    "two zone blocks",
    "local",
    (c) => void inner(c, P).splice(1, 0, { handle: [copy(a(o(inner(c, P)[0]).handle)[0] as Json)] }),
    "{$PDS_HOST}: 2 rate_limit blocks",
  ],
  ["no global zone", "local", (c) => void delete zones(c, P).global, "{$PDS_HOST}: there is no global zone"],
  [
    "a matched global zone",
    "local",
    (c) => void Object.assign(o(zones(c, P).global), { match: [{ path: ["/xrpc/*"] }] }),
    "{$PDS_HOST}: the global zone has a matcher",
  ],
  [
    "a matched app global zone",
    "dev",
    (c) => void Object.assign(o(zones(c, APP_DEV).app_global), { match: [{ method: ["POST"] }] }),
    "{$APP_HOST}: the app_global zone has a matcher",
  ],
  [
    "build files counted in app_burst too",
    "dev",
    (c) => void delete o(zones(c, APP_DEV).app_burst).match,
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  [
    "a POST counted as a build file",
    "dev",
    (c) => void a(o(a(o(zones(c, APP_DEV).app_files).match)[0]).method).push("POST"),
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  [
    "a build file matched on the cleaned path",
    "dev",
    (c) =>
      void Object.assign(o(a(o(zones(c, APP_DEV).app_files).match)[0]), {
        vars_regexp: undefined,
        path_regexp: { pattern: "^/_app/immutable/" },
      }),
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  [
    "the PDS's zones on the dev app site",
    "dev",
    (c) => void Object.assign(zones(c, APP_DEV), { global: copy(zones(c, P).global as Json) }),
    "{$APP_HOST}: the route applies another site's zones",
  ],
  [
    "a zone keyed on a header",
    "local",
    (c) => void Object.assign(o(zones(c, P).global), { key: "{http.request.header.X-Forwarded-For}" }),
    "{$PDS_HOST}: a zone is not keyed on {client_ip}",
  ],
  [
    "a zone keyed on nothing",
    "dev",
    (c) => void Object.assign(o(zones(c, APP_DEV).app_signin), { key: "static" }),
    "{$APP_HOST}: a zone is not keyed on {client_ip}",
  ],
];

const UPSTREAMS: Red[] = [
  ["no upstream", "local", (c) => void inner(c, P).pop(), "{$PDS_HOST}: public site without an upstream"],
  [
    "an upstream outside the route",
    "local",
    (c) => void site(c, P).unshift(copy(proxy(c, P))),
    "{$PDS_HOST}: a reverse_proxy is outside the route",
  ],
  [
    "another upstream",
    "local",
    (c) => void Object.assign(proxy(c, P), { upstreams: [{ dial: "other:1" }] }),
    "{$PDS_HOST}: a reverse_proxy does not name the site's one upstream",
  ],
  [
    "the other site's upstream",
    "local",
    (c) => void Object.assign(proxy(c, APP_LOCAL), { upstreams: [{ dial: PDS.PDS_UPSTREAM }] }),
    "{$APP_HOST}: a reverse_proxy does not name the site's one upstream",
  ],
  [
    "a second upstream",
    "local",
    (c) => void a(proxy(c, P).upstreams).push({ dial: "other:1" }),
    "{$PDS_HOST}: a reverse_proxy does not name the site's one upstream",
  ],
  [
    "X-Forwarded-For kept",
    "local",
    (c) => void Object.assign(request(c, P), { delete: ["X-Real-IP", "Forwarded"] }),
    "{$PDS_HOST}: a reverse_proxy passes X-Forwarded-For",
  ],
  [
    "X-Real-IP kept",
    "local",
    (c) => void Object.assign(request(c, P), { delete: ["X-Forwarded-For", "Forwarded"] }),
    "{$PDS_HOST}: a reverse_proxy passes X-Real-IP",
  ],
  [
    "Forwarded kept",
    "dev",
    (c) => void Object.assign(request(c, APP_DEV), { delete: ["X-Forwarded-For", "X-Real-IP"] }),
    "{$APP_HOST}: a reverse_proxy passes Forwarded",
  ],
  [
    "X-Real-IP set again",
    "local",
    (c) => void Object.assign(o(request(c, P).set), { "x-real-ip": ["{http.request.remote.host}"] }),
    "{$PDS_HOST}: a reverse_proxy passes X-Real-IP",
  ],
  [
    "X-Forwarded-Host not set",
    "dev",
    (c) => void delete o(request(c, P).set)["X-Forwarded-Host"],
    "{$PDS_HOST}: a reverse_proxy passes X-Forwarded-Host",
  ],
  [
    "X-Forwarded-Host from a header",
    "dev",
    (c) => void Object.assign(o(request(c, P).set), { "X-Forwarded-Host": ["{http.request.header.X-Forwarded-Host}"] }),
    "{$PDS_HOST}: a reverse_proxy passes X-Forwarded-Host",
  ],
  [
    "X-Forwarded-Host set twice",
    "dev",
    (c) => void Object.assign(o(request(c, P).set), { "x-forwarded-host": ["{http.request.host}"] }),
    "{$PDS_HOST}: a reverse_proxy passes X-Forwarded-Host",
  ],
  [
    "X-Forwarded-Host removed too",
    "dev",
    (c) => void a(request(c, P).delete).push("x-forwarded-host"),
    "{$PDS_HOST}: a reverse_proxy passes X-Forwarded-Host",
  ],
];

const DEV_SHAPE: Red[] = [
  ["no HSTS", "dev", (c) => void site(c, APP_DEV).splice(0, 1), "{$APP_HOST}: does not import security-headers"],
  [
    "a weaker HSTS",
    "dev",
    (c) => {
      const hsts = site(c, P)
        .map(o)
        .find((handler) => JSON.stringify(handler).includes("Strict-Transport-Security"));
      Object.assign(o(o(hsts?.response).set), { "Strict-Transport-Security": ["max-age=1"] });
    },
    "{$PDS_HOST}: does not import security-headers",
  ],
  [
    "indexable",
    "dev",
    (c) =>
      void site(c, P).splice(
        site(c, P).findIndex((handler) => JSON.stringify(handler).includes("X-Robots-Tag")),
        1,
      ),
    "{$PDS_HOST}: does not import noindex",
  ],
  [
    "the admin guard gone",
    "dev",
    (c) => void inner(c, P).splice(routeNamed(c, P, "xrpc_admin"), 1),
    "{$PDS_HOST}: does not import xrpc-guard",
  ],
  [
    "the admin guard after the upstream",
    "dev",
    (c) => void inner(c, P).push(...inner(c, P).splice(routeNamed(c, P, "xrpc_admin"), 1)),
    "{$PDS_HOST}: does not import xrpc-guard",
  ],
  [
    "blob routes open",
    "dev",
    (c) => void inner(c, P).splice(routeNamed(c, P, '"name":"blob"'), 1),
    "{$PDS_HOST}: does not import blob-deny",
  ],
  [
    "blob routes shut with another status",
    "dev",
    (c) => void Object.assign(o(inner(c, P)[routeNamed(c, P, '"name":"blob"')]), { handle: [respond(200)] }),
    "{$PDS_HOST}: does not import blob-deny",
  ],
  [
    "sign-in files writable",
    "dev",
    (c) => void inner(c, APP_DEV).splice(routeNamed(c, APP_DEV, "signin_files_write"), 1),
    "{$APP_HOST}: does not import signin-files",
  ],
];

/** The PDS route's deferred CSP append (pds-fonts), and the one replacement it makes. */
const fontAppend = (c: Json): Obj => o(o(a(o(inner(c, P).at(-1)).handle)[0]).response);
const fontReplace = (c: Json): Obj => o(a(o(fontAppend(c).replace)["Content-Security-Policy"])[0]);
const NOT_THE_FONTS = "{$PDS_HOST}: the route does not import pds-fonts once before its upstream";
/** A wider font policy, each from the reader's pds_fonts tests (P1.39e): the rule compares the append whole. */
const FONT_POLICY: Red[] = [
  [
    "a remote font-src",
    "local",
    (c) => void Object.assign(fontReplace(c), { replace: "$1; font-src https://fonts.example/" }),
    NOT_THE_FONTS,
  ],
  [
    "a data font-src",
    "local",
    (c) => void Object.assign(fontReplace(c), { replace: "$1; font-src data:" }),
    NOT_THE_FONTS,
  ],
  [
    "another directive appended to the CSP",
    "local",
    (c) => void Object.assign(fontReplace(c), { replace: "$1; style-src 'unsafe-inline'" }),
    NOT_THE_FONTS,
  ],
  [
    "a CSP append that also matches an empty policy",
    "local",
    (c) => void Object.assign(fontReplace(c), { search_regexp: "^(.*)$" }),
    NOT_THE_FONTS,
  ],
  [
    "the CSP append on every content type",
    "local",
    (c) => void Object.assign(fontAppend(c), { require: { headers: { "Content-Type": ["*"] } } }),
    NOT_THE_FONTS,
  ],
  ["the CSP append on every response", "local", (c) => void delete fontAppend(c).require, NOT_THE_FONTS],
  ["a CSP append that is not deferred", "local", (c) => void delete fontAppend(c).deferred, NOT_THE_FONTS],
  [
    "a wider font path",
    "local",
    (c) =>
      void Object.assign(o(inner(c, P)[routeNamed(c, P, "pds_font")]), {
        match: [{ path_regexp: { name: "pds_font", pattern: "^/_unset/fonts/.+$" } }],
      }),
    NOT_THE_FONTS,
  ],
];

const FONTS: Red[] = [
  [
    "no font files",
    "local",
    (c) => void inner(c, P).splice(routeNamed(c, P, "pds_font"), 1),
    "{$PDS_HOST}: the route does not import pds-fonts once before its upstream",
  ],
  [
    "the font files twice",
    "local",
    (c) => void inner(c, P).splice(1, 0, copy(inner(c, P)[routeNamed(c, P, "pds_font")] as Json)),
    "{$PDS_HOST}: the route does not import pds-fonts once before its upstream",
  ],
  [
    "the fonts after the upstream",
    "local",
    (c) => void inner(c, P).push(...inner(c, P).splice(routeNamed(c, P, "pds_font"), 2)),
    "{$PDS_HOST}: the route does not import pds-fonts once before its upstream",
  ],
  [
    "no font-src on the PDS pages",
    "local",
    (c) => void a(o(inner(c, P).at(-1)).handle).shift(),
    "{$PDS_HOST}: the route does not import pds-fonts once before its upstream",
  ],
  [
    "another font root",
    "local",
    (c) => void Object.assign(handlerIn(inner(c, P), "file_server"), { root: "/etc/caddy" }),
    "serves files outside pds-fonts",
  ],
  [
    "the fonts on the app site",
    "local",
    (c) => void inner(c, APP_LOCAL).unshift(copy(inner(c, P)[routeNamed(c, P, "pds_font")] as Json)),
    "{$APP_HOST}: imports pds-fonts",
  ],
  [
    "a file server elsewhere",
    "local",
    (c) => void inner(c, APP_LOCAL).push({ handle: [{ handler: "file_server", root: "/srv" }] }),
    "serves files outside pds-fonts",
  ],
  [
    "a response matcher elsewhere",
    "local",
    (c) =>
      void site(c, P).unshift({
        handler: "headers",
        response: { require: { status_code: [2] }, set: { "X-Test": ["1"] } },
      }),
    "a response matcher outside pds-fonts",
  ],
  [
    "a CSP set elsewhere",
    "local",
    (c) =>
      void site(c, APP_LOCAL).unshift({
        handler: "headers",
        response: { set: { "content-security-policy": ["default-src *"] } },
      }),
    "changes a Content-Security-Policy outside pds-fonts",
  ],
  [
    "a CSP removed",
    "dev",
    (c) => void site(c, P).unshift({ handler: "headers", response: { delete: ["Content-Security-Policy"] } }),
    "changes a Content-Security-Policy outside pds-fonts",
  ],
];

const header = (value: string): Json => ({ handler: "headers", response: { set: { "X-Test": [value] } } });
/**
 * Edits to the page body a later change could try, each refused (review of 214f9f1, B1 and B2): a placeholder Caddy
 * would fill at run time, in the words or the style, a tag or attribute outside the exact list, and anything the
 * style could load. Each is [what, the text replaced, its replacement, why].
 */
const PAGE_EDITS: readonly (readonly [string, string, string, string])[] = [
  ["a file placeholder", "Too many tries</h1>", "{file./data/caddy/x.key}</h1>", "holds a placeholder"],
  ["an env placeholder", "Too many tries</h1>", "{env.PDS_ADMIN_PASSWORD}</h1>", "holds a placeholder"],
  ["a request placeholder", "Too many tries</h1>", "{http.request.uri}</h1>", "holds a placeholder"],
  ["an escaped brace", "Too many tries</h1>", "\\{x\\}</h1>", "holds a placeholder"],
  ["a placeholder in the style", "a{color:var(--fg)}", "a{color:var(--fg)}{file./x}", "holds a placeholder"],
  ["a placeholder nested in the style", "a{color:var(--fg)}", "a{b{file./x}}", "holds a placeholder"],
  ["a placeholder as a style block", "a{color:var(--fg)}", "a{env.x:y}", "holds a placeholder"],
  ["a script", "</main>", "<script>alert(1)</script></main>", "holds a tag outside the ruled ones"],
  ["a handler", "<main>", '<main onclick="x()">', "holds a tag outside the ruled ones"],
  [
    "a refresh",
    "<title>",
    '<meta http-equiv="refresh" content="0;url=https://example.org/"><title>',
    "holds a tag outside the ruled ones",
  ],
  ["a base", "<title>", '<base href="https://example.org/"><title>', "holds a tag outside the ruled ones"],
  [
    "a stylesheet link",
    "<title>",
    '<link rel="stylesheet" href="/x.css"><title>',
    "holds a tag outside the ruled ones",
  ],
  ["a form", "</main>", '<form action="/x"><input name="q"></form></main>', "holds a tag outside the ruled ones"],
  ["a frame", "</main>", '<iframe src="/x"></iframe></main>', "holds a tag outside the ruled ones"],
  ["an object", "</main>", '<object data="/x"></object></main>', "holds a tag outside the ruled ones"],
  ["an svg", "</main>", '<svg onload="x()"></svg></main>', "holds a tag outside the ruled ones"],
  ["an image", "</main>", '<img src="/x.png"></main>', "holds a tag outside the ruled ones"],
  ["an outside link", 'href="/"', 'href="https://example.org/"', "holds a tag outside the ruled ones"],
  ["a data link", 'href="/"', 'href="data:text/html,x"', "holds a tag outside the ruled ones"],
  ["a script link", 'href="/"', 'href="javascript:x()"', "holds a tag outside the ruled ones"],
  ["a stray bracket", "Too many tries</h1>", "Too many tries ></h1>", "holds text outside the ruled characters"],
  ["an entity", "Too many tries</h1>", "Too many tries&lt;</h1>", "holds text outside the ruled characters"],
  ["a word outside ASCII", "Too many tries</h1>", "Too many tries…</h1>", "holds text outside the ruled characters"],
  ["a second style", "</head>", "<style>p{color:red}</style></head>", "does not hold exactly one style"],
  ["an image in the style", "body{margin:0;", "body{background:url(x.png);margin:0;", "loads or runs something"],
  [
    "an image set in the style",
    "body{margin:0;",
    "body{background:image-set(x 1x);margin:0;",
    "loads or runs something",
  ],
  [
    "an import in the style",
    ":root{",
    "@import url(x.css);:root{",
    "styles with something outside the ruled characters",
  ],
  [
    "a quoted font in the style",
    "font-family:system-ui",
    "font-family:'x'",
    "styles with something outside the ruled characters",
  ],
  [
    "an escape in the style",
    "a{color:var(--fg)}",
    "a{color:\\65}",
    "styles with something outside the ruled characters",
  ],
  ["a second document", "</html>", "</html>\n<html>", "is not one document"],
];

/** The too-many-tries page (snippets/too-many-tries.caddy): on every site, the ruled route, fixed text loading nothing. */
const TOO_MANY_TRIES: Red[] = [
  ...PAGE_EDITS.map(
    ([what, from, to, why]): Red => [
      `a page with ${what}`,
      "dev",
      (c) =>
        editPage(c, APP_DEV, (body) => {
          if (!body.includes(from)) throw new Error(`${what}: the page has no ${from}`);
          return body.replace(from, to);
        }),
      PAGE("APP_HOST", why),
    ],
  ),
  [
    "a site without the page",
    "local",
    (c) => void errorRoutes(c).splice(errorRoutes(c).indexOf(errorRoute(c, APP_LOCAL)), 1),
    NOT_THE_PAGE("APP_HOST"),
  ],
  [
    "an error route of its own",
    "shipped",
    (c) => void errorRoutes(c).push({ handle: [respond(200)], terminal: true }),
    "an error route other than the sites' own",
  ],
  [
    "an error handling key",
    "shipped",
    (c) => void Object.assign(o(publicServer(c).errors), { strict: true }),
    "the error handling holds a key the rules do not read",
  ],
  [
    "the page on every error",
    "dev",
    (c) => void delete o(a(errorRoute(c, APP_DEV).handle)[0]).routes,
    NOT_THE_PAGE("APP_HOST"),
  ],
  ["the page for a fetch", "dev", (c) => void delete pageRoutes(c, APP_DEV)[2]?.match, NOT_THE_PAGE("APP_HOST")],
  ["no 5xx route", "shipped", (c) => void a(o(a(errorRoute(c, P).handle)[0]).routes).pop(), NOT_THE_PAGE("PDS_HOST")],
  [
    "a 5xx answered with a body",
    "local",
    (c) => {
      const routes = a(o(a(errorRoute(c, APP_LOCAL).handle)[0]).routes);
      routes[1] = { ...o(routes[1]), handle: [{ handler: "static_response", status_code: 502, body: "x" }] };
    },
    NOT_THE_PAGE("APP_HOST"),
  ],
  [
    "the page as a 200",
    "shipped",
    (c) => void Object.assign(page(c, P), { status_code: 200 }),
    NOT_THE_PAGE("PDS_HOST"),
  ],
  [
    "the page without the security headers",
    "dev",
    (c) => void a(pageRoutes(c, P)[1]?.handle).shift(),
    NOT_THE_PAGE("PDS_HOST"),
  ],
  [
    "a page CSP that allows a script",
    "local",
    (c) => {
      const set = o(o(o(a(pageRoutes(c, APP_LOCAL)[1]?.handle).at(-1)).response).set);
      set["Content-Security-Policy"] = [`${String(a(set["Content-Security-Policy"])[0])}; script-src 'self'`];
    },
    NOT_THE_PAGE("APP_HOST"),
  ],
];

const STRAY: Red[] = [
  [
    "the PDS host in a header",
    "local",
    (c) => void site(c, APP_LOCAL).unshift(header(`https://${P}/`)),
    "{$PDS_HOST} is outside its position",
  ],
  [
    "the upstream in a header",
    "local",
    (c) => void site(c, P).unshift(header(PDS.PDS_UPSTREAM)),
    "{$PDS_UPSTREAM} is outside its position",
  ],
  [
    "the ACME email in a header",
    "shipped",
    (c) => void site(c, P).unshift(header("edge@example.org")),
    "{$ACME_EMAIL} is outside its position",
  ],
  [
    "a secret path in a header",
    "local",
    (c) => void site(c, P).unshift(header("/run/secrets/pds_admin_password")),
    "a secret path outside the certificate files",
  ],
  [
    "the dev leaf named under local",
    "local",
    (c) => void site(c, P).unshift(header("dev_tls_cert")),
    "the dev leaf outside dev",
  ],
  [
    "the local leaf named under prod",
    "shipped",
    (c) => void site(c, P).unshift(header("local_tls_key")),
    "the local leaf outside local",
  ],
];

const logging = (config: Json): Obj => o(o(o(config).logging).logs);
const routeClass = (config: Json): Obj[] => site(config, P).slice(0, 2).map(o);
// What the review of #1586 found passing: logs, the PDS guard outside dev, zone numbers, later header changes, other
// upstream headers, another map, and handler names that are object members.
const REVIEW: Red[] = [
  ["no logging block", "shipped", (c) => void delete o(c).logging, "the logs are not the ruled ones"],
  [
    "errors logged at debug",
    "local",
    (c) => void Object.assign(o(logging(c).default), { level: "DEBUG" }),
    "the logs are not the ruled ones",
  ],
  [
    "an access log that keeps the URI",
    "shipped",
    (c) => void delete o(o(o(logging(c).log0).encoder).fields)["request>uri"],
    "the logs are not the ruled ones",
  ],
  [
    "an unfiltered access log",
    "dev",
    (c) => void Object.assign(o(logging(c).log1), { encoder: { format: "json" } }),
    "the logs are not the ruled ones",
  ],
  [
    "a logger more",
    "shipped",
    (c) => void Object.assign(logging(c), { extra: { writer: { output: "stdout" } } }),
    "the logs are not the ruled ones",
  ],
  [
    "credentials logged",
    "shipped",
    (c) => void Object.assign(o(publicServer(c).logs), { should_log_credentials: true }),
    "the public server changes what it logs",
  ],
  [
    "a site logged by the default logger",
    "shipped",
    (c) => void Object.assign(o(o(publicServer(c).logs).logger_names), { [P]: ["default"] }),
    "a site's access log is not its own filtered logger",
  ],
  [
    "two sites in one access log",
    "local",
    (c) => void Object.assign(o(o(publicServer(c).logs).logger_names), { [P]: ["log0"], [APP_LOCAL]: ["log0"] }),
    "a site's access log is not its own filtered logger",
  ],
  [
    "the client address appended to the log",
    "shipped",
    (c) => void Object.assign(routeClass(c)[1] as Obj, { value: "{http.request.remote.host}" }),
    "{$PDS_HOST}: the route class is not the ruled one",
  ],
  [
    "a second log_append",
    "local",
    (c) => void site(c, P).push({ handler: "log_append", key: "auth", value: "{http.request.header.Authorization}" }),
    "{$PDS_HOST}: the route class is not the ruled one",
  ],
  [
    "another map",
    "dev",
    (c) => void Object.assign(routeClass(c)[0] as Obj, { source: "{http.request.header.Authorization}" }),
    "{$PDS_HOST}: the route class is not the ruled one",
  ],
  [
    "a map on the app site",
    "local",
    (c) => void site(c, APP_LOCAL).unshift(copy(routeClass(c)[0] as Json)),
    "{$APP_HOST}: the route class is not the ruled one",
  ],
  [
    "the admin guard gone under prod",
    "shipped",
    (c) => void inner(c, P).splice(routeNamed(c, P, "xrpc_admin"), 1),
    "{$PDS_HOST}: does not import xrpc-guard",
  ],
  [
    "the basic-auth guard gone under local",
    "local",
    (c) => void inner(c, P).splice(routeNamed(c, P, "xrpc_basic"), 1),
    "{$PDS_HOST}: does not import xrpc-guard",
  ],
  [
    "no security headers under prod",
    "shipped",
    (c) => void site(c, P).splice(2, 1),
    "{$PDS_HOST}: does not import security-headers",
  ],
  [
    "no security headers on the local app",
    "local",
    (c) => void site(c, APP_LOCAL).splice(0, 2),
    "{$APP_HOST}: does not import security-headers",
  ],
  [
    "a zone that never limits",
    "shipped",
    (c) => void Object.assign(o(zones(c, P).session), { max_events: 1_000_000 }),
    "{$PDS_HOST}: the zones are not the ruled ones",
  ],
  [
    "a longer window",
    "dev",
    (c) => void Object.assign(o(zones(c, APP_DEV).app_signin), { window: 1 }),
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  [
    "sign-up outside the sign-in zone",
    "dev",
    (c) => void Object.assign(o(a(o(zones(c, APP_DEV).app_signin).match)[0]), { path: ["/login", "/verify-email"] }),
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  ["a zone removed", "local", (c) => void delete zones(c, P).signup, "{$PDS_HOST}: the zones are not the ruled ones"],
  [
    "a narrower zone matcher",
    "local",
    (c) => void Object.assign(o(zones(c, APP_LOCAL).session), { match: [{ path: ["/nothing"] }] }),
    "{$APP_HOST}: the zones are not the ruled ones",
  ],
  [
    "metrics on",
    "shipped",
    (c) => void delete handlerIn(inner(c, P), "rate_limit").disable_metrics,
    "{$PDS_HOST}: the zones are not the ruled ones",
  ],
  [
    "HSTS deleted later",
    "shipped",
    (c) =>
      void a(o(inner(c, P).at(-1)).handle).unshift({
        handler: "headers",
        response: { deferred: true, delete: ["Strict-Transport-Security"] },
      }),
    "{$PDS_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "noindex deleted later",
    "dev",
    (c) => void site(c, APP_DEV).push({ handler: "headers", response: { delete: ["X-Robots-Tag"] } }),
    "{$APP_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "a wildcard CORS origin",
    "local",
    (c) =>
      void site(c, APP_LOCAL).push({
        handler: "headers",
        response: { set: { "Access-Control-Allow-Origin": ["*"] } },
      }),
    "{$APP_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "the font CSP append on the app site",
    "local",
    (c) => void site(c, APP_LOCAL).push(copy(a(o(inner(c, P).at(-1)).handle)[0] as Json)),
    "{$APP_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "an upstream sent a credential",
    "shipped",
    (c) => void Object.assign(o(request(c, P).set), { Authorization: ["Basic eDp5"] }),
    "{$PDS_HOST}: a reverse_proxy is not the ruled one",
  ],
  [
    "an upstream over another transport",
    "local",
    (c) => void Object.assign(o(proxy(c, APP_LOCAL).transport), { protocol: "fastcgi" }),
    "{$APP_HOST}: a reverse_proxy is not the ruled one",
  ],
  [
    "an upstream with no response timeout",
    "dev",
    (c) => void delete o(proxy(c, P).transport).response_header_timeout,
    "{$PDS_HOST}: a reverse_proxy is not the ruled one",
  ],
  [
    "the app host in a PDS zone matcher",
    "local",
    (c) => void Object.assign(o(a(o(zones(c, P).session).match)[0]), { host: [APP_LOCAL] }),
    "{$APP_HOST} is outside its position",
  ],
  [
    "the upstream named in an inner route's matcher",
    "shipped",
    (c) => void inner(c, P).splice(1, 0, { match: [{ host: [PDS.PDS_UPSTREAM] }], handle: [respond(404)] }),
    "{$PDS_UPSTREAM} is outside its position",
  ],
  [
    "the font CSP append twice",
    "shipped",
    (c) => void a(o(inner(c, P).at(-1)).handle).unshift(copy(a(o(inner(c, P).at(-1)).handle)[0] as Json)),
    "{$PDS_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "the site's headers after its route",
    "dev",
    (c) => void site(c, APP_DEV).push(...site(c, APP_DEV).splice(0, 3)),
    "{$APP_HOST}: a handler follows the route",
  ],
  [
    "a static response before the site's route",
    "shipped",
    (c) => void site(c, P).splice(2, 0, respond(503)),
    "{$PDS_HOST}: a handler outside the ruled snippets",
  ],
  [
    "a static-only route inside the route",
    "local",
    (c) => void inner(c, APP_LOCAL).unshift({ handle: [respond(200)] }),
    "{$APP_HOST}: a route outside the ruled snippets",
  ],
  [
    "a matched static route before the upstream",
    "dev",
    (c) => void inner(c, P).splice(1, 0, { match: [{ path: ["/xrpc/*"] }], handle: [respond(404)] }),
    "{$PDS_HOST}: a route outside the ruled snippets",
  ],
  [
    "an upstream behind a matcher",
    "local",
    (c) => void Object.assign(o(inner(c, P).at(-1)), { match: [{ path: ["/xrpc/*"] }] }),
    "{$PDS_HOST}: a route outside the ruled snippets",
  ],
  [
    "a zone named by the input",
    "local",
    (c) => void Object.assign(zones(c, P), { "pds.example.org": { key: "static", window: 1, max_events: 1 } }),
    "{$PDS_HOST}: a zone is not keyed on {client_ip}",
  ],
  [
    "a handler named constructor",
    "shipped",
    (c) => void site(c, P).push({ handler: "constructor" }),
    "a handler the rules do not read",
  ],
  [
    "a handler named __proto__",
    "shipped",
    (c) => void site(c, P).push({ handler: "__proto__" }),
    "a handler the rules do not read",
  ],
  [
    "a handler named toString",
    "local",
    (c) => void a(o(inner(c, P)[0]).handle).push({ handler: "toString" }),
    "a handler the rules do not read",
  ],
  [
    "an http app key",
    "shipped",
    (c) => void Object.assign(o(o(o(c).apps).http), { grace_period: 1 }),
    "the http app holds a key the rules do not read",
  ],
];

/** The docs site (P1.21w; ADR 0075): its headers, its one zone and its one file server, each whole. */
const DOCS = DEV_DOCS.DOCS_HOST;
/** The handlers of the docs site's one inner route: its zone, then its file server. */
const docsHandlers = (c: Json): Json[] => a(o(inner(c, DOCS)[0]).handle);
const DOCS_REDS: readonly Red[] = [
  [
    "a wider docs policy",
    "dev",
    (c) => {
      const csp = site(c, DOCS)
        .map(o)
        .find((each) => JSON.stringify(each).includes("script-src")) as Obj;
      o(o(csp.response).set)["Content-Security-Policy"] = ["default-src 'none'; script-src 'self' 'unsafe-inline'"];
    },
    "{$DOCS_HOST}: the site's headers are not the ruled ones",
  ],
  [
    "a docs site without noindex",
    "dev",
    (c) => void site(c, DOCS).splice(3, 1),
    "{$DOCS_HOST}: the site's headers are not the ruled ones",
  ],
  [
    "another docs root",
    "dev",
    (c) => void Object.assign(o(docsHandlers(c)[1]), { root: "/" }),
    "{$DOCS_HOST}: the files are not served from /srv/docs alone",
  ],
  [
    "a docs file server that lists folders",
    "dev",
    (c) => void Object.assign(o(docsHandlers(c)[1]), { browse: {} }),
    "{$DOCS_HOST}: the files are not served from /srv/docs alone",
  ],
  [
    "a docs zone that counts less",
    "dev",
    (c) => void Object.assign(o(o(o(docsHandlers(c)[0]).rate_limits).docs_global), { max_events: 30 }),
    "{$DOCS_HOST}: the zones are not the ruled ones",
  ],
  [
    "a docs site that skips its zone",
    "dev",
    (c) => void docsHandlers(c).shift(),
    "{$DOCS_HOST}: the zones are not the ruled ones",
  ],
  [
    "a docs site with an upstream",
    "dev",
    (c) => void docsHandlers(c).push(proxy(c, APP_DEV)),
    "{$DOCS_HOST}: the route is not the zone then the files",
  ],
  [
    "a second docs route",
    "dev",
    (c) => void inner(c, DOCS).push({ handle: [{ handler: "static_response", status_code: 200 }] }),
    "{$DOCS_HOST}: the route is not the zone then the files",
  ],
  [
    "the docs policy on the app site",
    "dev",
    (c) => void site(c, APP_DEV).unshift(copy(site(c, DOCS)[2] as Json)),
    "{$APP_HOST}: changes a response header outside the ruled snippets",
  ],
  [
    "the docs file server on the app site",
    "dev",
    (c) => void inner(c, APP_DEV).unshift({ handle: [copy(docsHandlers(c)[1] as Json)] }),
    "serves files outside pds-fonts",
  ],
  [
    "the docs host on a local edge",
    "local",
    (c) => void Object.assign(siteRoute(c, APP_LOCAL), { match: [{ host: ["docs.unset.sh"] }] }),
    "the public server holds a site other than the env's own",
  ],
];

/**
 * The chat site (P6.02; ADR 0081 decision 6, ADR 0088): its headers, its zones, the Matrix client API to Synapse and
 * the door's routes to the door, each whole, and the edge's own 404 for everything else.
 */
const CHAT = DEV_CHAT.CHAT_HOST;
const chatRoute = (c: Json, at: number): Obj => o(inner(c, CHAT)[at]);
const chatPattern = (c: Json, at: number): Obj =>
  o(o(o(a(chatRoute(c, at).match)[0]).vars_regexp)["{http.request.uri.path}"]);
/** The handlers of a chat upstream route's inner route: any request-header handler, then the upstream last. */
const chatInner = (c: Json, at: number): Json[] => a(o(a(o(a(chatRoute(c, at).handle)[0]).routes)[0]).handle);
const chatProxy = (c: Json, at: number): Obj => o(chatInner(c, at).at(-1));
/** The handlers the Matrix route runs before its upstream, in order. */
const matrixBefore = (c: Json): Obj[] => chatInner(c, 1).map(o).slice(0, -1);
const CHAT_REDS: readonly Red[] = [
  [
    "a chat Matrix route that forwards the browser's cookies",
    "dev-chat",
    (c) => void chatInner(c, 1).splice(0, chatInner(c, 1).length - 1),
    "{$CHAT_HOST}: the Matrix route is not the ruled one",
  ],
  [
    "a chat site that routes all of /_matrix/",
    "dev-chat",
    (c) => void Object.assign(chatPattern(c, 1), { pattern: "^/_matrix/" }),
    "{$CHAT_HOST}: the Matrix route is not the ruled one",
  ],
  [
    "a chat site that routes /_synapse/ to Synapse",
    "dev-chat",
    (c) => void Object.assign(chatPattern(c, 1), { pattern: "^/_(?:matrix/client|synapse)(?:/[^/]*[^/.][^/]*)+/?$" }),
    "{$CHAT_HOST}: the Matrix route is not the ruled one",
  ],
  [
    "a chat site that cleans the Matrix path before it matches",
    "dev-chat",
    (c) => void Object.assign(chatRoute(c, 1), { match: [{ path: ["/_matrix/client/*"] }] }),
    "{$CHAT_HOST}: the Matrix route is not the ruled one",
  ],
  [
    "a chat site that sends the door's paths to Synapse",
    "dev-chat",
    (c) => void Object.assign(chatProxy(c, 2), { upstreams: [{ dial: DEV_CHAT.MATRIX_UPSTREAM }] }),
    "{$CHAT_HOST}: the door route is not the ruled one",
  ],
  [
    "a chat site that opens the door's health route",
    "dev-chat",
    (c) =>
      void Object.assign(chatPattern(c, 2), {
        pattern: String(chatPattern(c, 2).pattern).replace("chat-id", "chat-id|health"),
      }),
    "{$CHAT_HOST}: the door route is not the ruled one",
  ],
  [
    "a chat upstream that passes the client address",
    "dev-chat",
    (c) => void delete o(o(chatProxy(c, 1).headers).request).delete,
    "{$CHAT_HOST}: the Matrix route is not the ruled one",
  ],
  [
    "a chat upstream that passes the client address header",
    "dev-chat",
    (c) => void a(o(o(chatProxy(c, 2).headers).request).delete).shift(),
    "{$CHAT_HOST}: the door route is not the ruled one",
  ],
  [
    "a chat site that sends everything else to the door",
    "dev-chat",
    (c) => void inner(c, CHAT).splice(3, 1, { handle: [copy(chatProxy(c, 2))] }),
    "{$CHAT_HOST}: the route is not the zones, the Matrix route, the door route, then 404",
  ],
  [
    "a chat site with a fifth route",
    "dev-chat",
    (c) => void inner(c, CHAT).splice(3, 0, { handle: [respond(200)] }),
    "{$CHAT_HOST}: the route is not the zones, the Matrix route, the door route, then 404",
  ],
  [
    "a chat site that skips its zones",
    "dev-chat",
    (c) => void inner(c, CHAT).shift(),
    "{$CHAT_HOST}: the zones are not the ruled ones",
  ],
  [
    "a chat zone that counts less",
    "dev-chat",
    (c) => void Object.assign(o(zones(c, CHAT).chat_global), { max_events: 30 }),
    "{$CHAT_HOST}: the zones are not the ruled ones",
  ],
  [
    "a chat site without the default policy",
    "dev-chat",
    (c) => void site(c, CHAT).splice(2, 1),
    "{$CHAT_HOST}: the site's headers are not the ruled ones",
  ],
  [
    "a chat site without noindex",
    "dev-chat",
    (c) => void site(c, CHAT).splice(3, 1),
    "{$CHAT_HOST}: the site's headers are not the ruled ones",
  ],
  [
    "a chat site that sets its own policy over the door's",
    "dev-chat",
    (c) =>
      void Object.assign(o(site(c, CHAT)[2]), { response: { set: { "Content-Security-Policy": ["default-src *"] } } }),
    "{$CHAT_HOST}: the site's headers are not the ruled ones",
  ],
  [
    "the chat default policy on the app site",
    "dev-chat",
    (c) => void site(c, APP_DEV).unshift(copy(site(c, CHAT)[2] as Json)),
    "changes a Content-Security-Policy outside pds-fonts",
  ],
  [
    "the chat host on a local edge",
    "local",
    (c) => void Object.assign(siteRoute(c, APP_LOCAL), { match: [{ host: [DEV_CHAT.CHAT_HOST] }] }),
    "the public server holds a site other than the env's own",
  ],
];

const REDS: readonly Red[] = [
  ...REVIEW,
  ...SHAPE,
  ...SERVERS,
  ...CERTIFICATES,
  ...SITES,
  ...UPSTREAMS,
  ...DEV_SHAPE,
  ...FONTS,
  ...TOO_MANY_TRIES,
  ...STRAY,
  ...DOCS_REDS,
  ...CHAT_REDS,
];
const changed = ([, mode, change]: Red): string[] => {
  const config = adapted(mode);
  change(config);
  return adaptedProblems(config, modeOf(mode), ENVS[mode]);
};

describe("edge rules on the adapted config (P1.39b)", () => {
  test("rules_pass_each_reviewed_config", () => {
    for (const mode of CASES) {
      expect(adaptedProblems(adapted(mode), modeOf(mode), ENVS[mode]), mode).toEqual([]);
    }
  });

  test("too_many_tries_page_says_wait_and_names_no_limit", () => {
    // The page's words (Alex 2026-11-19, "yes good idea with adding a page"): wait, a way home, and no number, so it
    // tells nobody a zone's size or window. The same page on every site of every env, so the words fit every zone:
    // app_burst frees in seconds (P1.20o: a member pressing Settings and Profile fast met it), app_signin in minutes.
    const bodies = CASES.flatMap((mode) =>
      errorRoutes(adapted(mode)).map((route) =>
        String(page(adapted(mode), String(a(o(a(o(route).match)[0]).host)[0])).body),
      ),
    );
    // One site under prod, two under local, three under dev (the docs site, P1.21w), four with the chat site (P6.02).
    expect(bodies.length).toBe(10);
    expect(new Set(bodies).size).toBe(1);
    const words = String(bodies[0])
      .replace(/<style>[^<]*<\/style>/, "")
      .replace(/<[^>]*>/g, " ");
    expect(words).toContain("Wait a moment, then try again.");
    expect(words).toContain("If this page comes back, wait a few minutes.");
    expect(words).not.toContain("Wait a few minutes, then try again.");
    expect(words).toContain("Go to the home page");
    expect(words).not.toMatch(/[0-9]/);
  });

  test("too_many_tries_csp_allows_exactly_the_page_style", () => {
    // The rules judge the CSP's shape; here its hash is the SHA-256 of the reviewed page's one style (CSP Level 3,
    // "hash-source"), so the browser applies that style and nothing else, on every site of every env.
    for (const mode of CASES) {
      const config = adapted(mode);
      for (const route of errorRoutes(config)) {
        const host = String(a(o(a(o(route).match)[0]).host)[0]);
        const body = String(page(config, host).body);
        const set = o(o(o(a(pageRoutes(config, host)[1]?.handle).at(-1)).response).set);
        const hash = PAGE_CSP.exec(String(a(set["Content-Security-Policy"])[0]))?.[1];
        const style = /<style>([^<]*)<\/style>/.exec(body)?.[1] ?? "";
        expect(hash, `${mode} ${host}`).toBe(createHash("sha256").update(style).digest("base64"));
      }
    }
  });

  test("rules_pass_whatever_order_caddy_gives_the_two_sites", () => {
    for (const mode of ["local", "dev", "dev-chat"] as const) {
      const config = adapted(mode);
      a(publicServer(config).routes).reverse();
      a(o(o(a(publicServer(config).tls_connection_policies)[0]).match).sni).reverse();
      expect(adaptedProblems(config, modeOf(mode), ENVS[mode]), mode).toEqual([]);
    }
  });

  test("rules_fail_a_config_of_another_env", () => {
    expect(adaptedProblems(adapted("local"), "shipped", ENVS.shipped)).not.toEqual([]);
    expect(adaptedProblems(adapted("shipped"), "local", ENVS.local)).not.toEqual([]);
    expect(adaptedProblems(adapted("local"), "dev", ENVS.local)).not.toEqual([]);
    expect(adaptedProblems(adapted("dev"), "local", ENVS.dev)).not.toEqual([]);
    // The chat site without its values in the env (P6.02): a site other than the env's own.
    expect(adaptedProblems(adapted("dev-chat"), "dev", ENVS.dev)).toContain(
      "the public server holds a site other than the env's own",
    );
  });

  test("rules_fail_values_that_do_not_fit", () => {
    const fails = (mode: EdgeMode, env: AdaptedEnv, reason: string) =>
      expect(adaptedProblems(adapted(mode), mode, env), reason).toContain(reason);
    fails("shipped", { ...PDS }, "{$ACME_EMAIL} is not set");
    fails("shipped", { ...ENVS.shipped, PDS_HOST: "pds.example.org/x" }, "{$PDS_HOST} is not set");
    fails("shipped", { ...ENVS.shipped, PDS_HOST: "PDS.example.org" }, "{$PDS_HOST} is not lower case");
    fails("shipped", { ...ENVS.shipped, PDS_UPSTREAM: "http://pds:3000" }, "{$PDS_UPSTREAM} is not set");
    fails("local", { ...PDS }, "{$APP_HOST} is not set");
    fails("local", { ...ENVS.local, APP_HOST: PDS.PDS_HOST }, "{$APP_HOST} equals {$PDS_HOST}");
    fails("local", { ...ENVS.local, APP_UPSTREAM: PDS.PDS_UPSTREAM }, "{$APP_UPSTREAM} equals {$PDS_UPSTREAM}");
    fails("dev", { ...ENVS.dev, APP_HOST: "app.example.org" }, "{$APP_HOST} is not the dev app site's ruled value");
    fails("dev", { ...ENVS.dev, APP_UPSTREAM: "web:8081" }, "{$APP_UPSTREAM} is not the dev app site's ruled value");
    const chat = ENVS["dev-chat"];
    fails("dev", { ...chat, CHAT_HOST: "chat.example.org" }, "{$CHAT_HOST} is not the dev chat site's ruled value");
    fails(
      "dev",
      { ...chat, CHAT_UPSTREAM: "chat-auth:8090" },
      "{$CHAT_UPSTREAM} is not the dev chat site's ruled value",
    );
    fails(
      "dev",
      { ...chat, MATRIX_UPSTREAM: "synapse:8008" },
      "{$MATRIX_UPSTREAM} is not the dev chat site's ruled value",
    );
    fails(
      "dev",
      { ...ENVS.dev, CHAT_UPSTREAM: DEV_CHAT.CHAT_UPSTREAM },
      "{$CHAT_HOST} and its two upstreams are not set together",
    );
    fails("local", { ...ENVS.local, ...DEV_CHAT }, "{$CHAT_HOST} is set outside dev");
    // The chat site's values with the plain dev config: the env names a site the config does not hold.
    fails("dev", chat, "{$CHAT_HOST}: no site");
    // The sentinels the reviewed files hold are no dev app values either.
    fails("dev", { ...ENVS.dev, APP_HOST: SENTINELS.APP_HOST }, "{$APP_HOST} is not the dev app site's ruled value");
  });

  test("rules_fail_what_is_not_a_config", () => {
    for (const config of [null, [], "text", {}, { apps: { http: { servers: [] } } }] as Json[]) {
      expect(adaptedProblems(config, "shipped", ENVS.shipped), JSON.stringify(config)).not.toEqual([]);
    }
  });

  test.each(REDS.map((red) => [red[0], red] as const))("rules_fail_%s", (_what, red) => {
    expect(changed(red)).toContain(red[3]);
  });

  test("rules_fail_a_wider_font_policy", () => {
    // P2.24e, as the reader's pds_fonts_wider_policy_fails and pds_fonts_html_only_and_deferred held it: any other
    // font-src, an appended directive, a looser search, another content type, a missing condition, an append that is
    // not deferred and a wider file path each fail.
    for (const red of FONT_POLICY) expect(changed(red), red[0]).toContain(red[3]);
  });

  test("rules_fail_a_wider_docs_policy", () => {
    // P1.21w (ADR 0075): the docs site's CSP is exactly the ruled one, so inline script or style, eval, another
    // origin, a framing parent or a dropped directive each fail.
    const wider = [
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'wasm-unsafe-eval'",
      "https:",
      "blob:",
      "'strict-dynamic'",
    ].flatMap((token) => [
      DOCS_CSP.replace("script-src 'self'", `script-src 'self' ${token}`),
      DOCS_CSP.replace("style-src 'self'", `style-src 'self' ${token}`),
    ]);
    const policies = [
      ...wider,
      DOCS_CSP.replace("frame-ancestors 'none'", "frame-ancestors *"),
      DOCS_CSP.replace("; base-uri 'none'", ""),
      DOCS_CSP.replace("default-src 'none'", "default-src 'self'"),
      `${DOCS_CSP}; worker-src blob:`,
    ];
    for (const policy of policies) {
      const config = adapted("dev");
      const csp = site(config, DOCS)
        .map(o)
        .find((each) => JSON.stringify(each).includes("script-src")) as Obj;
      o(o(csp.response).set)["Content-Security-Policy"] = [policy];
      expect(adaptedProblems(config, "dev", ENVS.dev), policy).toContain(
        "{$DOCS_HOST}: the site's headers are not the ruled ones",
      );
    }
  });

  test("chat_matrix_route_strips_cookies_before_synapse", () => {
    // Review finding N3 (#1943): the page sends its Matrix calls with same-origin credentials so they carry Pangolin's
    // login (ADR 0094 decision 6), which also sends the door's Path=/ cookies (interfaces/chat-auth/cookies.ts:21).
    // Pangolin checks its own cookie before the edge, so the Matrix route removes Cookie before Synapse; the door's
    // route keeps it.
    const config = adapted("dev-chat");
    expect(matrixBefore(config)).toEqual([{ handler: "headers", request: { delete: ["Cookie"] } }]);
    expect(JSON.stringify(chatRoute(config, 2))).not.toContain('"Cookie"');
  });

  test("chat_signin_counts_each_sign_in_and_sign_out_redeem", () => {
    // The door's two ticket redeems (ADR 0083 decisions 2 and 5) share the sign-in zone: GET /sign-in starts the hop,
    // POST /sign-in/redeem and POST /sign-out/redeem spend a ticket. A path under them is not the door's and 404s.
    const zone = o(o(o(a(chatRoute(adapted("dev-chat"), 0).handle)[0]).rate_limits).chat_signin);
    expect(a(zone.match).map((m) => o(m).path)).toEqual([["/sign-in", "/sign-in/redeem", "/sign-out/redeem"]]);
  });

  test("chat_paths_reach_only_the_ruled_upstream", () => {
    // P6.02 (ADR 0081 decision 6, ADR 0088): each pattern is judged on the decoded path before Caddy cleans it, so a
    // dot segment or an empty segment never names a path under /_matrix/client/ that Synapse would read as another.
    // Both are RE2 in Caddy and plain here; neither uses a feature where the two differ.
    const matrix = new RegExp(CHAT_MATRIX_PATH);
    const door = new RegExp(CHAT_DOOR_PATH);
    const toSynapse = [
      "/_matrix/client/versions",
      "/_matrix/client/v3/sync",
      "/_matrix/client/v3/rooms/!r:staging.unset.cc/send/m.room.encrypted/t1",
      "/_matrix/client/v3/rooms/!r:staging.unset.cc/state/m.room.encryption/",
      "/_matrix/client/v1/media/download/staging.unset.cc/abc",
      "/_matrix/client/v3/keys/query",
    ];
    const toDoor = [
      "/",
      "/sign-in",
      "/sign-in/return",
      "/sign-in/redeem",
      "/sign-out",
      "/sign-out/return",
      "/sign-out/redeem",
      "/sign-out/done",
      "/welcome",
      "/welcome/done",
      "/setup/claim",
      "/setup/release",
      "/push/key",
      "/chat-id",
      "/assets/index-AbC_12.js",
      "/assets/matrix_sdk_crypto_wasm_bg-Xy9.wasm",
      "/dm/did:plc:abcdefghijklmnopqrstuvwx",
      "/dm/did:web:example.com:8080",
    ];
    const nowhere = [
      "/health",
      "/_synapse/admin/v1/users",
      "/_synapse/client/new_user_consent",
      "/_synapse/mas/is_localpart_available",
      "/_matrix/federation/v1/version",
      "/_matrix/key/v2/server",
      "/_matrix/media/v3/download/staging.unset.cc/abc",
      "/_matrix/client",
      "/_matrix/client/",
      "/_matrix/client/../../_synapse/admin/v1/users",
      "/_matrix/client/v3/../../../_synapse/admin",
      "/_matrix/client/./v3/sync",
      "/_matrix/client//v3/sync",
      "/.well-known/matrix/client",
      "/.well-known/matrix/server",
      "/sign-in/",
      "/sign-in/other",
      "/sign-out/",
      "/sign-out/other",
      "/welcome/",
      "/welcome/other",
      "/assets/",
      "/assets/../sign-out",
      "/assets/a/b.js",
      "/dm/",
      "/dm/did:plc:a/../../sign-out",
      "/SIGN-IN",
      "/oauth/callback",
    ];
    for (const path of toSynapse) expect([matrix.test(path), door.test(path)], path).toEqual([true, false]);
    for (const path of toDoor) expect([matrix.test(path), door.test(path)], path).toEqual([false, true]);
    for (const path of nowhere) expect([matrix.test(path), door.test(path)], path).toEqual([false, false]);
  });

  test("rules_reds_are_named_once", () => {
    const names = REDS.map(([what]) => what);
    expect(new Set(names).size).toBe(names.length);
  });

  test("rules_messages_carry_no_configured_value", () => {
    for (const red of REDS) {
      const env = ENVS[red[1]];
      for (const reason of changed(red)) {
        for (const value of Object.values(env)) expect(reason.includes(value), `${red[0]}: ${reason}`).toBe(false);
      }
    }
  });
});
