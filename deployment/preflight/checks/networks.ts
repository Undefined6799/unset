// C17 (P1.30t; architecture record 2026-10-07-p130s-networks-and-caddyfile-reader): the stack's networks, their
// `internal` flag and their members are exactly the reviewed table in deployment/networks.<env>.json, in both
// directions, so no service joins a network, and no network opens up, without a reviewed change to the table. The
// comparison is exported for P1.29's compose_dev_networks_match_table, so CI and the deploy gate judge alike.
import { type Compose, networksOf, ParseError, parseStrictData, type Service, TOKEN_READER } from "../compose-parse.ts";
import { DEV_ONLY_NETWORKS, isLocalOnlyNetwork, LOCAL_ONLY_NETWORKS } from "../local-only.ts";
import type { SecretMap } from "../secret-map.ts";
import { runsBuilt } from "./build.ts";
import { readBases, readLock } from "./lock.ts";
import { type Check, type Env, fail, type Inputs, missing, pass } from "./types.ts";

export type NetworkTable = ReadonlyMap<string, { internal: boolean; members: readonly string[] }>;

/** The table, under the strict YAML subset (JSON is YAML 1.2, and a duplicate key is refused, not resolved). */
export function parseNetworkTable(text: string, file: string): NetworkTable {
  const data = parseStrictData(text, file);
  const refuse = (why: string): never => {
    throw new ParseError(`${file}: ${why}`);
  };
  if (typeof data !== "object" || data === null || Array.isArray(data)) return refuse("not an object");
  return new Map(
    Object.entries(data).map(([name, row]) => {
      if (typeof row !== "object" || row === null || Array.isArray(row)) return refuse(`${name} is not an object`);
      const { internal, members, ...rest } = row as Record<string, unknown>;
      if (Object.keys(rest).length > 0) refuse(`${name} has a key other than internal and members`);
      if (typeof internal !== "boolean") refuse(`${name}: internal is not true or false`);
      if (!Array.isArray(members) || !members.every((m) => typeof m === "string")) refuse(`${name}: bad members`);
      if (new Set(members as string[]).size !== (members as string[]).length) refuse(`${name} repeats a member`);
      return [name, { internal: internal as boolean, members: members as string[] }];
    }),
  );
}

/**
 * Every service network no file defines. `docker compose config` accepts one and `up` then fails, so loadCompose
 * refuses it too.
 */
export function undeclaredNetworks(compose: Pick<Compose, "services" | "networks">): string[] {
  const used = [...new Set(compose.services.flatMap((service) => service.networks))];
  return used
    .filter((network) => network !== "default" && !compose.networks.some((n) => n.name === network))
    .map((network) => `network ${network} is not defined`);
}

/** Every difference between Compose's networks and the table; none means they agree. */
export function networkTableProblems(compose: Pick<Compose, "services" | "networks">, table: NetworkTable): string[] {
  const problems = undeclaredNetworks(compose);
  for (const network of networksOf(compose)) {
    const row = table.get(network.name);
    if (row === undefined) {
      problems.push(`network ${network.name} is not in the table`);
      continue;
    }
    if (row.internal !== network.internal) problems.push(`${network.name}: internal differs`);
    const members = compose.services.filter((s) => s.networks.includes(network.name)).map((s) => s.name);
    for (const service of members) {
      if (!row.members.includes(service)) problems.push(`${service} is on ${network.name}, the table says not`);
    }
    for (const service of row.members) {
      if (!members.includes(service)) problems.push(`${service} is not on ${network.name}, the table says it is`);
    }
  }
  for (const name of table.keys()) {
    if (!networksOf(compose).some((network) => network.name === name)) problems.push(`${name} is not in compose`);
  }
  return problems;
}

