// edge_timeout_above_every_deadline (P1.28; plan §6.1 Deadlines; rule RE-1): every request's deadline ends before
// the edge gives up on the upstream, so the app's own 503 http.deadline reaches the client. Read from Caddy's adapted
// JSON (v2.11.7: durations in nanoseconds; reverse_proxy transport `response_header_timeout`, server `write_timeout`).

const NS_PER_MS = 1_000_000;

export interface Manifest {
  readonly file: string;
  readonly routes: readonly { readonly path?: string; readonly deadlineMs?: number }[];
}

type Json = unknown;

/** Every reverse_proxy handler in the adapted config, at any depth. */
function proxies(node: Json): Record<string, Json>[] {
  if (Array.isArray(node)) return node.flatMap(proxies);
  if (node === null || typeof node !== "object") return [];
  const object = node as Record<string, Json>;
  const own = object.handler === "reverse_proxy" ? [object] : [];
  return [...own, ...Object.values(object).flatMap(proxies)];
}

type Servers = Record<string, { write_timeout?: number }>;

/** The edge's own timeouts: every reverse_proxy waits exactly the limit, every server writes for longer. */
function edgeProblems(config: Json, edgeNs: number): string[] {
  const all = proxies(config);
  const found = all.length === 0 ? ["no reverse_proxy in the config"] : [];
  for (const proxy of all) {
    const header = (proxy.transport as { response_header_timeout?: number } | undefined)?.response_header_timeout;
    if (header !== edgeNs) found.push(`a reverse_proxy has response_header_timeout ${header ?? "unset"}`);
  }
  const servers = (config as { apps?: { http?: { servers?: Servers } } }).apps?.http?.servers ?? {};
  for (const [name, server] of Object.entries(servers)) {
    if (!((server.write_timeout ?? 0) > edgeNs)) found.push(`server ${name} write timeout is not above it`);
  }
  return found;
}

/** The app's deadlines: every route's and the request default's maximum end before the edge gives up. */
function deadlineProblems(manifests: readonly Manifest[], maxRequestDeadlineMs: number, edgeMs: number): string[] {
  const found = manifests.length === 0 ? ["no route manifest was read"] : [];
  for (const { file, routes } of manifests) {
    for (const route of routes) {
      if ((route.deadlineMs ?? 0) >= edgeMs) found.push(`${file} ${route.path}: deadlineMs ${route.deadlineMs}`);
    }
  }
  if (maxRequestDeadlineMs >= edgeMs) found.push(`REQUEST_DEADLINE_MS max ${maxRequestDeadlineMs}`);
  return found;
}

/** Each way the adapted config, limits.json and the route manifests break the deadline order; empty when they hold. */
export function timeoutProblems(
  config: Json,
  limits: { EDGE_UPSTREAM_TIMEOUT_S?: unknown },
  manifests: readonly Manifest[],
  maxRequestDeadlineMs: number,
): string[] {
  const edgeMs = Number(limits.EDGE_UPSTREAM_TIMEOUT_S) * 1000;
  if (!Number.isFinite(edgeMs) || edgeMs <= 0) return ["limits.json has no EDGE_UPSTREAM_TIMEOUT_S"];
  return [...edgeProblems(config, edgeMs * NS_PER_MS), ...deadlineProblems(manifests, maxRequestDeadlineMs, edgeMs)];
}
