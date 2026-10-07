// C17 (P1.30t; architecture record 2026-10-07-p130s-networks-and-caddyfile-reader): the stack's networks, their
// `internal` flag and their members are exactly the reviewed table in deployment/networks.<env>.json, in both
// directions, so no service joins a network, and no network opens up, without a reviewed change to the table. The
// comparison is exported for P1.29's compose_dev_networks_match_table, so CI and the deploy gate judge alike.
import { type Compose, networksOf, ParseError, parseStrictData } from "../compose-parse.ts";
import { type Check, fail, missing, pass } from "./types.ts";

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

/** Every difference between Compose's networks and the table; none means they agree. */
export function networkTableProblems(compose: Pick<Compose, "services" | "networks">, table: NetworkTable): string[] {
  const problems: string[] = [];
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

/** C17: no `network_mode` (host, service: or container: would bypass the table), and the networks match the table. */
export const c17: Check = {
  id: "C17",
  run: ({ compose, readText, networkTablePath }) => {
    const moded = compose.services.find((service) => service.networkMode !== null);
    if (moded !== undefined) return fail(`network_mode is set in ${moded.name}`);
    const text = readText(networkTablePath);
    if (text === null) return missing(networkTablePath);
    let table: NetworkTable;
    try {
      table = parseNetworkTable(text, networkTablePath);
    } catch {
      return fail("the network table is unreadable");
    }
    const problems = networkTableProblems(compose, table);
    return problems.length === 0 ? pass() : fail(problems.join("; "));
  },
};