/**
 * Every service but the edge that shares a network with a PDS: the PDS trusts every private address as a proxy, so
 * any such neighbour could send it forged forwarding headers (architecture 2026-10-15 02:05Z, option C point 4, in book
 * edit 2026-10-14-p134d-split; step book P1.29, "Networks"). Pinned here, not left to each table.
 *
 * Services are known by the image they run, never by name alone (architecture 2026-10-15 03:05Z, F3, last section of
 * book edit 2026-10-13-local-plc-a4-steps): a PDS is any service named pds or running the locked PDS image, from any
 * tag or digest, or built from the PDS Dockerfile (dev --source and local, P1.37y; Codex on #1309), and more than one
 * fails; the edge is the service running the edge image as C25 knows it (runsBuilt).
 * The edge is the only neighbour allowed: ADR 0022 retired the local PLC and its plc_pds exemption (P1.35w).
 */
export function pdsNeighbours(inputs: Inputs): string[] {
  const { services } = inputs.compose;
  const bases = readBases(inputs) ?? {};
  const lock = inputs.env === "local" ? {} : (readLock(inputs) ?? {});
  const pdsImages = new Set([bases.pds?.ref, lock.pds?.ref].filter((ref) => typeof ref === "string").map(repository));
  const builtPds = (s: Service) => s.build !== null && runsBuilt(s, inputs, undefined, PDS_DOCKERFILE) === "yes";
  const pdses = services.filter(
    (s) => s.name === "pds" || (s.image !== null && pdsImages.has(repository(s.image))) || builtPds(s),
  );
  if (pdses.length > 1) return [`${pdses.map((s) => s.name).join(" and ")} both run the pds`];
  const [pds] = pdses;
  if (pds === undefined) return [];
  const isEdge = (s: Service) => runsBuilt(s, inputs, lock.edge?.ref, EDGE_DOCKERFILE) === "yes";
  const allowed = (s: Service, network: string) => !pds.networks.includes(network) || isEdge(s);
  return services
    .filter((s) => s !== pds && !s.networks.every((network) => allowed(s, network)))
    .map((s) => `${s.name} shares a network with the pds`);
}

const EDGE_DOCKERFILE = "deployment/edge/Dockerfile";
/** The Dockerfile a built PDS runs from (compose.local.yaml and compose.dev.source.yaml). */
const PDS_DOCKERFILE = "deployment/pds/Dockerfile";

/**
 * Under dev the PDS and web reach both staging names only through Pangolin, Newt and the edge (ADR 0031 Decision 3;
 * P1.36i): the edge carries no alias on any network, and no service names an internal host for net-guard, so net-guard
 * keeps no exception on staging. The host list is read from the environment each container gets, its env files
 * included, as C29 reads keys. Local keeps both; prod is untouched here. The reasons are fixed words: a network or
 * service name, or "dev", can be a configured value, which would withhold the whole reason (P1.30m).
 */
export function devTunnelProblems(inputs: Pick<Inputs, "compose" | "env" | "serviceEnv">): string[] {
  if (inputs.env !== "dev") return [];
  const problems: string[] = [];
  if (inputs.compose.edgeAliasNetworks.length > 0) problems.push("the edge carries a network alias");
  const named = (env: SecretMap) => env.use(INTERNAL_HOSTS, (hosts) => hosts !== undefined && hosts !== "");
  const inCompose = inputs.compose.services.some((service) => {
    const hosts = service.environment.find(([key]) => key === INTERNAL_HOSTS)?.[1];
    return hosts !== undefined && !("literal" in hosts && hosts.literal === "");
  });
  if (inCompose || [...inputs.serviceEnv.values()].some(named)) {
    problems.push("a service names an internal host for net-guard");
  }
  return problems;
}

const INTERNAL_HOSTS = "NETGUARD_INTERNAL_HOSTS";

/** The networks on which the edge carries its two host aliases outside dev (compose-parse.ts ALIAS_NETWORKS). */
const ALIAS_NETWORKS = ["edge", "app"];

/**
 * Outside dev, an edge on the edge or app network carries its aliases there (P1.29a Amendment 1; P1.37 follow-up of
 * P1.36i): local web and the PDS reach both hosts only by them. The parser already refuses an edge aliased on one of
 * the two and not the other, so this refuses the fully bare edge it lets through. Fixed words, as above.
 */
