// P1.30n: networkTableProblems itself refuses a service network no file defines, so P1.29's
// compose_dev_networks_match_table, which calls it directly, catches what loadCompose would.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { SecretMap } from "../secret-map.ts";
import { devTunnelProblems, edgeAliasProblems, networkTableProblems, pdsNeighbours, repository } from "./networks.ts";
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
      source: false,
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

describe("the dev edge's tunnel (P1.36i; ADR 0031 Decision 3)", () => {
  // Under dev both staging names resolve through public DNS to Pangolin, so the edge answers to no name inside the
  // stack, and net-guard keeps no internal-host exception.
  const HOSTS = '["${APP_HOST}", "${PDS_HOSTNAME}"]';
  const edge = (networks: string) => `  edge:\n    image: e\n    networks:\n${networks}`;
  const BARE = "      edge: {}\n      app: {}\n";
  const ALIASED = `      edge:\n        aliases: ${HOSTS}\n      app:\n        aliases: ${HOSTS}\n`;
  const web = (hosts: string) => `  web:\n    image: w\n    environment:\n      NETGUARD_INTERNAL_HOSTS: ${hosts}\n`;
  const stack = (networks: string, extra = "") =>
    compose(`services:\n${edge(networks)}${extra}networks:\n  edge: {}\n  app:\n    internal: true\n`);
  /** `files` stands for each service's merged environment, env files included, as loadInputs builds it. */
  const tunnel = (
    env: Inputs["env"],
    composed: Inputs["compose"],
    files: Record<string, Record<string, string>> = {},
  ) =>
    devTunnelProblems({
      env,
      compose: composed,
      serviceEnv: new Map(Object.entries(files).map(([name, values]) => [name, new SecretMap(Object.entries(values))])),
    });

  test("dev_edge_carries_no_alias", () => {
    expect(tunnel("dev", stack(BARE))).toEqual([]);
    expect(tunnel("dev", stack(ALIASED))).toEqual(["the edge carries a network alias"]);
    // Local keeps both aliases for its own stack; prod is not this check's.
    expect(tunnel("local", stack(ALIASED))).toEqual([]);
    expect(tunnel("prod", stack(ALIASED))).toEqual([]);
  });

  test("outside_dev_the_edge_carries_its_aliases", () => {
    // P1.37 follow-up: the parser refuses an edge aliased on one of edge and app but not the other; a fully bare edge
    // passes it, so outside dev this refuses that case. Local web and the PDS reach both hosts only by these aliases.
    const bare = ["the edge carries no alias on its networks"];
    expect(edgeAliasProblems({ env: "local", compose: stack(BARE) })).toEqual(bare);
    expect(edgeAliasProblems({ env: "prod", compose: stack(BARE) })).toEqual(bare);
    expect(edgeAliasProblems({ env: "local", compose: stack(ALIASED) })).toEqual([]);
    expect(edgeAliasProblems({ env: "dev", compose: stack(BARE) })).toEqual([]);
  });

  test("dev_names_no_internal_host", () => {
    expect(tunnel("dev", stack(BARE, web('""')))).toEqual([]);
    const named = ["a service names an internal host for net-guard"];
    expect(tunnel("dev", stack(BARE, web("staging.unset.ac")))).toEqual(named);
    expect(tunnel("dev", stack(BARE, web("${PDS_HOSTNAME}")))).toEqual(named);
    expect(tunnel("local", stack(BARE, web("${PDS_HOSTNAME}")))).toEqual([]);
    // A value from an env file reaches the container too (verify-1145 B1): read from the merged environment.
    const none = stack(BARE);
    expect(tunnel("dev", none, { web: { NETGUARD_INTERNAL_HOSTS: "staging.unset.ac" } })).toEqual(named);
    expect(tunnel("dev", none, { pds: { NETGUARD_INTERNAL_HOSTS: "x" } })).toEqual(named);
    expect(tunnel("dev", none, { web: { NETGUARD_INTERNAL_HOSTS: "", PLC_URL: "https://plc.directory" } })).toEqual([]);
    expect(tunnel("local", none, { web: { NETGUARD_INTERNAL_HOSTS: "staging.unset.ac" } })).toEqual([]);
  });

  test("the_dev_and_local_compose_files_pass", () => {
    const file = (name: string) => parseCompose(readFileSync(new URL(`../../${name}`, import.meta.url), "utf8"), name);
    expect(tunnel("dev", file("compose.dev.yaml"))).toEqual([]);
    expect(file("compose.local.yaml").edgeAliasNetworks).toEqual(["edge", "app"]);
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
        source: false,
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
