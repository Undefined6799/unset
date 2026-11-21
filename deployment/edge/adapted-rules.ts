// The edge's rules, judged on Caddy's own output (P1.39b; ADR 0046 decision 3): `caddy adapt --adapter caddyfile`
// turns the Caddyfile, its snippets and the enabled sites into the JSON config Caddy runs
// (caddyserver.com/docs/command-line, "caddy adapt"; Caddy v2.11.7 caddyconfig/httpcaddyfile/httptype.go Setup), and
// `adaptedProblems` says why that JSON breaks a rule: why some request could reach an upstream uncounted or carrying
// a client address, why a certificate, a trusted proxy, a served file or a CSP is not the ruled one, and where a
// configured value sits outside its position. Every module, matcher and key it does not name fails.
//
// It is pure: it takes parsed JSON, reads no file and runs no process. A message names a placeholder, never its value
// (P1.28l). Each rule restates one of the hand-written Caddyfile reader's, which P1.39e deleted (edgeSiteProblems,
// and the preflight's certificateProblems); ADR 0046's table maps them.
//
// The value shapes and the dev stack's ruled addresses are written here, their only copy since P1.39e.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

/** The env a config was adapted for: the shipped image's own files, the local stack's, or the dev stack's. */
export type EdgeMode = "shipped" | "local" | "dev";

const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UPSTREAM_SHAPE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?:\d{1,5}$/;
/** The one shape each `{$NAME}` value may have (P1.28e, P1.34a). */
export const ENV_NAMES = {
  PDS_HOST: HOST,
  PDS_UPSTREAM: UPSTREAM_SHAPE,
  ACME_EMAIL: /^[A-Za-z0-9._%+-]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/,
  APP_HOST: HOST,
  APP_UPSTREAM: UPSTREAM_SHAPE,
  DOCS_HOST: HOST,
  CHAT_HOST: HOST,
  CHAT_UPSTREAM: UPSTREAM_SHAPE,
  MATRIX_UPSTREAM: UPSTREAM_SHAPE,
} as const;
export type EnvName = keyof typeof ENV_NAMES;
/** The values a config was adapted with; a name the env does not set is absent. */
export type AdaptedEnv = Readonly<Partial<Record<EnvName, string>>>;

/** The dev leaf and its key as the dev stack mounts them (ADR 0032). */
export const DEV_TLS = ["/run/secrets/dev_tls_cert", "/run/secrets/dev_tls_key"] as const;
/** The local leaf and its key as the local stack mounts them (P1.34b). */
export const LOCAL_TLS = ["/run/secrets/local_tls_cert", "/run/secrets/local_tls_key"] as const;
/** The dev stack's app site, exactly (P1.36b; ADR 0025). */
export const DEV_APP = { APP_HOST: "staging.unset.sh", APP_UPSTREAM: "web:8080" } as const;
/** The dev stack's docs site, exactly (P1.21w; ADR 0075): files from DOCS_ROOT, no upstream. */
export const DEV_DOCS = { DOCS_HOST: "docs.unset.sh" } as const;
/**
 * The dev stack's chat site, exactly (P6.02; ADR 0025's chat name; ADR 0081 decision 6): the door's public listener
 * on chat_edge and Synapse's client listener on chat_edge_synapse, each the fixed address compose.dev.yaml gives it.
 */
export const DEV_CHAT = {
  CHAT_HOST: "staging.unset.cc",
  CHAT_UPSTREAM: "10.250.38.43:8090",
  MATRIX_UPSTREAM: "10.250.38.51:8008",
} as const;
/**
 * The chat site's two upstream paths (dev/chat.caddy), each matched on the decoded path before Caddy cleans it. The
 * Matrix client API: one or more segments under /_matrix/client, none empty and none only dots, and an optional
 * trailing slash (an empty state key). The door's routes: exactly those interfaces/chat-auth serves but /health.
 */
export const CHAT_MATRIX_PATH = String.raw`^/_matrix/client(?:/[^/]*[^/.][^/]*)+/?$`;
export const CHAT_DOOR_PATH = String.raw`^/(?:sign-in(?:/return|/redeem)?|sign-out|setup/(?:claim|release)|push/key|chat-id|assets/[\w-][\w.-]*|dm/did:[a-z0-9]+:[\w.:-]+)?$`;
/** Where the dev edge reads the built docs (compose.dev.yaml's one folder bind). */
export const DOCS_ROOT = "/srv/docs";
/** Newt's address on newt_edge, the dev edge's one trusted proxy (P1.36j; compose.dev.yaml, P1.37v). */
export const DEV_PROXY_ADDRESS = "10.250.37.2";
/** The edge's own address on newt_edge, the only listener of the dev sites (ADR 0030 Decision 2). */
export const DEV_LISTENER = "10.250.37.3:443";

const obj = (value: Json | undefined): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const arr = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);
/** JSON text with every object's keys in byte order, so two values compare whatever order their keys were written in. */
const canonical = (value: Json | undefined): string =>
  JSON.stringify(value, (_key, each: Json) =>
    typeof each === "object" && each !== null && !Array.isArray(each)
      ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : each,
  ) ?? "undefined";
const same = (a: Json | undefined, b: Json | undefined): boolean => canonical(a) === canonical(b);

/** The modules, matchers and keys our config adapts to; anything else fails (the reader's DIRECTIVES, as Caddy names them). */
const HANDLER_KEYS: Readonly<Record<string, readonly string[]>> = {
  subroute: ["routes"],
  headers: ["response"],
  rate_limit: ["rate_limits", "disable_metrics"],
  static_response: ["status_code", "close"],
  reverse_proxy: ["headers", "transport", "upstreams"],
  file_server: ["hide", "root"],
  map: ["source", "destinations", "mappings", "defaults"],
  log_append: ["key", "value"],
};
const MATCHERS = ["host", "path", "method", "not", "path_regexp", "header", "header_regexp", "vars_regexp"];
const ZONE_KEYS = ["key", "window", "max_events", "match", "ipv6_prefix"];
const SERVER_KEYS = [
  "listen",
  "routes",
  "read_timeout",
  "read_header_timeout",
  "write_timeout",
  "idle_timeout",
  "logs",
  "tls_connection_policies",
  "trusted_proxies",
  "trusted_proxies_strict",
  "client_ip_headers",
  "automatic_https",
  "errors",
];
const TRUST_KEYS = ["trusted_proxies", "trusted_proxies_strict", "client_ip_headers"];

/** The image's health site as Caddy adapts it: plain HTTP on loopback, the one server with no upstream and no zone. */
const HEALTH_SERVER: Json = {
  listen: ["127.0.0.1:8081"],
  read_timeout: 120_000_000_000,
  read_header_timeout: 10_000_000_000,
  write_timeout: 255_000_000_000,
  idle_timeout: 120_000_000_000,
  routes: [
    {
      match: [{ host: ["127.0.0.1"] }],
      handle: [
        {
          handler: "subroute",
          routes: [
            { match: [{ path: ["/health"] }], handle: [{ handler: "static_response", status_code: 200 }] },
            { handle: [{ handler: "static_response", status_code: 404 }] },
          ],
        },
      ],
      terminal: true,
    },
  ],
  automatic_https: { skip: ["127.0.0.1"] },
};
const TIMEOUTS = ["read_timeout", "read_header_timeout", "write_timeout", "idle_timeout"];

/** The client address headers the edge removes before every upstream (ADR 0018). */
const ADDRESS_HEADERS = ["X-Forwarded-For", "X-Real-IP", "Forwarded"];
const CLIENT_KEY = "{http.vars.client_ip}";
/**
 * Web's mark on its own calls to our PDS (P1.21j; Proposed ADR 0071): the header matches the fixed ends around hex and
 * equals the key file's content between them, so a missing file (`key--key`) or a `*` can never match. The header is
 * deleted before the upstream.
 */
const WEB_KEY_HEADER = "X-Unset-Web-Key";
const WEB_MARK: Json = {
  header: { [WEB_KEY_HEADER]: ["key-{file./run/secrets/pds_web_key}-key"] },
  header_regexp: { [WEB_KEY_HEADER]: { pattern: "^key-[0-9a-f]+-key$" } },
};
/** The zones a marked call counts in instead of `global` and `oauth_token`: one bucket for all of web. */
const WEB_KEY = "web";
const WEB_ZONES = ["web_global", "web_oauth_token"];