export function edgeAliasProblems({ compose, env }: Pick<Inputs, "compose" | "env">): string[] {
  if (env === "dev") return [];
  const edge = compose.services.find((service) => service.name === "edge");
  const joined = edge?.networks.some((network) => ALIAS_NETWORKS.includes(network)) ?? false;
  return joined && compose.edgeAliasNetworks.length === 0 ? ["the edge carries no alias on its networks"] : [];
}

/**
 * An image reference reduced to its repository, the image a service runs whatever version, in the one form every
 * spelling of it shares (architecture 03:05Z addendum): lower case, no digest, no tag, and Docker Hub's default
 * registry and `library/` namespace written out, as the Docker CLI resolves a short name (distribution/reference
 * github.com/distribution/reference v0.6.0 normalize.go:126-165, splitDockerDomain: a first part with no `.` or `:`
 * and other than `localhost` is a Docker Hub path). Lower-casing all of it can only make more spellings match, so a PDS
 * is never missed; the edge exemption never uses this, only exact identity.
 */
export const repository = (image: string): string => {
  const name = image
    .toLowerCase()
    .replace(/@.*$/, "")
    .replace(/:[^/:]*$/, "");
  const [first = "", ...rest] = name.split("/");
  const hosted = rest.length > 0 && (first.includes(".") || first.includes(":") || first === "localhost");
  const [registry, path] = hosted ? [first, rest] : ["docker.io", [first, ...rest]];
  const hub = registry === "docker.io" || registry === "index.docker.io" || registry === "registry-1.docker.io";
  if (!hub) return `${registry}/${path.join("/")}`;
  return `docker.io/${path.length === 1 ? "library/" : ""}${path.join("/")}`;
};

/**
 * C17: no `network_mode` (host, service: or container: would bypass the table), and the networks match the table. The
 * one exception is `none` on the tools-profile token reader, by its name, which joins no network at all (P1.29h;
 * architecture record 2026-10-13-p129h-local-token-reader, Amendment 1, and its 04:17Z answer on C17).
 */
const noNetworkReader = (service: Service): boolean =>
  service.name === TOKEN_READER && service.networkMode === "none" && service.profiles.includes("tools");

export const c17: Check = {
  id: "C17",
  run: (inputs) => {
    const { compose, env, readText, networkTablePath } = inputs;
    const moded = compose.services.find((service) => service.networkMode !== null && !noNetworkReader(service));
    if (moded !== undefined) return fail(`network_mode is set in ${moded.name}`);
    const text = readText(networkTablePath);
    if (text === null) return missing(networkTablePath);
    let table: NetworkTable;
    try {
      table = parseNetworkTable(text, networkTablePath);
    } catch {
      return fail("the network table is unreadable");
    }
    const local = localOnlyProblems(compose, env);
    if (local !== null) return fail(local);
    const expected = withLocalOnly(table, env);
    if (typeof expected === "string") return fail(expected);
    const problems = [
      ...pdsNeighbours(inputs),
      ...devTunnelProblems(inputs),
      ...edgeAliasProblems(inputs),
      ...networkTableProblems(compose, expected),
    ];
    return problems.length === 0 ? pass() : fail(problems.join("; "));
  },
};

/** Under dev and prod, the first network only the local stack may have (architecture 02:32Z), or null. */
function localOnlyProblems(compose: Pick<Compose, "networks">, env: Env): string | null {
  if (env === "local") return null;
  const network = compose.networks.find(({ name }) => isLocalOnlyNetwork(name));
  return network === undefined ? null : `network ${network.name} is local only`;
}

/**
 * Under local, the table without the dev-only networks and plus the local-only ones, matched as one. The table never
 * lists a local-only network, listed or `plc_*`, under any env (architecture 02:32Z: networks.dev.json gets no
 * local-only rows; verify-903 S3).
 */
function withLocalOnly(table: NetworkTable, env: Env): NetworkTable | string {
  const clash = [...table.keys()].find(isLocalOnlyNetwork);
  if (clash !== undefined) return `the network table lists ${clash}, a local-only network`;
  if (env !== "local") return table;
  return new Map([...[...table].filter(([name]) => !DEV_ONLY_NETWORKS.has(name)), ...LOCAL_ONLY_NETWORKS]);
}
