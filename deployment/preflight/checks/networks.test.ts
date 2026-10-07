// P1.30n: networkTableProblems itself refuses a service network no file defines, so P1.29's
// compose_dev_networks_match_table, which calls it directly, catches what loadCompose would.
import { describe, expect, test } from "vitest";
import { parseCompose } from "../compose-parse.ts";
import { networkTableProblems } from "./networks.ts";

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
