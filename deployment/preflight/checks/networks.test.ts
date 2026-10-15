// P1.30n: networkTableProblems itself refuses a service network no file defines, so P1.29's
// compose_dev_networks_match_table, which calls it directly, catches what loadCompose would.
import { describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { networkTableProblems, pdsNeighbours } from "./networks.ts";

const compose = (yaml: string) => parseCompose(`name: unset-dev\n${yaml}`, "c.yaml");

describe("network table", () => {
  test("undeclared_service_network_is_a_problem", () => {
    const declared = compose("services:\n  web:\n    image: x\n    networks: [front]\nnetworks:\n  front: {}\n");
    const table = new Map([["front", { internal: false, members: ["web"] }]]);
    expect(networkTableProblems(declared, table)).toEqual([]);
    const undeclared = compose(
      "services:\n  web:\n    image: x\n    networks: [front, back]\nnetworks:\n  front: {}\n",
    );
    expect(networkTableProblems(undeclared, table)).toEqual(["network back is not defined"]);
  });
});

describe("the PDS's neighbours (architecture 2026-10-15 02:05Z, option C point 4)", () => {
  // The PDS trusts every private address as a proxy, so only the edge may share a network with its HTTP port.
  const stack = (web: string, pds = "[edge, pds_egress]") =>
    compose(
      `services:\n  edge:\n    image: x\n    networks: [edge, app]\n  pds:\n    image: x\n    networks: ${pds}\n` +
        `  web:\n    image: x\n    networks: ${web}\nnetworks:\n  edge: {}\n  app:\n    internal: true\n  pds_egress: {}\n` +
        "  db:\n    internal: true\n",
    );

  test("only_the_edge_shares_a_network_with_the_pds", () => {
    expect(pdsNeighbours(stack("[db, app]"))).toEqual([]);
    expect(pdsNeighbours(stack("[db, edge]"))).toEqual(["web shares a network with the pds"]);
    expect(pdsNeighbours(stack("[pds_egress]"))).toEqual(["web shares a network with the pds"]);
    // The implicit default network counts too.
    expect(pdsNeighbours(stack("[default]", "[default]"))).toEqual(["web shares a network with the pds"]);
    expect(pdsNeighbours(compose("services:\n  edge:\n    image: x\n  pds:\n    image: x\n"))).toEqual([]);
  });
});
