// C36 (P6.02; ADR 0086): the chat servers' config files hold the build plan's step 1 values, and a stack that runs
// Synapse or MAS reads exactly the reviewed file, with no setting riding in beside it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { parseCompose } from "../compose-parse.ts";
import { c36, masProblem, readStrict, synapseProblem } from "./chat.ts";
import type { Env, Inputs } from "./types.ts";

const CHAT = join(import.meta.dirname, "../../chat/dev");
const text = (file: string) => readFileSync(join(CHAT, file), "utf8");
const SERVER = "staging.unset.cc";
type Doc = Record<string, unknown>;
const synapse = () => parse(text("homeserver.yaml")) as Doc;
const mas = () => parse(text("mas.yaml")) as Doc;

/** The document with the value at `path` replaced, or removed when `value` is undefined. */
function edited(doc: Doc, path: string, value: unknown): Doc {
  const copy = structuredClone(doc);
  const keys = path.split(".");
  let at = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
  const last = keys.at(-1) as string;
  if (value === undefined) delete at[last];
  else at[last] = value;
  return copy;
}

describe("C36 the chat servers' settings", () => {
  test("committed_dev_configs_pass", () => {
    expect(synapseProblem(synapse(), SERVER)).toBeNull();
    expect(masProblem(mas(), SERVER)).toBeNull();
  });

  test("each_wrong_synapse_value_is_refused", () => {
    const cases: [string, unknown][] = [
      ["server_name", "unset.cc"],
      ["public_baseurl", "https://unset.cc/"],
      ["federation_domain_whitelist", ["matrix.org"]],
      ["federation_domain_whitelist", undefined],
      ["enable_registration", true],
      ["allow_guest_access", true],
      ["encryption_enabled_by_default_for_room_type", "invite"],
      // "all" would encrypt the plain kind too; the server rule encrypts every other room (P6.10a).
      ["encryption_enabled_by_default_for_room_type", "all"],
      ["encryption_enabled_by_default_for_room_type", undefined],
      ["enable_search", true],
      ["enable_search", undefined],
      ["retention", undefined],
      ["retention.enabled", false],
      // A default policy would purge encrypted rooms' history too; the cap is 30 days and nothing longer.
      ["retention.default_policy", { max_lifetime: "30d" }],
      ["retention.allowed_lifetime_max", "1y"],
      ["retention.allowed_lifetime_max", undefined],
      ["retention.allowed_lifetime_min", "1d"],
      ["retention.purge_jobs", undefined],
      ["retention.purge_jobs", [{ interval: "12h", shortest_max_lifetime: "3d" }]],
      ["enable_set_displayname", true],
      ["enable_set_avatar_url", true],
      ["allow_per_room_profiles", true],
      ["require_auth_for_profile_requests", false],
      ["limit_profile_requests_to_users_who_share_rooms", false],
      ["allow_profile_lookup_over_federation", true],
      ["user_directory", { enabled: true }],
      ["url_preview_enabled", true],
      ["user_ips_max_age", "28d"],
      ["report_stats", true],
      ["trusted_key_servers", [{ server_name: "matrix.org" }]],
      ["log_config", "/data/log.yaml"],
      ["matrix_authentication_service", { enabled: false }],
      ["matrix_authentication_service.endpoint", "http://elsewhere:8080/"],
    ];
    for (const [path, value] of cases) {
      const top = path.split(".")[0];
      expect(synapseProblem(edited(synapse(), path, value), SERVER), path).toBe(
        `homeserver.yaml: ${top} is not its reviewed value`,
      );
    }
  });

  test("synapse_listener_is_one_client_listener_without_forwarded_trust", () => {
    const [listener] = synapse().listeners as Doc[];
    for (const change of [
      { x_forwarded: true },
      { resources: [{ names: ["client", "federation"], compress: false }] },
      { resources: [{ names: ["client", "openid"], compress: false }] },
      { type: "metrics" },
    ]) {
      expect(synapseProblem(edited(synapse(), "listeners", [{ ...listener, ...change }]), SERVER)).toBe(
        "homeserver.yaml: listeners is not its reviewed value",
      );
    }
    const second = { ...listener, port: 8448, resources: [{ names: ["federation"] }] };
    expect(synapseProblem(edited(synapse(), "listeners", [listener, second]), SERVER)).toBe(
      "homeserver.yaml: listeners is not its reviewed value",
    );
  });

  test("synapse_loads_exactly_the_server_rule", () => {
    // The rule is the only guarantee that a room not asked for as plain is encrypted, so no stack runs without it.
    const rule = { module: "unset_chat_policy.RoomPolicy", config: {} };
    const reason = "homeserver.yaml: modules is not its reviewed value";
    for (const modules of [
      undefined,
      [],
      [{ ...rule, config: { allow_plain: true } }],
      [rule, { module: "other.Module", config: {} }],
      [{ module: "unset_chat_policy.Other", config: {} }],
      [{ module: "unset_chat_policy.EncryptedOnly", config: {} }],
      [{ module: "unset_chat_policy.RoomPolicy" }],
    ]) {
      expect(synapseProblem(edited(synapse(), "modules", modules), SERVER), JSON.stringify(modules)).toBe(reason);
    }
  });

  test("synapse_reaches_only_the_door_count_port_and_sends_no_message_content", () => {
    // Build step 10 (ADR 0082 decision 2, ADR 0090 decision 2): a pusher's URL is set by the browser, so the one private
    // address Synapse may post to is the door's count port; and a push never carries a message's body or sender.
    const ranges = "homeserver.yaml: ip_range_whitelist is not its reviewed value";
    for (const value of [undefined, [], ["10.250.38.16/29"], ["10.250.38.19", "10.250.38.3"], ["10.0.0.0/8"]])
      expect(synapseProblem(edited(synapse(), "ip_range_whitelist", value), SERVER), JSON.stringify(value)).toBe(
        ranges,
      );
    const push = "homeserver.yaml: push is not its reviewed value";
    for (const [path, value] of [
      ["push", undefined],
      ["push.include_content", true],
      ["push.group_unread_count_by_room", false],
      ["push.enabled", false],
    ] as const)
      expect(synapseProblem(edited(synapse(), path, value), SERVER), path).toBe(push);
    expect(synapse().ip_range_whitelist).toEqual(["10.250.38.19"]);
  });

  test("synapse_config_is_read_as_its_yaml_reads_it", () => {
    // Synapse's PyYAML reads YAML 1.1, where a bare `off` is the boolean false, which Synapse refuses or misreads; only
    // the quoted "off" is the string Synapse's room config takes (config_documentation.md:4049 at v1.165.0).
    const committed = text("homeserver.yaml");
    expect(synapseProblem(readStrict(committed, "1.1"), SERVER)).toBeNull();
    const bare = committed.replace(
      'encryption_enabled_by_default_for_room_type: "off"',
      "encryption_enabled_by_default_for_room_type: off",
    );
    expect(bare).not.toBe(committed);
    expect(synapseProblem(readStrict(bare, "1.1"), SERVER)).toBe(
      "homeserver.yaml: encryption_enabled_by_default_for_room_type is not its reviewed value",
    );
  });

  test("synapse_refuses_unreviewed_settings_and_inline_secrets", () => {
    for (const key of ["oidc_providers", "app_service_config_files", "macaroon_secret_key", "form_secret"]) {
      expect(synapseProblem(edited(synapse(), key, "x"), SERVER), key).toBe(
        "homeserver.yaml: a setting the preflight does not allow",
      );
    }
    const inline = edited(synapse(), "matrix_authentication_service.secret", "s");
    expect(synapseProblem(inline, SERVER)).toBe(
      "homeserver.yaml: matrix_authentication_service is not its reviewed value",
    );
    expect(synapseProblem(edited(synapse(), "database.args.password", "p"), SERVER)).toBe(
      "homeserver.yaml: database holds a password; it comes from a passfile",
    );
    expect(synapseProblem(edited(synapse(), "database.name", "sqlite3"), SERVER)).toBe(
      "homeserver.yaml: database is not Postgres",
    );
    expect(synapseProblem(edited(synapse(), "form_secret_path", "/config/form"), SERVER)).toBe(
      "homeserver.yaml: form_secret_path is not a mounted secret",
    );
  });

  test("each_wrong_mas_value_is_refused", () => {
    const cases: [string, unknown][] = [
      ["passwords", { enabled: true }],
      ["account", { displayname_change_allowed: true, account_deactivation_allowed: false }],
      ["account", { displayname_change_allowed: false, account_deactivation_allowed: true }],
      ["matrix.homeserver", "unset.cc"],
      ["matrix.endpoint", "http://elsewhere:8008/"],
      ["matrix.secret", "inline"],
      ["http.trusted_proxies", undefined],
      ["http.trusted_proxies", ["10.0.0.0/8"]],
      ["http.public_base", "https://mas.unset.cc/"],
    ];
    for (const [path, value] of cases) {
      const top = path.split(".")[0];
      expect(masProblem(edited(mas(), path, value), SERVER), path).toBe(`mas.yaml: ${top} is not its reviewed value`);
    }
  });

  test("mas_has_internal_listeners_only", () => {
    const [forSynapse, forAdmin] = (mas().http as Doc).listeners as [Doc, Doc];
    const listeners = (a: unknown, b: unknown) => edited(mas(), "http.listeners", [a, b]);
    const reason = "mas.yaml: http is not its reviewed value";
    // A login page, the GraphQL API, assets or the compatibility layer mounted anywhere.
    for (const extra of ["human", "graphql", "assets", "compat"]) {
      const more = { ...forSynapse, resources: [...(forSynapse.resources as Doc[]), { name: extra }] };
      expect(masProblem(listeners(more, forAdmin), SERVER), extra).toBe(reason);
    }
    // The admin API on Synapse's listener, or a listener on every address.
    const admin = { ...forSynapse, resources: [...(forSynapse.resources as Doc[]), { name: "adminapi" }] };
    expect(masProblem(listeners(admin, forAdmin), SERVER)).toBe(reason);
    expect(masProblem(listeners(forSynapse, { ...forAdmin, binds: [{ address: "[::]:8081" }] }), SERVER)).toBe(reason);
    expect(masProblem(edited(mas(), "http.listeners", [forSynapse]), SERVER)).toBe(reason);
  });

  test("mas_has_one_admin_client_and_no_way_to_log_in", () => {
    for (const key of ["upstream_oauth2", "email", "experimental", "captcha"]) {
      expect(masProblem(edited(mas(), key, {}), SERVER), key).toBe("mas.yaml: a setting the preflight does not allow");
    }
    const [client] = mas().clients as Doc[];
    const other = { ...client, client_id: "01M7XSE66CYPNSDBAK0KZR45NN" };
    expect(masProblem(edited(mas(), "clients", [client, other]), SERVER)).toBe(
      "mas.yaml: clients is not one admin client",
    );
    expect(masProblem(edited(mas(), "clients", [{ ...client, client_secret: "s" }]), SERVER)).toBe(
      "mas.yaml: clients is not one admin client",
    );
    expect(masProblem(edited(mas(), "clients", [{ ...client, client_auth_method: "none" }]), SERVER)).toBe(
      "mas.yaml: clients is not one admin client",
    );
    expect(masProblem(edited(mas(), "policy.data.admin_clients", [other.client_id]), SERVER)).toBe(
      "mas.yaml: policy is not exactly the admin client",
    );
    expect(masProblem(edited(mas(), "policy.data.admin_clients", [client?.client_id, other.client_id]), SERVER)).toBe(
      "mas.yaml: policy is not exactly the admin client",
    );
  });

  test("mas_secrets_come_from_files", () => {
    expect(masProblem(edited(mas(), "database.password", "p"), SERVER)).toBe(
      "mas.yaml: database is not its reviewed shape",
    );
    expect(masProblem(edited(mas(), "database.uri", "postgresql://u:p@h/d"), SERVER)).toBe(
      "mas.yaml: database is not its reviewed shape",
    );
    expect(masProblem(edited(mas(), "secrets.encryption", "00"), SERVER)).toBe("mas.yaml: secrets is not file-only");
    expect(masProblem(edited(mas(), "secrets.keys", [{ key: "PEM" }]), SERVER)).toBe(
      "mas.yaml: secrets is not file-only",
    );
  });

  test("synapse_access_log_is_dropped", () => {
    const log = parse(text("log.yaml")) as { loggers: Record<string, Doc>; root: Doc };
    expect(log.loggers["synapse.access.http"]).toEqual({ handlers: [], propagate: false });
    expect(log.root.level).toBe("WARNING");
  });
});

