// The edge config as Caddy itself reads it (P1.39a; ADR 0046): `caddy adapt --adapter caddyfile` turns the
// Caddyfile, its snippets and the enabled sites into the JSON config Caddy runs (caddyserver.com/docs/command-line,
// "caddy adapt"; Caddy v2.11.7 caddyconfig/httpcaddyfile/httptype.go Setup). adapted/<env>.generated.json holds that
// output for each env's files, adapted with SENTINELS for the configured values, and is reviewed as trusted base:
// it is what the edge will do, in Caddy's own words. adapted.image.test.ts proves each file is what the built image
// adapts, so the files cannot drift from the Caddyfile or from Caddy.
//
// `reviewedDifference` says whether a config adapted with an env's real values is the reviewed one, value for value.
// It is pure: it takes parsed JSON, reads no file and runs no process, and its one message carries no value.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

/**
 * The values the reviewed configs were adapted with, one for each `{$NAME}` the edge's files use
 * (adapted-rules.ts ENV_NAMES; adapted.test.ts holds the two lists equal). Each fits its shape there, none is part of another, and none
 * occurs in our config files, so replacing one in the adapted text replaces only that value.
 */
export const SENTINELS = {
  PDS_HOST: "pds-host.invalid",
  PDS_UPSTREAM: "pds-upstream.invalid:1",
  ACME_EMAIL: "acme-email@sentinel.invalid",
  APP_HOST: "app-host.invalid",
  APP_UPSTREAM: "app-upstream.invalid:2",
  DOCS_HOST: "docs-host.invalid",
  MEDIA_HOST: "media-host.invalid",
  MEDIA_UPSTREAM: "media-upstream.invalid:3",
} as const;
type EnvName = keyof typeof SENTINELS;
/** The values a config was adapted with; a name the env does not set is absent. */
export type AdaptedEnv = Readonly<Partial<Record<EnvName, string>>>;

/**
 * How `caddy adapt` is run in the edge image, by the preflight's C18 and by adapted.image.test.ts alike (P1.39c), so
 * the flags C18 uses are run against the real image in CI. Nothing to reach, write or gain: no pull, no network, a
 * read-only root, no new privileges, the edge's uid, and every capability dropped but the one the binary's own file
 * capability names (Dockerfile: `setcap cap_net_bind_service=+ep`). Without that one the kernel refuses to start the
 * binary at all (capabilities(7), "Capabilities and execution of programs by root" and the EPERM note on execve); the
 * compose edge service has the same pair. With no network there is nothing to bind.
 */
export const ADAPT_RUN_FLAGS = [
  "--rm",
  "--pull",
  "never",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--cap-add",
  "NET_BIND_SERVICE",
  "--security-opt",
  "no-new-privileges",
  "--user",
  "65532:65532",
  "--entrypoint",
  "caddy",
] as const;
/** The command after the image: adapt the image's own Caddyfile. */
export const ADAPT_COMMAND = ["adapt", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"] as const;

/** The envs with a reviewed config, by file name in adapted/. */
export const ADAPTED_ENVS = ["prod", "dev", "local"] as const;
export type AdaptedEnvName = (typeof ADAPTED_ENVS)[number];

const obj = (value: Json | undefined): Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
const arr = (value: Json | undefined): Json[] => (Array.isArray(value) ? value : []);

/** JSON text with every object's keys in byte order, so two values compare whatever order their keys were written in. */
export const canonical = (value: Json | undefined): string =>
  JSON.stringify(value, (_key, each: Json) =>
    typeof each === "object" && each !== null && !Array.isArray(each)
      ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : each,
  ) ?? "undefined";

/** `value` with each sentinel replaced by the env's value, in every string and every key. */
function withValues(value: Json, env: AdaptedEnv): Json {
  const text = (from: string): string =>
    (Object.keys(SENTINELS) as EnvName[]).reduce(
      (out, name) => (env[name] === undefined ? out : out.replaceAll(SENTINELS[name], env[name])),
      from,
    );
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) return value.map((each) => withValues(each, env));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [text(key), withValues(each, env)]));
}

const byText = (a: Json, b: Json): number => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);

/**
 * `config` with the orders Caddy derives from the host names made fixed: a server's site routes and error routes, each
 * sorted by their matcher, and the names of a connection policy's SNI matcher. Caddy v2.11.7 puts the longer host first
 * (caddyconfig/httpcaddyfile/httptype.go, the specificity sort in serversFromPairings), so the same files adapt in
 * another order for another pair of host names. Each site route is terminal and matched by its one host, and the SNI
 * names are a set, so neither order decides anything; a route that is not a terminal host route keeps its place, and
 * then the comparison fails unless the reviewed file holds it there too.
 */
const terminalHostRoute = (route: Json): boolean =>
  obj(route).terminal === true && "host" in obj(arr(obj(route).match)[0]);

function hostOrdered(config: Json): Json {
  const top = obj(config);
  if (!("apps" in top)) return top;
  const http = obj(obj(top.apps).http);
  const servers = Object.entries(obj(http.servers)).map(([name, value]) => {
    const server = obj(value);
    const ordered: Obj = { ...server };
    const routes = arr(server.routes);
    const sites = routes.every(terminalHostRoute);
    if (sites) ordered.routes = [...routes].sort(byText);
    // The error routes (snippets/too-many-tries.caddy) follow the same site order (httptype.go:879-895 appends each
    // site's in that order), and each is terminal and matched by its one host too.
    const errors = arr(obj(server.errors).routes);
    if (errors.length > 0 && errors.every(terminalHostRoute)) {
      ordered.errors = { ...obj(server.errors), routes: [...errors].sort(byText) };
    }
    if ("tls_connection_policies" in server) {
      ordered.tls_connection_policies = arr(server.tls_connection_policies).map((policy) => {
        const match = obj(obj(policy).match);
        return "sni" in match ? { ...obj(policy), match: { ...match, sni: [...arr(match.sni)].sort(byText) } } : policy;
      });
    }
    return [name, ordered] as const;
  });
  return { ...top, apps: { ...obj(top.apps), http: { ...http, servers: Object.fromEntries(servers) } } };
}

/**
 * Whether `adapted`, Caddy's output for the env's values, is `reviewed`, the repository's
 * adapted/<env>.generated.json, with those values in place of the sentinels: null when it is, or one fixed reason.
 * Equal means equal in every key and every value, so the edge serves nothing a review did not see.
 */
export function reviewedDifference(adapted: Json, reviewed: Json, env: AdaptedEnv): string | null {
  return canonical(hostOrdered(adapted)) === canonical(hostOrdered(withValues(reviewed, env)))
    ? null
    : "the edge config Caddy adapts is not the reviewed one";
}
