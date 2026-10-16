// P1.30n: networkTableProblems itself refuses a service network no file defines, so P1.29's
// compose_dev_networks_match_table, which calls it directly, catches what loadCompose would.
import { describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { networkTableProblems, pdsNeighbours, repository } from "./networks.ts";
import type { Inputs } from "./types.ts";

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
  // The PDS trusts every private address as a proxy, so only the edge may share a network with its HTTP port. Under
  // prod the deploy lock says which image each one is (no base lock here), and no other input is read.
  const LOCK = JSON.stringify({ edge: { ref: "e" }, pds: { ref: "p" } });
  const neighbours = (compose: Inputs["compose"]) =>
    pdsNeighbours({
      env: "prod",
      root: "/repo",
      lockPath: "/repo/lock",
      compose,
      readText: (path: string) => (path === "/repo/lock" ? LOCK : null),
    } as Inputs);
  const HOSTS = '["${APP_HOST}", "${PDS_HOSTNAME}"]';
  const stack = (web: string, pds = "[edge, pds_egress]") =>
    compose(
      `services:\n  edge:\n    image: e\n    networks:\n      edge:\n        aliases: ${HOSTS}\n      app:\n        aliases: ${HOSTS}\n  pds:\n    image: p\n    networks: ${pds}\n` +
        `  web:\n    image: w\n    networks: ${web}\nnetworks:\n  edge: {}\n  app:\n    internal: true\n  pds_egress: {}\n` +
        "  db:\n    internal: true\n",
    );

  test("only_the_edge_shares_a_network_with_the_pds", () => {
    expect(neighbours(stack("[db, app]"))).toEqual([]);
    expect(neighbours(stack("[db, edge]"))).toEqual(["web shares a network with the pds"]);
    expect(neighbours(stack("[pds_egress]"))).toEqual(["web shares a network with the pds"]);
    // The implicit default network counts too.
    expect(neighbours(stack("[default]", "[default]"))).toEqual(["web shares a network with the pds"]);
    expect(neighbours(compose("services:\n  edge:\n    image: e\n  pds:\n    image: p\n"))).toEqual([]);
  });
});

describe("an image's repository (architecture 03:05Z addendum)", () => {
  // Every spelling of one image reduces to one repository, so no form slips past the PDS match.
  test("every_spelling_of_an_image_has_one_repository", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    for (const image of [
      "ghcr.io/bluesky-social/pds",
      "ghcr.io/bluesky-social/pds:0.4.5037",
      `ghcr.io/bluesky-social/pds@${digest}`,
      `ghcr.io/bluesky-social/pds:0.4.5037@${digest}`,
      "GHCR.IO/Bluesky-Social/PDS:0.4.5037",
    ]) {
      expect(repository(image), image).toBe("ghcr.io/bluesky-social/pds");
    }
    for (const image of [
      "node",
      "node:26",
      `library/node@${digest}`,
      "docker.io/node",
      "index.docker.io/library/node:26",
    ]) {
      expect(repository(image), image).toBe("docker.io/library/node");
    }
    expect(repository("example/pds:1")).toBe("docker.io/example/pds");
    expect(repository("localhost/pds")).toBe("localhost/pds");
    expect(repository("registry.example.test:5000/pds:1")).toBe("registry.example.test:5000/pds");
  });

  test("a_pds_in_any_spelling_is_a_pds", () => {
    const LOCK = JSON.stringify({ edge: { ref: "e" }, pds: { ref: "docker.io/example/pds@sha256:aaaa" } });
    const inputs = (image: string) =>
      ({
        env: "prod",
        root: "/repo",
        lockPath: "/repo/lock",
        compose: compose(`services:\n  pds:\n    image: x\n  relay:\n    image: ${image}\n`),
        readText: (path: string) => (path === "/repo/lock" ? LOCK : null),
      }) as Inputs;
    for (const image of [
      "example/pds",
      "Example/PDS:9",
      "index.docker.io/example/pds@sha256:cccc",
      "docker.io/example/pds",
    ]) {
      expect(pdsNeighbours(inputs(image)), image).toEqual(["pds and relay both run the pds"]);
    }
    expect(pdsNeighbours(inputs("example/pds-proxy"))).toEqual(["relay shares a network with the pds"]);
  });
});