// What each snippet adapts to, compared whole. (security-headers) and (noindex) are site handlers; the others are
// routes inside the site's `route`.
const SECURITY_HEADERS: Json[] = [
  {
    handler: "headers",
    response: {
      deferred: true,
      delete: ["Server", "Via"],
      set: {
        "Strict-Transport-Security": ["max-age=63072000; includeSubDomains"],
        "X-Content-Type-Options": ["nosniff"],
      },
    },
  },
  {
    handler: "headers",
    response: { require: { headers: { "Referrer-Policy": null } }, set: { "Referrer-Policy": ["no-referrer"] } },
  },
];
/**
 * The docs site's policy (dev/docs.caddy; ADR 0075): scripts, styles, the search index and the manifest from its own
 * origin, images from it or data:, and nothing inline or evaluated.
 */
export const DOCS_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const DOCS_HEADERS: Json = { handler: "headers", response: { set: { "Content-Security-Policy": [DOCS_CSP] } } };
const NOINDEX: Json = { handler: "headers", response: { set: { "X-Robots-Tag": ["noindex, nofollow"] } } };
const XRPC = "^/xrpc/(?:_health|[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z0-9-]+)+)(?:\\?[^#]*)?$";
const XRPC_GUARD: Json[] = [
  {
    match: [
      {
        not: [{ vars_regexp: { "{http.request.orig_uri}": { pattern: XRPC } } }],
        path_regexp: { name: "xrpc_malformed", pattern: "(?i)xrpc" },
      },
    ],
    handle: [{ handler: "static_response", status_code: 400, close: true }],
  },
  {
    match: [
      {
        vars_regexp: {
          "{http.request.orig_uri}": {
            name: "xrpc_admin",
            pattern:
              "(?i)^/xrpc/(?:com\\.atproto\\.admin\\.|com\\.atproto\\.temp\\.|tools\\.ozone\\.|com\\.atproto\\.server\\.createinvitecodes?(?:\\?|$))",
          },
        },
      },
    ],
    handle: [{ handler: "static_response", status_code: 404 }],
  },
  {
    match: [
      {
        header_regexp: { Authorization: { name: "xrpc_basic", pattern: "(?i)^\\s*basic\\b" } },
        path_regexp: { name: "xrpc_basic", pattern: "(?i)xrpc" },
      },
    ],
    handle: [{ handler: "static_response", status_code: 401 }],
  },
];
const BLOB_DENY: Json = {
  match: [
    {
      path_regexp: {
        name: "blob",
        pattern: "(?i)^/+xrpc/+com\\.atproto\\.(?:repo\\.uploadblob|sync\\.getblob|repo\\.importrepo)/*$",
      },
    },
  ],
  handle: [{ handler: "static_response", status_code: 404 }],
};
const SIGNIN_ALLOW: Json = { handler: "headers", response: { set: { Allow: ["GET, HEAD"] } } };
const SIGNIN_FILES: Json = {
  match: [
    {
      not: [{ method: ["GET", "HEAD"] }],
      path_regexp: {
        name: "signin_files_write",
        pattern: "(?i)^/+(?:oauth-client-metadata\\.json|oauth/+jwks\\.json)/*$",
      },
    },
  ],
  handle: [SIGNIN_ALLOW, { handler: "static_response", status_code: 405 }],
};
/** (route-class) as adapted: the class of route an access log line names in place of its URI, first on the PDS site. */
const ROUTE_CLASS: Json[] = [
  {
    handler: "map",
    source: "{http.request.orig_uri}",
    destinations: ["{route_class}"],
    mappings: [
      {
        input_regexp: "^/xrpc/(_health|[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z0-9-]+)+)(?:\\?[^#]*)?$",
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Caddy's capture placeholder, as adapted.
        outputs: ["xrpc:${1}"],
      },
      { input_regexp: "^/oauth/", outputs: ["oauth"] },
      { input_regexp: "^/\\.well-known/", outputs: ["well-known"] },
      { input_regexp: "^/health(?:\\?[^#]*)?$", outputs: ["health"] },
    ],
    defaults: ["other"],
  },
  { handler: "log_append", key: "route_class", value: "{route_class}" },
];
/**
 * (pds-fonts) as adapted (P2.24e): woff2 files by one plain name from the image's /etc/caddy/static, anything else
 * under /_unset/ a 404, and one deferred CSP append on HTML responses naming the exact origin and path. The file
 * server's `hide` is Caddy's own list of the config files it read, which no rule reads.
 */
const FONT_FILE_MATCH: Json = [{ path_regexp: { name: "pds_font", pattern: "^/_unset/fonts/[A-Za-z0-9-]+\\.woff2$" } }];
const FONT_TYPE: Json = { handler: "headers", response: { set: { "Content-Type": ["font/woff2"] } } };
const FONT_ROOT = "/etc/caddy/static";
const FONT_404: Json = { match: [{ path: ["/_unset/*"] }], handle: [{ handler: "static_response", status_code: 404 }] };
const cspAppend = (host: string): Json => ({
  handler: "headers",
  response: {
    deferred: true,
    replace: {
      "Content-Security-Policy": [{ replace: `$1; font-src https://${host}/_unset/fonts/`, search_regexp: "^(.+)$" }],
    },
    require: { headers: { "Content-Type": ["text/html*"] } },
  },
});
/**
 * (too-many-tries) as adapted for one site (snippets/too-many-tries.caddy): on a 429 from a zone, the security headers,
 * the page's CSP and no-store on every response, and the page itself, still a 429, only for a browser navigation; a
 * fetch or a stream gets Caddy's empty 429. `body` is the page, which pageProblems judges, and `csp` its policy:
 * nothing but one style by its SHA-256 hash, so the page can load nothing else. A 5xx is raised again (LOG_5XX). The rules import nothing (no
 * dependency-cruiser row for the edge), so adapted-rules.test.ts proves the hash is the reviewed style's.
 */
const NAVIGATE: Json = [{ header: { "Sec-Fetch-Mode": ["navigate"] } }];
/**
 * The second route: a 5xx fails again, so Caddy still logs the edge's own 5xx at ERROR and sends the first error's
 * status with no body, as before the error routes existed (Caddy v2.11.9 server.go:747-776).
 */
const LOG_5XX: Json = {
  handle: [
    { handler: "subroute", routes: [{ handle: [{ handler: "error", error: "edge error", status_code: 500 }] }] },
  ],
  match: [{ expression: "{http.error.status_code} >= 500 && {http.error.status_code} <= 599" }],
};
export const PAGE_CSP =
  /^default-src 'none'; style-src 'sha256-([A-Za-z0-9+/]{43}=)'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'$/;
const tooManyTries = (host: string, body: string, csp: string): Json => ({
  match: [{ host: [host] }],
  handle: [
    {
      handler: "subroute",
      routes: [
        {
          handle: [
            {
              handler: "subroute",
              routes: [
                {
                  handle: [{ handler: "headers", response: { set: { "Content-Type": ["text/html; charset=utf-8"] } } }],
                  match: NAVIGATE,
                },
                {
                  handle: [
                    ...SECURITY_HEADERS,
                    {
                      handler: "headers",
                      response: {
                        set: { "Cache-Control": ["no-store"], "Content-Security-Policy": [csp] },
                      },
                    },
                  ],
                },
                { handle: [{ handler: "static_response", status_code: 429, body }], match: NAVIGATE },
              ],
            },
          ],
          match: [{ expression: "{http.error.status_code} in [429]" }],
        },
        LOG_5XX,
      ],
    },
  ],
  terminal: true,
});
/**
 * The page's tags, each written exactly so, attributes included: a document, its charset and viewport, a title, a
 * heading, text and the one link home. <style> and </style> are judged on their own, once each.
 */