const SYNAPSE_SERVICE = [
  "  synapse:",
  "    image: s",
  "    volumes:",
  "      - ./chat/dev/homeserver.yaml:/config/homeserver.yaml:ro",
  "",
].join("\n");
const MAS_SERVICE = [
  "  mas:",
  "    image: m",
  "    environment:",
  "      MAS_CONFIG: /config/mas.yaml",
  "    volumes:",
  "      - ./chat/dev/mas.yaml:/config/mas.yaml:ro",
  "    networks:",
  "      chat_db:",
  "      chat_mas:",
  "        ipv4_address: 10.250.38.3",
  "      chat_admin_mas:",
  "        ipv4_address: 10.250.38.11",
  "",
].join("\n");
/** The chat networks as ADR 0086 Decision 4 has them: fixed subnets, every one internal. */
const CHAT_NETWORKS = [
  "networks:",
  "  chat_db:",
  "    internal: true",
  "  chat_mas:",
  "    internal: true",
  "    ipam:",
  "      config:",
  "        - subnet: 10.250.38.0/29",
  "  chat_admin_mas:",
  "    internal: true",
  "    ipam:",
  "      config:",
  "        - subnet: 10.250.38.8/29",
  "",
].join("\n");
const OTHER = "  web:\n    image: w\n";

