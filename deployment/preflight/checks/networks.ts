// C17 (P1.30t; architecture record 2026-10-07-p130s-networks-and-caddyfile-reader): the stack's networks, their
// `internal` flag and their members are exactly the reviewed table in deployment/networks.<env>.json, in both
// directions, so no service joins a network, and no network opens up, without a reviewed change to the table. The
// comparison is exported for P1.29's compose_dev_networks_match_table, so CI and the deploy gate judge alike.
import { type Compose, networksOf, ParseError, parseStrictData, type Service, TOKEN_READER } from "../compose-parse.ts";
import { isLocalOnlyNetwork, LOCAL_ONLY_NETWORKS } from "../local-only.ts";
import { type Check, type Env, fail, missing, pass } from "./types.ts";

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
 * Every service but the edge that shares a network with the PDS: the PDS trusts every private address as a proxy, so
 * any such neighbour could send it forged forwarding headers (architecture 2026-10-15 02:05Z, option C point 4, in book
 * edit 2026-10-14-p134d-split; step book P1.29, "Networks"). Pinned here, not left to each table.
 */
export function pdsNeighbours(compose: Pick<Compose, "services">): string[] {
  const pds = compose.services.find((service) => service.name === "pds");
  if (pds === undefined) return [];
  return compose.services
    .filter((s) => s.name !== "pds" && s.name !== "edge" && s.networks.some((n) => pds.networks.includes(n)))
    .map((s) => `${s.name} shares a network with the pds`);
}

/**
 * C17: no `network_mode` (host, service: or container: would bypass the table), and the networks match the table. The
 * one exception is `none` on the tools-profile token reader, by its name, which joins no network at all (P1.29h;
 * architecture record 2026-10-13-p129h-local-token-reader, Amendment 1, and its 04:17Z answer on C17).
 */
const noNetworkReader = (service: Service): boolean =>
  service.name === TOKEN_READER && service.networkMode === "none" && service.profiles.includes("tools");

export const c17: Check = {
  id: "C17",
  run: ({ compose, env, readText, networkTablePath }) => {
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
    const problems = [...pdsNeighbours(compose), ...networkTableProblems(compose, expected)];
    return problems.length === 0 ? pass() : fail(problems.join("; "));
  },
};

/** Under dev and prod, the first network only the local stack may have (architecture 02:32Z), or null. */
function localOnlyProblems(compose: Pick<Compose, "networks">, env: Env): string | null {
  if (env === "local") return null;
  const network = compose.networks.find(({ name }) => isLocalOnlyNetwork(name));
  return network === undefined ? null : `network ${network.name} is local only`;
}

/** Under local, the table plus the local-only networks, matched as one; a name in both is the table's to fix. */
function withLocalOnly(table: NetworkTable, env: Env): NetworkTable | string {
  if (env !== "local") return table;
  const clash = [...LOCAL_ONLY_NETWORKS.keys()].find((name) => table.has(name));
  if (clash !== undefined) return `the network table lists ${clash}, a local-only network`;
  return new Map([...table, ...LOCAL_ONLY_NETWORKS]);
}