const PAGE_TAGS = [
  "<!doctype html>",
  '<html lang="en">',
  "</html>",
  "<head>",
  "</head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>",
  "</title>",
  "<body>",
  "</body>",
  "<main>",
  "</main>",
  "<h1>",
  "</h1>",
  "<p>",
  "</p>",
  '<a href="/">',
  "</a>",
];
/** The page's words: letters, digits, spaces and plain punctuation; no brace, entity, backslash or angle bracket. */
const PAGE_TEXT = /^[A-Za-z0-9 .,'!?\n-]*$/;
/** The style's characters: lower-case CSS with no quote, slash, backslash, at-rule or escape. */
const STYLE_TEXT = /^[a-z0-9 #:;,.()%{}-]*$/;
/**
 * What may sit between a `{` and the next `}` in the style. Caddy reads exactly that span as a placeholder key
 * (v2.11.9 replacer.go:219-240), and every key it knows has a dotted prefix (file., env., http., system., time.) or
 * no colon; a CSS block opens with a property name and a colon, so it can be neither.
 */
const STYLE_BLOCK = /^[a-z-]+:[^{}]*$/;
const ACME_DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory";

type Host = "PDS_HOST" | "APP_HOST" | "DOCS_HOST" | "CHAT_HOST";
/** The sites that proxy to one upstream, by its name; the docs site has none, the chat site two of its own. */
type ProxiedHost = "PDS_HOST" | "APP_HOST";
const UPSTREAM = { PDS_HOST: "PDS_UPSTREAM", APP_HOST: "APP_UPSTREAM" } as const;
/**
 * The public sites each env serves: the PDS everywhere, the app under dev and local (P1.34a, P1.36b), the docs under
 * dev alone (P1.21w).
 */
const HOSTS: Readonly<Record<EdgeMode, readonly Host[]>> = {
  shipped: ["PDS_HOST"],
  local: ["APP_HOST", "PDS_HOST"],
  dev: ["APP_HOST", "PDS_HOST", "DOCS_HOST"],
};
/**
 * The env's sites: HOSTS, and under dev the chat site too when the env names its host (P6.02). The chat servers run on
 * the source stack alone (deployment/preflight/local-only.ts CHAT_SERVICES), so only that stack's edge sets CHAT_HOST
 * and mounts dev/chat.caddy; a site with no host set, or a host set with no site, still fails as any other mismatch.
 */
const hostsOf = (mode: EdgeMode, env: AdaptedEnv): readonly Host[] =>
  mode === "dev" && env.CHAT_HOST !== undefined ? [...HOSTS.dev, "CHAT_HOST"] : HOSTS[mode];

/** Every handler at or below `handlers`, in the order Caddy runs them. */
function handlersIn(handlers: Json[]): Obj[] {
  return handlers.map(obj).flatMap((handler) => [handler, ...routesIn(arr(handler.routes))]);
}
const routesIn = (routes: Json[]): Obj[] => routes.flatMap((route) => handlersIn(arr(obj(route).handle)));
const named = (handlers: Obj[], name: string): Obj[] => handlers.filter((handler) => handler.handler === name);

/**
 * Why the adapted config breaks an edge rule; empty when it breaks none. `env` holds the values the config was adapted
 * with. The rules, each from the deleted reader's rule it replaces (edgeSiteProblems and the preflight's
 * certificateProblems; ADR 0046 maps them one by one):
 *
 * - only the modules, matchers and keys in the tables above; the admin API off and no config persisted;
 * - one loopback server, exactly the health site; one public server, on :443 or under dev on the edge's newt_edge
 *   address alone, holding exactly the env's sites, each matched by its one host;
 * - every site: one plain route that counts first, in the site's own zones, whose global zone has no matcher and
 *   whose every zone is keyed on the client address; every reverse_proxy inside that route, to the site's one
 *   upstream, removing the client address headers and setting X-Forwarded-Host from the request alone;
 * - a trusted proxy only under dev: exactly Newt's address, read right to left from X-Forwarded-For; every server keeps
 *   the shared timeouts;
 * - the error routes: exactly the too-many-tries page on each site, the page fixed text that loads nothing;
 * - certificates: Let's Encrypt for the PDS host under prod, the env's own leaf files under dev and local, nothing else;
 * - under dev the security headers, noindex, the admin guard and blob routes shut on the PDS, the sign-in files
 *   read-only on the app;
 * - the fonts once on the PDS site before its upstream; no other file server, response matcher or CSP change;
 * - the logs whole: errors and one filtered access log per site, no credentials, the PDS's route class and no other
 *   map or log_append; each site's zones, upstream handler and response-header handlers whole, the headers all before
 *   the route; the security headers on every site and the admin guard on the PDS in every env;
 * - each configured value only in its position, and no secret path outside the certificate files.
 */
export function adaptedProblems(config: Json, mode: EdgeMode, env: AdaptedEnv): string[] {
  const values = envProblems(mode, env);
  if (values.length > 0) return values;
  const top = obj(config);
  const servers = Object.values(obj(obj(obj(top.apps).http).servers)).map(obj);
  const loopback = servers.filter((server) => same(server, HEALTH_SERVER));
  const open = servers.filter((server) => !loopback.includes(server));
  const found = [...shapeProblems(top), ...adminProblems(top)];
  if (loopback.length !== 1) found.push("not exactly one health site on loopback");
  const [server, ...others] = open;
  if (server === undefined || others.length > 0) return [...found, "not exactly one public server"];
  const hosts = hostsOf(mode, env).map((host) => env[host] as string);
  found.push(...serverProblems(server, mode, env), ...logProblems(top, server, hosts));
  found.push(...errorProblems(server, mode, env));
  found.push(...tlsProblems(top, server, mode, env));
  for (const host of hostsOf(mode, env)) {
    const route = siteRoute(server, env[host] as string);
    found.push(...(route === null ? [`{$${host}}: no site`] : siteProblems(route, host, mode, env)));
  }
  return [...found, ...strayProblems(top, server, mode, env)];
}

/**
 * Each value the env's sites need is present and fits its shape; the app's differ from the PDS's (P1.34a, P1.36b).
 * Exported so the preflight judges the values before it hands them to a container (P1.39e).
 */
export function envProblems(mode: EdgeMode, env: AdaptedEnv): string[] {
  const needed: EnvName[] = hostsOf(mode, env).flatMap((host): EnvName[] =>
    host === "DOCS_HOST"
      ? [host]
      : host === "CHAT_HOST"
        ? [host, "CHAT_UPSTREAM", "MATRIX_UPSTREAM"]
        : [host, UPSTREAM[host]],
  );
  if (mode === "shipped") needed.push("ACME_EMAIL");
  const found = needed.filter((name) => !ENV_NAMES[name].test(env[name] ?? "")).map((name) => `{$${name}} is not set`);
  for (const host of ["PDS_HOST", "APP_HOST", "DOCS_HOST", "CHAT_HOST"] as const) {
    if (env[host] !== undefined && env[host] !== env[host].toLowerCase()) found.push(`{$${host}} is not lower case`);
  }
  if (mode !== "shipped") {
    if (env.APP_HOST === env.PDS_HOST) found.push("{$APP_HOST} equals {$PDS_HOST}");
    if (env.APP_UPSTREAM === env.PDS_UPSTREAM) found.push("{$APP_UPSTREAM} equals {$PDS_UPSTREAM}");
  }
  if (mode === "dev") {
    for (const name of ["APP_HOST", "APP_UPSTREAM"] as const) {
      if (env[name] !== DEV_APP[name]) found.push(`{$${name}} is not the dev app site's ruled value`);
    }
    if (env.DOCS_HOST !== DEV_DOCS.DOCS_HOST) found.push("{$DOCS_HOST} is not the dev docs site's ruled value");
  }
  // The chat site's three values go together, only under dev, and only as ruled (P6.02).
  const chat = (["CHAT_HOST", "CHAT_UPSTREAM", "MATRIX_UPSTREAM"] as const).filter((name) => env[name] !== undefined);
  if (chat.length > 0 && chat.length < 3) found.push("{$CHAT_HOST} and its two upstreams are not set together");
  for (const name of chat) {
    if (mode !== "dev") found.push(`{$${name}} is set outside dev`);
    else if (env[name] !== DEV_CHAT[name]) found.push(`{$${name}} is not the dev chat site's ruled value`);
  }
  return found;
}

const unknownKeys = (value: Obj, allowed: readonly string[], what: string): string[] =>
  Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map(() => `${what} holds a key the rules do not read`);

/** Every part of the config is one the tables name. */
function shapeProblems(top: Obj): string[] {
  const apps = obj(top.apps);
  const found = [
    ...unknownKeys(top, ["admin", "logging", "apps"], "the config"),
    ...unknownKeys(apps, ["http", "tls"], "apps"),
    ...unknownKeys(obj(apps.http), ["servers"], "the http app"),
  ];
  for (const server of Object.values(obj(obj(apps.http).servers)).map(obj)) {
    found.push(...unknownKeys(server, SERVER_KEYS, "a server"), ...routeShapeProblems(arr(server.routes)));
  }
  return [...new Set(found)];
}

function routeShapeProblems(routes: Json[]): string[] {
  return routes
    .map(obj)
    .flatMap((route) => [
      ...unknownKeys(route, ["match", "handle", "terminal"], "a route"),
      ...arr(route.match).flatMap(matcherProblems),
      ...arr(route.handle).map(obj).flatMap(handlerShapeProblems),
    ]);
}

function matcherProblems(matcher: Json): string[] {
  const set = obj(matcher);
  return [...unknownKeys(set, MATCHERS, "a matcher"), ...arr(set.not).flatMap(matcherProblems)];
}

function handlerShapeProblems(handler: Obj): string[] {
  const name = typeof handler.handler === "string" ? handler.handler : "";
  // Own keys only: a handler named `constructor` or `__proto__` is no module of ours, and must fail, not throw.
  const keys = Object.hasOwn(HANDLER_KEYS, name) ? HANDLER_KEYS[name] : undefined;
  if (keys === undefined) return ["a handler the rules do not read"];
  const found = unknownKeys(handler, ["handler", ...keys], `a ${name} handler`);
  if (name === "subroute") found.push(...routeShapeProblems(arr(handler.routes)));
  if (name === "rate_limit") {
    for (const zone of Object.values(obj(handler.rate_limits)).map(obj)) {
      found.push(...unknownKeys(zone, ZONE_KEYS, "a zone"), ...arr(zone.match).flatMap(matcherProblems));
    }
  }
  if (name === "reverse_proxy") {
    const headers = obj(handler.headers);
    found.push(
      ...unknownKeys(headers, ["request"], "an upstream's headers"),
      ...unknownKeys(obj(headers.request), ["delete", "set"], "an upstream's request headers"),
      ...unknownKeys(obj(handler.transport), ["protocol", "dial_timeout", "response_header_timeout"], "a transport"),
    );
  }
  return found;
}

/** `admin off` and `persist_config off` (P1.28): no admin API to reconfigure the edge, and no config kept on disk. */
function adminProblems(top: Obj): string[] {
  return same(top.admin, { disabled: true, config: { persist: false } }) ? [] : ["the admin API is not off"];
}

/** The public server's listener, timeouts and trusted proxy (P1.36j; ADR 0030 Decision 2; ADR 0032 Decision 4). */
function serverProblems(server: Obj, mode: EdgeMode, env: AdaptedEnv): string[] {
  const found: string[] = [];
  const listen = mode === "dev" ? DEV_LISTENER : ":443";
  if (!same(server.listen, [listen])) {
    found.push(
      mode === "dev" ? "not bound to the edge's newt_edge address alone" : "the public server is not on :443 alone",
    );
  }
  if ("automatic_https" in server) found.push("the public server changes automatic HTTPS");
  const health = obj(HEALTH_SERVER);
  if (TIMEOUTS.some((name) => server[name] !== health[name])) found.push("a server does not keep the shared timeouts");
  found.push(...trustProblems(server, mode));
  const hosts = hostsOf(mode, env).map((host) => env[host] as string);
  const routes = arr(server.routes).map(obj);
  const exact = routes.every(
    (route) => route.terminal === true && hosts.some((host) => same(route.match, [{ host: [host] }])),
  );
  if (!exact || routes.length !== hosts.length) found.push("the public server holds a site other than the env's own");
  return found;
}

const deleted = (fields: readonly string[]): Json =>
  Object.fromEntries(fields.map((each) => [each, { filter: "delete" }]));
const filtered = (fields: readonly string[]): Json => ({
  fields: deleted(fields),
  format: "filter",
  wrap: { format: "json" },
});
/** What an access log line never carries (SE-7; snippets/log.caddy): the client's address, headers, URI and user. */
const ACCESS_DROPPED = [
  "request>client_ip",
  "request>headers",
  "request>proto",
  "request>remote_ip",
  "request>remote_port",
  "request>tls",
  "request>uri",
  "resp_headers",
  "user_id",
];
/** What the error log never carries (SE-7; the Caddyfile's global log). */
const ERROR_DROPPED = [
  "client_ip",
  "data>remote_ip",
  "remote",
  "remote_addr",
  "remote_ip",
  "request>client_ip",
  "request>headers",
  "request>remote_ip",
  "request>remote_port",
  "request>tls",
  "request>uri",
  "resp_headers",
];
/** The whole `logging` block for `count` sites: errors to stderr, and one filtered access log per site to stdout. */
function loggingFor(count: number): Json {
  const names = Array.from({ length: count }, (_, at) => `log${at}`);
  const access = names.map((name) => `http.log.access.${name}`);
  const logs: Obj = {
    default: {
      writer: { output: "stderr" },
      encoder: filtered(ERROR_DROPPED),
      level: "ERROR",
      exclude: ["http.log.access", ...access, "http.stdlib"],
    },
  };
  names.forEach((name, at) => {
    logs[name] = { writer: { output: "stdout" }, encoder: filtered(ACCESS_DROPPED), include: [access[at] as string] };
  });
  return { logs };
}

/**
 * The logs (SE-7; P1.28): the `logging` block is the ruled one whole, so no logger, field or level is added or
 * dropped, and the public server's `logs` only names each site's own filtered access logger: no other key, so
 * credentials are never logged, and no site writes to the default logger.
 */
function logProblems(top: Obj, server: Obj, hosts: readonly string[]): string[] {
  const found: string[] = [];
  if (!same(top.logging, loggingFor(hosts.length))) found.push("the logs are not the ruled ones");
  const logs = obj(server.logs);
  const names = obj(logs.logger_names);
  if (!same(Object.keys(logs), ["logger_names"])) found.push("the public server changes what it logs");
  if (!same(Object.keys(names).sort(), [...hosts].sort())) {
    found.push("the access log does not name exactly the env's sites");
  }
  const loggers = Object.values(names).map(canonical).sort();
  if (
    !same(
      loggers,
      hosts.map((_, at) => canonical([`log${at}`])),
    )
  ) {
    found.push("a site's access log is not its own filtered logger");
  }
  return found;
}

/**
 * The trusted proxy (P1.36j): none outside dev; under dev exactly Newt's address, with the client address read right
 * to left from X-Forwarded-For alone.
 */
function trustProblems(server: Obj, mode: EdgeMode): string[] {
  if (mode !== "dev") return TRUST_KEYS.some((key) => key in server) ? ["a server trusts a proxy outside dev"] : [];
  const found: string[] = [];
  if (!same(server.trusted_proxies, { source: "static", ranges: [`${DEV_PROXY_ADDRESS}/32`] })) {
    found.push(`${DEV_LISTENER} does not trust exactly ${DEV_PROXY_ADDRESS}`);
  }
  if (server.trusted_proxies_strict !== 1) found.push(`${DEV_LISTENER} does not read right to left`);
  if (!same(server.client_ip_headers, ["X-Forwarded-For"])) {
    found.push(`${DEV_LISTENER} reads a header other than X-Forwarded-For`);
  }
  return found;
}

/**
 * The error routes (snippets/too-many-tries.caddy): one per site, each exactly the ruled too-many-tries route, so a
 * refused browser gets the page, a fetch keeps Caddy's empty 429, and every other error Caddy's default.
 */
function errorProblems(server: Obj, mode: EdgeMode, env: AdaptedEnv): string[] {
  const errors = obj(server.errors);
  const routes = arr(errors.routes).map(obj);
  const found = unknownKeys(errors, ["routes"], "the error handling");
  for (const host of hostsOf(mode, env)) {
    const own = routes.filter((route) => same(route.match, [{ host: [env[host] as string] }]));
    const [body, csp] = own.length === 1 ? pageOf(own[0] as Obj) : ["", ""];
    const page = pageProblems(body);
    if (page.length > 0 || !PAGE_CSP.test(csp) || !same(own[0], tooManyTries(env[host] as string, body, csp))) {
      found.push(`{$${host}}: the error route is not the ruled too-many-tries page`);
    }
    found.push(...page.map((problem) => `{$${host}}: the too-many-tries page ${problem}`));
  }
  if (routes.length !== hostsOf(mode, env).length) found.push("an error route other than the sites' own");
  return found;
}

/** The page and the CSP a too-many-tries route sends, each "" when the route is not shaped like one. */
function pageOf(route: Obj): [body: string, csp: string] {
  const status = obj(arr(obj(arr(obj(arr(route.handle)[0]).routes)[0]).handle)[0]);
  const routes = arr(status.routes).map(obj);
  const respond = obj(arr(routes[2]?.handle)[0]);
  const headers = obj(arr(routes[1]?.handle).at(-1));
  const csp = arr(obj(obj(headers.response).set)["Content-Security-Policy"])[0];
  return [typeof respond.body === "string" ? respond.body : "", typeof csp === "string" ? csp : ""];
}

/**
 * Why the page is not fixed text that loads nothing, judged by allow-list. Caddy v2.11.9 replaces known placeholders
 * in a static_response body at run time (staticresp.go:208), {file.*} and {env.*} among them (replacer.go:364-373),
 * so a brace in the page could serve an edge file, a secret or the request. Outside the style: only the ruled tags,
 * each exact, and words with no brace. The style: once, lower-case CSS with no quote, slash, at-rule or URL, and
 * every brace a CSS block.
 */
function pageProblems(body: string): string[] {
  const found: string[] = [];
  if (!body.startsWith("<!doctype html>\n") || !body.endsWith("</html>")) found.push("is not one document");
  const [head, rest, ...moreStyles] = body.split("<style>");
  const [style, tail, ...moreEnds] = (rest ?? "").split("</style>");
  if (rest === undefined || tail === undefined || moreStyles.length > 0 || moreEnds.length > 0) {
    return [...found, "does not hold exactly one style"];
  }
  const outside = `${head}${tail}`;
  if (!(outside.match(/<[^>]*>/g) ?? []).every((tag) => PAGE_TAGS.includes(tag))) {
    found.push("holds a tag outside the ruled ones");
  }
  const words = outside.replace(/<[^>]*>/g, "");
  if (/[{}]/.test(words)) found.push("holds a placeholder");
  else if (!PAGE_TEXT.test(words)) found.push("holds text outside the ruled characters");
  const blocks = [...(style ?? "").matchAll(/\{([^}]*)\}?/g)].map((match) => match[1] as string);
  if (!blocks.every((block) => STYLE_BLOCK.test(block))) found.push("holds a placeholder");
  if (!STYLE_TEXT.test(style ?? "")) found.push("styles with something outside the ruled characters");
  if (/url\(|image|expression/.test(style ?? "")) found.push("loads or runs something");
  return [...new Set(found)];
}

const siteRoute = (server: Obj, host: string): Obj | null =>
  arr(server.routes)
    .map(obj)
    .find((route) => same(route.match, [{ host: [host] }])) ?? null;

/**
 * The certificates (P1.33t, P1.36b; ADR 0032 Decision 1): the whole tls app is the env's own, so no issuer block,
 * internal CA or second certificate can sit beside it. Under prod, Let's Encrypt for the PDS host with the ACME
 * email; under dev and local, the leaf's two files, selected for exactly the env's hosts.
 */
function tlsProblems(top: Obj, server: Obj, mode: EdgeMode, env: AdaptedEnv): string[] {
  const tls = obj(top.apps).tls;
  if (mode === "shipped") {
    const acme = { ca: ACME_DIRECTORY, email: env.ACME_EMAIL as string, module: "acme" };
    const own = { automation: { policies: [{ subjects: [env.PDS_HOST as string], issuers: [acme] }] } };
    return [
      ...(same(tls, own) ? [] : ["the certificates are not Let's Encrypt's for {$PDS_HOST} alone"]),
      ...("tls_connection_policies" in server ? ["a file certificate outside dev and local"] : []),
    ];
  }
  const [certificate, key] = mode === "dev" ? DEV_TLS : LOCAL_TLS;
  const own = { certificates: { load_files: [{ certificate, key, tags: ["cert0"] }] } };
  const [policy, rest, ...more] = arr(server.tls_connection_policies).map(obj);
  const sni = arr(obj(policy?.match).sni);
  const hosts = hostsOf(mode, env).map((host) => env[host] as string);
  const selected =
    policy !== undefined &&
    rest !== undefined &&
    more.length === 0 &&
    same(rest, {}) &&
    same({ ...policy, match: null }, { match: null, certificate_selection: { any_tag: ["cert0"] } }) &&
    same(Object.keys(obj(policy.match)), ["sni"]) &&
    same([...sni].sort(), [...hosts].sort());
  return [
    ...(same(tls, own) ? [] : [`a certificate other than the ${mode} (tls)`]),
    ...(selected ? [] : [`the ${mode} leaf is not selected for exactly the env's hosts`]),
  ];
}

/**
 * The docs site (P1.21w; ADR 0075): one plain route, as every site; before it exactly the security headers, the docs
 * CSP and noindex; inside it one unmatched route that counts in the docs zone, then serves files from DOCS_ROOT. No
 * upstream and no other handler, so the file server's root is the only thing the site can answer from.
 */
function docsSiteProblems(route: Obj): string[] {
  const name = "{$DOCS_HOST}";
  const [outer, ...extra] = arr(route.handle).map(obj);
  const [only, ...otherRoutes] = arr(outer?.routes).map(obj);
  const site = arr(only?.handle).map(obj);
  const inner = site.at(-1);
  if (
    outer?.handler !== "subroute" ||
    extra.length > 0 ||
    only === undefined ||
    otherRoutes.length > 0 ||
    "match" in only ||
    inner?.handler !== "subroute"
  ) {
    return [`${name}: not exactly one plain route`];
  }
  const found: string[] = [];
  if (!same(site.slice(0, -1), [...SECURITY_HEADERS, DOCS_HEADERS, NOINDEX])) {
    found.push(`${name}: the site's headers are not the ruled ones`);
  }
  const [counted, ...more] = arr(inner.routes).map(obj);
  const [limit, files, ...after] = arr(counted?.handle).map(obj);
  if (counted === undefined || more.length > 0 || "match" in counted || after.length > 0) {
    return [...found, `${name}: the route is not the zone then the files`];
  }
  if (!same(limit, limiter(DOCS_ZONES))) found.push(`${name}: the zones are not the ruled ones`);
  if (!isDocsFiles(files)) found.push(`${name}: the files are not served from ${DOCS_ROOT} alone`);
  return found;
}

/** (strict-csp-default) as adapted: the strict policy on a response that carries none of its own. */
const STRICT_CSP_DEFAULT: Json = {
  handler: "headers",
  response: {
    require: { headers: { "Content-Security-Policy": null } },
    set: {
      "Content-Security-Policy": ["default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"],
    },
  },
};
/** One of the chat site's two upstream routes: its path pattern, by `name`, then (upstream) to `upstream` alone. */
const chatUpstreamRoute = (name: string, pattern: string, upstream: string): Json => ({
  match: [{ vars_regexp: { "{http.request.uri.path}": { name, pattern } } }],
  handle: [{ handler: "subroute", routes: [{ handle: [ruledProxy(upstream)] }] }],
});

/**
 * The chat site (P6.02; ADR 0081 decision 6, ADR 0088): one plain route, as every site; before it exactly the security
 * headers, the default policy and noindex; inside it, in order and each whole, the zones, the Matrix client API to
 * Synapse, the door's routes to the door, and the edge's own 404 for anything else. So no other path, no other
 * upstream and no client address reaches either, and the door's and Synapse's own policies stand.
 */
function chatSiteProblems(route: Obj, env: AdaptedEnv): string[] {
  const name = "{$CHAT_HOST}";
  const [outer, ...extra] = arr(route.handle).map(obj);
  const [only, ...otherRoutes] = arr(outer?.routes).map(obj);
  const site = arr(only?.handle).map(obj);
  const inner = site.at(-1);
  if (
    outer?.handler !== "subroute" ||
    extra.length > 0 ||
    only === undefined ||
    otherRoutes.length > 0 ||
    "match" in only ||
    inner?.handler !== "subroute"
  ) {
    return [`${name}: not exactly one plain route`];
  }
  const found: string[] = [];
  if (!same(site.slice(0, -1), [...SECURITY_HEADERS, STRICT_CSP_DEFAULT, NOINDEX])) {
    found.push(`${name}: the site's headers are not the ruled ones`);
  }
  const [zones, matrix, door, last, ...more] = arr(inner.routes);
  if (!same(zones, { handle: [limiter(CHAT_ZONES)] })) found.push(`${name}: the zones are not the ruled ones`);
  if (!same(matrix, chatUpstreamRoute("matrix", CHAT_MATRIX_PATH, env.MATRIX_UPSTREAM as string))) {
    found.push(`${name}: the Matrix route is not the ruled one`);
  }
  if (!same(door, chatUpstreamRoute("door", CHAT_DOOR_PATH, env.CHAT_UPSTREAM as string))) {
    found.push(`${name}: the door route is not the ruled one`);
  }
  if (!same(last, { handle: [{ handler: "static_response", status_code: 404 }] }) || more.length > 0) {
    found.push(`${name}: the route is not the zones, the Matrix route, the door route, then 404`);
  }
  return found;
}

/** The docs file server: root DOCS_ROOT and Caddy's own `hide` list of the config files it read, nothing else. */
const isDocsFiles = (handler: Obj | undefined): boolean =>
  handler?.handler === "file_server" &&
  handler.root === DOCS_ROOT &&
  same(Object.keys(handler).sort(), ["handler", "hide", "root"]) &&
  arr(handler.hide).every((path) => typeof path === "string" && path.startsWith("/etc/caddy/"));

/** One site's rules; `route` is the public server's route for `host`. */
function siteProblems(route: Obj, host: Host, mode: EdgeMode, env: AdaptedEnv): string[] {
  if (host === "DOCS_HOST") return docsSiteProblems(route);
  if (host === "CHAT_HOST") return chatSiteProblems(route, env);
  const name = `{$${host}}`;
  const [outer, ...extra] = arr(route.handle).map(obj);
  const [only, ...otherRoutes] = arr(outer?.routes).map(obj);
  if (
    outer?.handler !== "subroute" ||
    extra.length > 0 ||
    only === undefined ||
    otherRoutes.length > 0 ||
    "match" in only
  ) {
    return [`${name}: not exactly one plain route`];
  }
  const site = arr(only.handle).map(obj);
  const plain = named(site, "subroute");
  const inner = plain[0];
  if (inner === undefined || plain.length !== 1) return [`${name}: not exactly one plain route`];
  const routes = arr(inner.routes).map(obj);
  const all = handlersIn(site);
  const found = [...zoneProblems(name, routes, all, host, mode)];
  // The route answers the request, so a handler after it never runs on an upstream's response: the site's headers
  // must all come before it.
  if (site.at(-1) !== inner) found.push(`${name}: a handler follows the route`);
  const proxies = named(all, "reverse_proxy");
  if (proxies.length === 0) found.push(`${name}: public site without an upstream`);
  if (named(routesIn(routes), "reverse_proxy").length !== proxies.length) {
    found.push(`${name}: a reverse_proxy is outside the route`);
  }
  const upstream = env[UPSTREAM[host as ProxiedHost]] as string;
  for (const proxy of proxies) found.push(...proxyProblems(name, proxy, upstream));
  found.push(...snippetProblems(name, site, routes, host, mode), ...headerProblems(name, all, host, env));
  found.push(...strayRouteProblems(name, site, routes));
  return [...found, ...fontProblems(name, routes, host, env)];
}

/**
 * The route counts first: its first inner route has no matcher and starts with the site's one rate_limit, whose
 * global zone has no matcher and whose every zone is keyed on the client address. The app site has its own zones
 * under dev (P1.36b) and shares the PDS's under local (refocus rulings, Amendment 2).
 */
function zoneProblems(name: string, routes: Obj[], all: Obj[], host: Host, mode: EdgeMode): string[] {
  const found: string[] = [];
  const first = routes[0];
  const limit = obj(arr(first?.handle)[0]);
  const limits = named(all, "rate_limit");
  if (first === undefined || "match" in first || limit.handler !== "rate_limit") {
    found.push(`${name}: the route does not apply the zones first`);
  }
  if (limits.length !== 1) found.push(`${name}: ${limits.length} rate_limit blocks`);
  const own = host === "APP_HOST" && mode === "dev" ? "app_global" : "global";
  const others = GLOBALS.filter((each) => each !== own);
  const ruled = own === "global" ? PDS_ZONES : APP_ZONES;
  if (!limits.every((each) => same(each, limiter(ruled)))) found.push(`${name}: the zones are not the ruled ones`);
  return [...found, ...limits.flatMap((each) => zoneSetProblems(name, obj(each.rate_limits), own, others))];
}

type Zone = readonly [name: string, events: number, seconds: number, match?: Json];
const paths = (...path: string[]): Json => [{ path }];
const API = "/@atproto/oauth-provider/~api";
/**
 * The PDS's zones (snippets/ratelimit.caddy; limits.json holds the numbers, which edge.test.ts compares): events in a
 * window of seconds, for the requests a matcher names, or for every request when it names none.
 */
const PDS_ZONES: readonly Zone[] = [
  ["blob_read", 600, 300, paths("/xrpc/com.atproto.sync.getBlob")],
  ["blob_upload", 60, 300, paths("/xrpc/com.atproto.repo.uploadBlob")],
  ["firehose", 6, 60, paths("/xrpc/com.atproto.sync.subscribeRepos")],
  ["firehose_hour", 60, 3600, paths("/xrpc/com.atproto.sync.subscribeRepos")],
  ["global", 3000, 300, [{ not: [WEB_MARK] }]],
  [
    "identity",
    300,
    300,
    paths(
      "/xrpc/com.atproto.identity.*",
      "/xrpc/com.atproto.server.describeServer",
      "/.well-known/atproto-did",
      "/xrpc/_health",
    ),
  ],
  ["oauth_signin", 30, 300, [{ method: ["POST"], path: [`${API}/sign-in`] }]],
  ["oauth_token", 120, 300, [{ not: [WEB_MARK], path: ["/oauth/token", "/xrpc/com.atproto.server.refreshSession"] }]],
  [
    "reset",
    5,
    3600,
    paths(
      "/xrpc/com.atproto.server.requestPasswordReset",
      "/xrpc/com.atproto.server.resetPassword",
      "/xrpc/com.atproto.server.requestEmailConfirmation",
      "/xrpc/com.atproto.server.requestEmailUpdate",
      `${API}/reset-password-request`,
      `${API}/reset-password-confirm`,
      `${API}/update-email-request`,
      `${API}/verify-email-request`,
    ),
  ],
  ["session", 30, 300, paths("/xrpc/com.atproto.server.createSession")],
  ["session_day", 300, 86_400, paths("/xrpc/com.atproto.server.createSession")],
  ["signup", 10, 3600, paths("/xrpc/com.atproto.server.createAccount", `${API}/sign-up`)],
  [
    "sync",
    1500,
    300,
    [
      {
        not: [{ path: ["/xrpc/com.atproto.sync.getBlob"] }, { path: ["/xrpc/com.atproto.sync.subscribeRepos"] }],
        path: ["/xrpc/com.atproto.sync.*"],
      },
    ],
  ],
  ["web_global", 90_000, 60, [WEB_MARK]],
  [
    "web_oauth_token",
    3000,
    300,
    [{ ...obj(WEB_MARK), path: ["/oauth/token", "/xrpc/com.atproto.server.refreshSession"] }],
  ],
];
/**
 * A content-hashed build file (P1.21g; ADR 0069; snippets/ratelimit.caddy app-build-file): a GET or HEAD whose decoded,
 * uncleaned path is one SvelteKit 3.2.0 writes under /_app/immutable/. Exported for adapted-denies.test.ts.
 */
export const BUILD_FILE_PATH = String.raw`^/_app/immutable/(?:entry|nodes|chunks|assets)/[\w-]+(?:\.[\w-]+)?\.(?:js|css|woff2|png)$`;
const BUILD_FILE: Json = {
  method: ["GET", "HEAD"],
  vars_regexp: { "{http.request.uri.path}": { pattern: BUILD_FILE_PATH } },
};
/** The dev app site's own zones (dev/app.caddy, P1.36b): build files in app_files alone, then app_global. */
const APP_ZONES: readonly Zone[] = [
  ["app_burst", 60, 10, [{ not: [BUILD_FILE] }]],
  ["app_files", 120, 10, [BUILD_FILE]],
  ["app_global", 1200, 300],
  ["app_signin", 10, 300, [{ method: ["POST"], path: ["/login", "/join"] }]],
];
/** The docs site's one zone (dev/docs.caddy; limits.json docsRateLimitZones): every request, by client. */
const DOCS_ZONES: readonly Zone[] = [["docs_global", 6000, 300]];
/** The chat site's zones (dev/chat.caddy; limits.json chatRateLimitZones): each sign-in hop, then every request. */
const CHAT_ZONES: readonly Zone[] = [
  ["chat_global", 6000, 300],
  ["chat_signin", 20, 300, paths("/sign-in", "/sign-in/redeem")],
];
/** Each site's unmatched zone, which no other site's rate_limit may hold. */
const GLOBALS = ["global", "app_global", "docs_global", "chat_global"];
/** The one rate_limit handler a set of zones adapts to: each keyed on the client address, IPv6 by /64, but web's. */
const limiter = (zones: readonly Zone[]): Json => ({
  handler: "rate_limit",
  disable_metrics: true,
  rate_limits: Object.fromEntries(
    zones.map(([name, events, seconds, match]) => [
      name,
      {
        ...(WEB_ZONES.includes(name) ? { key: WEB_KEY } : { ipv6_prefix: 64, key: CLIENT_KEY }),
        max_events: events,
        window: seconds * 1_000_000_000,
        ...(match === undefined ? {} : { match }),
      },
    ]),
  ),
});

/**
 * One rate_limit's zones: the site's own global zone, unmatched but for web's mark; no other site's; every zone keyed
 * on the client, but web's own, which match web's mark exactly.
 */
function zoneSetProblems(name: string, zones: Obj, own: string, others: readonly string[]): string[] {
  const found: string[] = [];
  const ownMatch = obj(zones[own]).match;
  if (!(own in zones)) found.push(`${name}: there is no ${own} zone`);
  else if (ownMatch !== undefined && !same(ownMatch, [{ not: [WEB_MARK] }])) {
    found.push(`${name}: the ${own} zone has a matcher`);
  }
  if (others.some((other) => other in zones)) found.push(`${name}: the route applies another site's zones`);
  // A fixed label: the zone's name is input, and a message repeats nothing it was given.
  const keyed = ([zone, settings]: [string, Json]) =>
    WEB_ZONES.includes(zone)
      ? obj(settings).key === WEB_KEY && arr(obj(settings).match).every((each) => webMarked(each))
      : obj(settings).key === CLIENT_KEY;
  if (!Object.entries(zones).every(keyed)) found.push(`${name}: a zone is not keyed on {client_ip}`);
  return found;
}

/** A matcher that holds web's whole mark, and nothing that would loosen it. */
const webMarked = (matcher: Json): boolean => {
  const set = obj(matcher);
  return same({ header: set.header ?? null, header_regexp: set.header_regexp ?? null }, WEB_MARK) && !("not" in set);
};

/**
 * One upstream's rules (ADR 0018; P1.28l; P1.36j): it dials the site's one configured upstream, removes each client
 * address header and web's key header (P1.21j) and sets none again, and sets X-Forwarded-Host to the request's own Host, once. Caddy v2.11.7 keeps
 * an incoming X-Forwarded-Host from a trusted proxy (reverseproxy.go:1012-1022), and under dev Newt is trusted.
 */
function proxyProblems(name: string, proxy: Obj, upstream: string): string[] {
  const found: string[] = [];
  if (!same(proxy.upstreams, [{ dial: upstream }])) {
    found.push(`${name}: a reverse_proxy does not name the site's one upstream`);
  }
  const request = obj(obj(proxy.headers).request);
  const removed = arr(request.delete);
  const set = Object.keys(obj(request.set));
  const lower = (text: string) => text.toLowerCase();
  for (const header of ADDRESS_HEADERS) {
    if (!removed.includes(header) || set.map(lower).includes(lower(header))) {
      found.push(`${name}: a reverse_proxy passes ${header}`);
    }
  }
  const forwarded = set.filter((key) => lower(key) === "x-forwarded-host");
  const touched = removed.some((header) => typeof header === "string" && lower(header) === "x-forwarded-host");
  if (
    !same(forwarded, ["X-Forwarded-Host"]) ||
    touched ||
    !same(obj(request.set)["X-Forwarded-Host"], ["{http.request.host}"])
  ) {
    found.push(`${name}: a reverse_proxy passes X-Forwarded-Host`);
  }
  // Then the handler whole, so it sets no other request header and keeps the ruled transport and timeouts.
  if (!same(proxy, ruledProxy(upstream))) found.push(`${name}: a reverse_proxy is not the ruled one`);
  return found;
}

/** (upstream) as adapted for `upstream` (snippets/upstream.caddy): every rule proxyProblems names, whole. */
const ruledProxy = (upstream: string): Json => ({
  handler: "reverse_proxy",
  headers: {
    request: {
      delete: [...ADDRESS_HEADERS, WEB_KEY_HEADER],
      set: { "X-Forwarded-Host": ["{http.request.host}"], "X-Forwarded-Proto": ["https"] },
    },
  },
  transport: { protocol: "http", dial_timeout: 5_000_000_000, response_header_timeout: 130_000_000_000 },
  upstreams: [{ dial: upstream }],
});

/** The index of the first inner route that holds a reverse_proxy, or the route count when none does. */
const upstreamAt = (routes: Obj[]): number => {
  const at = routes.findIndex((route) => named(handlersIn(arr(route.handle)), "reverse_proxy").length > 0);
  return at === -1 ? routes.length : at;
};
const holds = (list: Json[], part: Json): boolean => list.some((each) => same(each, part));

/**
 * Each snippet's handlers on the site, each deny route before the upstream. Every site in every env: the security
 * headers. The PDS in every env: the admin guard and the route class its access log carries, once and nowhere else.
 * Under dev (P1.36b, P1.38f; ADR 0032) also noindex, blob routes shut on the PDS and the sign-in files read-only on
 * the app.
 */
function snippetProblems(name: string, site: Obj[], routes: Obj[], host: Host, mode: EdgeMode): string[] {
  const before = routes.slice(0, upstreamAt(routes));
  const pds = host === "PDS_HOST";
  const required: [boolean, string][] = [[SECURITY_HEADERS.every((part) => holds(site, part)), "security-headers"]];
  if (pds) required.push([XRPC_GUARD.every((part) => holds(before, part)), "xrpc-guard"]);
  if (mode === "dev") {
    required.push([holds(site, NOINDEX), "noindex"]);
    required.push(pds ? [holds(before, BLOB_DENY), "blob-deny"] : [holds(before, SIGNIN_FILES), "signin-files"]);
  }
  const found = required.filter(([present]) => !present).map(([, snippet]) => `${name}: does not import ${snippet}`);
  const classes = handlersIn(site).filter((each) => each.handler === "map" || each.handler === "log_append");
  const own = pds ? ROUTE_CLASS : [];
  const exact = classes.length === own.length && own.every((part, at) => same(site[at], part));
  return exact ? found : [...found, `${name}: the route class is not the ruled one`];
}

/**
 * Nothing answers a request but the ruled snippets and the upstream. Before the site's route only the route class and
 * `headers` handlers may sit, so no `static_response` there can answer for the site. Inside it, a route that counts
 * or proxies has no matcher and holds only the rate limiter, the fonts' CSP append and the upstream; every other
 * route is one a snippet adapts to, whole.
 */
function strayRouteProblems(name: string, site: Obj[], routes: Obj[]): string[] {
  const found: string[] = [];
  const kinds = (handlers: Obj[]): string[] => handlers.map((each) => String(each.handler));
  if (!kinds(site.slice(0, -1)).every((kind) => ["map", "log_append", "headers"].includes(kind))) {
    found.push(`${name}: a handler outside the ruled snippets`);
  }
  const ruled: Json[] = [...XRPC_GUARD, BLOB_DENY, SIGNIN_FILES, FONT_404];
  const fine = routes.every((route) => {
    const own = kinds(arr(route.handle).map(obj));
    if (!own.includes("rate_limit") && !own.includes("reverse_proxy")) return holds(ruled, route) || isFontFile(route);
    return !("match" in route) && own.every((kind) => ["rate_limit", "headers", "reverse_proxy"].includes(kind));
  });
  return fine ? found : [...found, `${name}: a route outside the ruled snippets`];
}

/**
 * Every `headers` handler of a site is one the snippets adapt to, whole, so none after them can delete or weaken
 * what they set, or add a header of its own such as a CORS origin.
 */
function headerProblems(name: string, all: Obj[], host: Host, env: AdaptedEnv): string[] {
  const ruled: Json[] = [...SECURITY_HEADERS, NOINDEX];
  if (host === "PDS_HOST") ruled.push(FONT_TYPE, cspAppend(env.PDS_HOST as string));
  else ruled.push(SIGNIN_ALLOW);
  const headers = named(all, "headers");
  // Each at most once: a second copy of the CSP append, say, would add its source twice.
  const once = ruled.every((part) => headers.filter((handler) => same(handler, part)).length <= 1);
  return headers.every((handler) => holds(ruled, handler)) && once
    ? []
    : [`${name}: changes a response header outside the ruled snippets`];
}

const isFontFile = (route: Obj): boolean => {
  const [type, server, ...more] = arr(route.handle).map(obj);
  return (
    same(route.match, FONT_FILE_MATCH) &&
    same(type, FONT_TYPE) &&
    server?.handler === "file_server" &&
    server.root === FONT_ROOT &&
    more.length === 0
  );
};

/** The fonts (P2.24e): on the PDS site, the two font routes once before the upstream, whose route appends the CSP. */
function fontProblems(name: string, routes: Obj[], host: Host, env: AdaptedEnv): string[] {
  const files = routes.filter(isFontFile).length;
  const denies = routes.filter((route) => same(route, FONT_404)).length;
  if (host !== "PDS_HOST") return files + denies > 0 ? [`${name}: imports pds-fonts`] : [];
  const at = upstreamAt(routes);
  const before = routes.slice(0, at);
  const append = cspAppend(env.PDS_HOST as string);
  const last = arr(routes[at]?.handle);
  const ordered =
    files === 1 &&
    denies === 1 &&
    before.findIndex(isFontFile) !== -1 &&
    before.findIndex(isFontFile) < before.findIndex((route) => same(route, FONT_404)) &&
    same(last[0], append) &&
    obj(last[1]).handler === "reverse_proxy";
  return ordered ? [] : [`${name}: the route does not import pds-fonts once before its upstream`];
}

/** A `headers` handler that names Content-Security-Policy in any spelling, in any of its operations. */
function touchesCsp(handler: Obj): boolean {
  const response = obj(handler.response);
  const fields = [
    ...Object.keys(obj(response.set)),
    ...Object.keys(obj(response.add)),
    ...Object.keys(obj(response.replace)),
    ...arr(response.delete).filter((field) => typeof field === "string"),
  ];
  return fields.some((field) => field.toLowerCase() === "content-security-policy");
}

/**
 * What must appear nowhere but its one place (P1.28l, P1.34b, P2.24e): a file server outside the fonts, a response
 * matcher outside the fonts and the Referrer-Policy default, a CSP change outside the fonts' append; then, with every
 * ruled position blanked, any configured value or secret path left in the config.
 */
function strayProblems(top: Obj, server: Obj, mode: EdgeMode, env: AdaptedEnv): string[] {
  const found: string[] = [];
  const append = cspAppend(env.PDS_HOST as string);
  const routes = arr(server.routes).map(obj);
  const all = routesIn(routes);
  const fontServers = routesIn(routes)
    .flatMap((handler) => arr(handler.routes).map(obj))
    .filter(isFontFile).length;
  // The docs site's file server is judged whole by docsSiteProblems; it may sit only there.
  const docsSite = siteRoute(server, env.DOCS_HOST ?? "");
  const docsServers = docsSite === null ? 0 : named(handlersIn(arr(docsSite.handle)), "file_server").length;
  if (named(all, "file_server").length !== fontServers + docsServers) {
    found.push("serves files outside pds-fonts");
  }
  // The chat site's headers are judged whole by chatSiteProblems; its default policy may sit only there.
  const chatSite = siteRoute(server, env.CHAT_HOST ?? "");
  const chatHeaders = new Set(chatSite === null ? [] : named(handlersIn(arr(chatSite.handle)), "headers"));
  for (const handler of named(all, "headers")) {
    if (chatHeaders.has(handler) && same(handler, STRICT_CSP_DEFAULT)) continue;
    const fonts = same(handler, append);
    if ("require" in obj(handler.response) && !fonts && !same(handler, SECURITY_HEADERS[1])) {
      found.push("a response matcher outside pds-fonts");
    }
    if (touchesCsp(handler) && !fonts && !same(handler, DOCS_HEADERS)) {
      found.push("changes a Content-Security-Policy outside pds-fonts");
    }
  }
  return [...found, ...valueProblems(top, append, mode, env)];
}

/**
 * A copy of the config without the positions a configured value is ruled to sit in, each by its own path and never by
 * key name alone: the tls app, each server's access-log names, SNI policies and site matchers, each upstream's dial,
 * and the fonts' CSP append. A `host` matcher inside a zone or an inner route is no such position, and stays.
 */
function positionsBlanked(top: Obj, append: Json): Json {
  const handler = (each: Json): Json => {
    const value = obj(each);
    if (same(value, append)) return null;
    // The ruled PDS zones hold web's key file by name, the one secret path outside the certificate files.
    if (same(value, limiter(PDS_ZONES))) return null;
    if (value.handler === "reverse_proxy") return { ...value, upstreams: null };
    return "routes" in value ? { ...value, routes: arr(value.routes).map(route) } : value;
  };
  const route = (each: Json): Json => ({ ...obj(each), handle: arr(obj(each).handle).map(handler) });
  const servers = Object.entries(obj(obj(obj(top.apps).http).servers)).map(([name, value]) => {
    const server = obj(value);
    const routes = arr(server.routes).map((each) => ({ ...obj(route(each)), match: null }));
    const logs = { ...obj(server.logs), logger_names: null };
    const errorRoutes = arr(obj(server.errors).routes).map((each) => ({ ...obj(each), match: null }));
    return [name, { ...server, routes, logs, errors: { routes: errorRoutes }, tls_connection_policies: null }];
  });
  return { ...top, apps: { ...obj(top.apps), tls: null, http: { servers: Object.fromEntries(servers) } } };
}

/** With every ruled position blanked, a configured value or a secret path still in the config. */
function valueProblems(top: Obj, append: Json, mode: EdgeMode, env: AdaptedEnv): string[] {
  const found: string[] = [];
  const blanked = JSON.stringify(positionsBlanked(top, append));
  for (const name of Object.keys(ENV_NAMES) as EnvName[]) {
    const value = env[name];
    if (value !== undefined && blanked.includes(value)) found.push(`{$${name}} is outside its position`);
  }
  if (blanked.includes("/run/secrets/")) found.push("a secret path outside the certificate files");
  if (mode !== "dev" && JSON.stringify(top).includes("dev_tls_")) found.push("the dev leaf outside dev");
  if (mode !== "local" && JSON.stringify(top).includes("local_tls_")) found.push("the local leaf outside local");
  return found;
}