const run = (services: string, env: Env = "dev", networks = CHAT_NETWORKS) => {
  const compose = parseCompose(`name: unset-dev\nservices:\n${services}${networks}`, "/repo/deployment/c.yaml");
  // As loadCompose hands them over: each bind source resolved against the project directory (inputs.ts).
  for (const service of compose.services)
    service.mounts = service.mounts.map((m) =>
      m.type === "bind" && m.source !== null ? { ...m, source: join(CHAT, "../..", m.source) } : m,
    );
  const readRegular = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  return c36.run({ env, compose, readRegular } as unknown as Inputs, AbortSignal.timeout(1000));
};

describe("C36 the chat services", () => {
  test("a_stack_with_the_reviewed_files_or_no_chat_passes", async () => {
    expect(await run(SYNAPSE_SERVICE + MAS_SERVICE + OTHER)).toEqual({ pass: true, reason: "ok" });
    expect(await run(OTHER)).toEqual({ pass: true, reason: "ok" });
    expect(await run(OTHER, "local")).toEqual({ pass: true, reason: "ok" });
  });

  test("a_chat_service_without_a_ruled_server_name_fails", async () => {
    expect(await run(SYNAPSE_SERVICE, "local")).toEqual({
      pass: false,
      reason: "no chat server name is ruled for this environment",
    });
    // The dev files name the staging server, so the production name refuses them.
    expect((await run(SYNAPSE_SERVICE, "prod")).reason).toBe("homeserver.yaml: server_name is not its reviewed value");
  });

  test("the_config_is_the_one_mounted_file_and_no_override_rides_in", async () => {
    // Our image starts Synapse with its config path fixed (synapse.Dockerfile ENTRYPOINT), so nothing is set beside it.
    for (const setting of [
      "SYNAPSE_CONFIG_PATH: /config/homeserver.yaml",
      "SYNAPSE_WORKER: synapse.app.generic_worker",
    ]) {
      const extra = SYNAPSE_SERVICE.replace("    volumes:", `    environment:\n      ${setting}\n    volumes:`);
      expect(await run(extra)).toEqual({ pass: false, reason: "synapse sets an environment variable" });
    }
    const override = MAS_SERVICE.replace("    volumes:", '      MAS_PASSWORDS_ENABLED: "true"\n    volumes:');
    expect(await run(override)).toEqual({ pass: false, reason: "mas sets a name other than its config path" });
    const two = MAS_SERVICE.replace("MAS_CONFIG: /config/mas.yaml", "MAS_CONFIG: /config/mas.yaml:/config/more.yaml");
    expect(await run(two)).toEqual({ pass: false, reason: "mas does not read exactly its reviewed config path" });
    const envFile = MAS_SERVICE.replace("    volumes:", "    env_file: ./mas.env\n    volumes:");
    expect(await run(envFile)).toEqual({ pass: false, reason: "mas reads an env file" });
    const unmounted = SYNAPSE_SERVICE.replace(
      "      - ./chat/dev/homeserver.yaml:/config/homeserver.yaml:ro\n",
      "      - ./x:/x:ro\n",
    );
    expect(await run(unmounted)).toEqual({ pass: false, reason: "synapse does not mount its config read-only once" });
    const writable = SYNAPSE_SERVICE.replace("homeserver.yaml:ro", "homeserver.yaml");
    expect(await run(writable)).toEqual({ pass: false, reason: "synapse does not mount its config read-only once" });
    const absent = SYNAPSE_SERVICE.replace("./chat/dev/homeserver.yaml:", "./chat/dev/none.yaml:");
    expect((await run(absent)).reason).toMatch(/^input missing: /);
  });
});

