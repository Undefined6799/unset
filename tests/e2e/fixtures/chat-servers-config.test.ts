// What chat-servers-config.ts takes from the stack's own files: the config with only the chat domain changed, the chat
// networks and addresses compose gives synapse and mas, the listeners the spec is pointed at, and MAS from our mirror.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { chatNetworks, endpoints, masImage, SERVER_NAME, withServerName } from "./chat-servers-config.ts";

const DEPLOYMENT = join(import.meta.dirname, "..", "..", "..", "deployment");
const read = (...path: string[]) => readFileSync(join(DEPLOYMENT, ...path), "utf8");
const HOMESERVER = read("chat", "dev", "homeserver.yaml");
const MAS = read("chat", "dev", "mas.yaml");

describe("chat servers for e2e (P6.02)", () => {
  test("only_the_chat_domain_changes_in_the_stack_config", () => {
    const { homeserver, mas } = withServerName(HOMESERVER, MAS);
    const before = { hs: parse(HOMESERVER), mas: parse(MAS) };
    const after = { hs: parse(homeserver), mas: parse(mas) };
    expect(after.hs.server_name).toBe(SERVER_NAME);
    expect(after.hs.public_baseurl).toBe(`https://${SERVER_NAME}/`);
    expect(after.mas.matrix.homeserver).toBe(SERVER_NAME);
    expect({ ...after.hs, server_name: 0, public_baseurl: 0 }).toEqual({
      ...before.hs,
      server_name: 0,
      public_baseurl: 0,
    });
    expect({ ...after.mas, matrix: { ...after.mas.matrix, homeserver: 0 } }).toEqual({
      ...before.mas,
      matrix: { ...before.mas.matrix, homeserver: 0 },
    });
  });

  test("a_config_that_no_longer_names_the_staging_domain_stops_the_start", () => {
    expect(() => withServerName(HOMESERVER.replace("server_name: staging.unset.cc", "server_name: x"), MAS)).toThrow(
      /server_name/,
    );
    expect(() => withServerName(HOMESERVER, MAS.replace("homeserver: staging.unset.cc", "homeserver: x"))).toThrow(
      /homeserver/,
    );
  });

  test("the_networks_and_addresses_are_composes", () => {
    const { networks, synapse, mas, postgres } = chatNetworks(read("compose.dev.source.yaml"));
    expect(synapse).toContainEqual({ network: "chat_edge_synapse", address: "10.250.38.51" });
    expect(synapse).toContainEqual({ network: "chat_mas", address: "10.250.38.2" });
    expect(mas).toContainEqual({ network: "chat_admin_mas", address: "10.250.38.11" });
    expect(postgres.map((a) => a.network).sort()).toEqual(["chat_db", "chat_synapse_db"]);
    expect(networks.chat_mas).toEqual({ internal: true, subnet: "10.250.38.0/29" });
    for (const spec of Object.values(networks)) expect(spec.internal).toBe(true);
    // Every address a listener binds is one compose gives the process.
    const given = new Set([...synapse, ...mas].map((a) => a.address));
    for (const address of parse(HOMESERVER).listeners.flatMap((l: { bind_addresses: string[] }) => l.bind_addresses))
      expect(given).toContain(address);
    for (const listener of parse(MAS).http.listeners as { binds: { address: string }[] }[])
      expect(given).toContain(listener.binds[0]?.address.split(":")[0]);
  });

  test("the_spec_is_pointed_at_synapses_client_listener_and_mas_chat_admin_listener", () => {
    expect(endpoints(HOMESERVER, MAS)).toEqual({
      synapse: "http://10.250.38.51:8008",
      mas: "http://10.250.38.11:8081",
      masAdmin: "http://10.250.38.11:8081",
      masHealth: "http://10.250.38.3:8080/health",
      clientId: parse(MAS).policy.data.admin_clients[0],
    });
  });

  test("mas_comes_from_our_mirror_by_the_locked_digest", () => {
    const lock = JSON.parse(read("images", "bases.lock.json")) as Record<string, { digest: string }>;
    expect(masImage()).toBe(`ghcr.io/undefined6799/mirror/matrix-authentication-service@${lock.mas?.digest}`);
    expect(read("compose.dev.source.yaml")).toContain(`image: ${masImage()}`);
  });
});