describe("C36 MAS's networks", () => {
  const ADMIN = "  chat-admin:\n    image: a\n    networks: [chat_admin_mas]\n";

  test("mas_binds_its_fixed_address_on_each_internal_network", async () => {
    expect(await run(MAS_SERVICE + ADMIN + OTHER)).toEqual({ pass: true, reason: "ok" });
    const moved = MAS_SERVICE.replace("ipv4_address: 10.250.38.11", "ipv4_address: 10.250.38.12");
    expect(await run(moved)).toEqual({
      pass: false,
      reason: "mas's address on chat_admin_mas is not its listener's bind",
    });
    const loose = MAS_SERVICE.replace("        ipv4_address: 10.250.38.3\n", "");
    expect(await run(loose)).toEqual({ pass: false, reason: "mas's address on chat_mas is not its listener's bind" });
    const outside = MAS_SERVICE.replace("      chat_db:\n", "      chat_db:\n      app:\n");
    expect(await run(outside, "dev", `${CHAT_NETWORKS}  app: {}\n`)).toEqual({
      pass: false,
      reason: "mas joins a network other than chat_db, chat_mas and chat_admin_mas",
    });
  });

  test("the_chat_networks_are_internal_with_their_subnets", async () => {
    const open = CHAT_NETWORKS.replace("  chat_mas:\n    internal: true\n", "  chat_mas:\n    internal: false\n");
    expect(await run(MAS_SERVICE, "dev", open)).toEqual({ pass: false, reason: "chat_mas is not internal" });
    const wide = CHAT_NETWORKS.replace("10.250.38.8/29", "10.250.38.0/24");
    expect(await run(MAS_SERVICE, "dev", wide)).toEqual({
      pass: false,
      reason: "chat_admin_mas is not on its reviewed subnet",
    });
  });

  test("only_chat_admin_shares_the_admin_network_and_only_synapse_the_other", async () => {
    const stranger = "  web:\n    image: w\n    networks: [chat_admin_mas]\n";
    expect(await run(MAS_SERVICE + stranger)).toEqual({
      pass: false,
      reason: "web is on chat_admin_mas, which only mas and chat-admin share",
    });
    const third = "  web:\n    image: w\n    networks: [chat_mas]\n";
    expect(await run(MAS_SERVICE + third)).toEqual({
      pass: false,
      reason: "web is on chat_mas, which only mas and synapse share",
    });
  });
});
