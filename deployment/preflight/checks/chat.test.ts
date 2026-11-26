// C36 (P6.02; ADR 0098): the chat servers' config files hold the build plan's step 1 values, and a stack that runs
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
      // No uploads: the media repository is off (config_documentation.md `enable_media_repo` at v1.165.0).
      ["enable_media_repo", true],
      ["enable_media_repo", undefined],
      // Element's offline device (MSC3814; ADR 0113) and no other experiment.
      ["experimental_features", undefined],
      ["experimental_features.msc3814_enabled", false],
      ["experimental_features", { msc3814_enabled: true, msc4108_enabled: true }],
    ];
    for (const [path, value] of cases) {
      const top = path.split(".")[0];
      expect(synapseProblem(edited(synapse(), path, value), SERVER), path).toBe(
        `homeserver.yaml: ${top} is not its reviewed value`,
      );
    }
  });

  test("synapse_listeners_are_two_client_listeners_without_forwarded_trust", () => {
    const [main, forAdmin] = synapse().listeners as [Doc, Doc];
    const reason = "homeserver.yaml: listeners is not its reviewed value";
    for (const change of [
      { x_forwarded: true },
      { resources: [{ names: ["client", "federation"], compress: false }] },
      { resources: [{ names: ["client", "openid"], compress: false }] },
      { type: "metrics" },
    ]) {
      expect(synapseProblem(edited(synapse(), "listeners", [{ ...main, ...change }, forAdmin]), SERVER)).toBe(reason);
      expect(synapseProblem(edited(synapse(), "listeners", [main, { ...forAdmin, ...change }]), SERVER)).toBe(reason);
    }
    const federation = { ...main, port: 8448, resources: [{ names: ["federation"] }] };
    expect(synapseProblem(edited(synapse(), "listeners", [main, forAdmin, federation]), SERVER)).toBe(reason);
  });

  test("each_synapse_listener_binds_only_its_own_addresses", () => {
    // ADR 0102 decision 8: chat-admin's listener on chat_admin_synapse alone; the edge and MAS reach the other one.
    const [main, forAdmin] = synapse().listeners as [Doc, Doc];
    expect(main.bind_addresses).toEqual(["10.250.38.51", "10.250.38.2"]);
    expect(forAdmin.bind_addresses).toEqual(["10.250.38.35"]);
    const reason = "homeserver.yaml: listeners is not its reviewed value";
    for (const binds of [["0.0.0.0"], ["::"], ["10.250.38.51", "10.250.38.2", "10.250.38.35"], ["10.250.38.51"]]) {
      expect(
        synapseProblem(edited(synapse(), "listeners", [{ ...main, bind_addresses: binds }, forAdmin]), SERVER),
      ).toBe(reason);
    }
    for (const binds of [["0.0.0.0"], ["10.250.38.35", "10.250.38.51"], ["10.250.38.2"]]) {
      expect(
        synapseProblem(edited(synapse(), "listeners", [main, { ...forAdmin, bind_addresses: binds }]), SERVER),
      ).toBe(reason);
    }
    expect(synapseProblem(edited(synapse(), "listeners", [main]), SERVER)).toBe(reason);
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
    // Build step 10 (ADR 0094 decision 2, ADR 0101 decision 2): a pusher's URL is set by the browser, so the one private
    // address Synapse may post to is the door's count port; and a push never carries a message's body or sender.
    const ranges = "homeserver.yaml: ip_range_whitelist is not its reviewed value";
    for (const value of [undefined, [], ["10.250.38.16/29"], ["10.250.38.19", "10.250.38.3"], ["10.0.0.0/8"]])
      expect(synapseProblem(edited(synapse(), "ip_range_whitelist", value), SERVER), JSON.stringify(value)).toBe(
        ranges,
      );
    expect(synapseProblem(edited(synapse(), "push", undefined), SERVER)).toBe("homeserver.yaml: push is not a mapping");
    expect(synapseProblem(edited(synapse(), "push.include_content", true), SERVER)).toBe(
      "homeserver.yaml: push.include_content is not its reviewed value",
    );
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
    // Only the connection keys we use; any other libpq or pool key (a TLS file, `options`, a service file) is refused.
    for (const [path, value] of [
      ["database.args.options", "-c search_path=public"],
      ["database.args.sslrootcert", "/data/ca.pem"],
      ["database.args.service", "synapse"],
      ["database.args.cp_reconnect", true],
      ["database.allow_unsafe_locale", true],
      ["database.txn_limit", 10],
    ] as const) {
      expect(synapseProblem(edited(synapse(), path, value), SERVER), path).toBe(
        "homeserver.yaml: database is not its reviewed shape",
      );
    }
    expect(synapseProblem(edited(synapse(), "form_secret_path", "/config/form"), SERVER)).toBe(
      "homeserver.yaml: form_secret_path is not a mounted secret",
    );
  });

  test("each_wrong_mas_value_is_refused", () => {
    const cases: [string, unknown][] = [
      ["passwords", { enabled: true }],
      ["account.account_deactivation_allowed", true],
      ["account.password_registration_enabled", true],
      ["account.email_change_allowed", true],
      ["account.password_registration_enabled", undefined],
      ["matrix.homeserver", "unset.cc"],
      ["matrix.endpoint", "http://elsewhere:8008/"],
      ["matrix.secret", "inline"],
      ["http.trusted_proxies", undefined],
      ["http.trusted_proxies", ["10.0.0.0/8"]],
      ["http.public_base", "https://mas.unset.cc/"],
    ];
    for (const [path, value] of cases) {
      // A nested tuned mapping (account) names the setting itself; the others name their top-level key.
      const named = path.startsWith("account.") ? path : path.split(".")[0];
      expect(masProblem(edited(mas(), path, value), SERVER), path).toBe(`mas.yaml: ${named} is not its reviewed value`);
    }
  });

  // Alex, 2026-11-21 19:37Z (ADR 0098 decision 2): while settings are tuned, only security settings are held exact; a
  // tuning setting takes any value, and a setting in neither list is still refused.
  test("a_changed_tuning_value_passes", () => {
    for (const [path, value] of [
      ["push.enabled", false],
      ["push.group_unread_count_by_room", false],
      ["rc_message", { per_second: 1, burst_count: 20 }],
      ["rc_room_creation", { per_second: 0.1, burst_count: 3 }],
    ] as const) {
      expect(synapseProblem(edited(synapse(), path, value), SERVER), path).toBeNull();
    }
  });

  // Review finding N4: the display name is the member's verified handle (domains/messaging/chat-account.ts), so a
  // member who could set their own name, picture or per-room name could show someone else's handle as their own.
  test("a_member_set_name_or_picture_fails", () => {
    for (const key of ["enable_set_displayname", "enable_set_avatar_url", "allow_per_room_profiles"]) {
      for (const value of [true, undefined])
        expect(synapseProblem(edited(synapse(), key, value), SERVER), `${key}=${value}`).toBe(
          `homeserver.yaml: ${key} is not its reviewed value`,
        );
    }
    for (const value of [true, undefined])
      expect(masProblem(edited(mas(), "account.displayname_change_allowed", value), SERVER)).toBe(
        "mas.yaml: account.displayname_change_allowed is not its reviewed value",
      );
  });

  test("a_changed_security_value_fails_even_inside_a_tuned_setting", () => {
    expect(synapseProblem(edited(synapse(), "push.include_content", true), SERVER)).toBe(
      "homeserver.yaml: push.include_content is not its reviewed value",
    );
    expect(synapseProblem(edited(synapse(), "push.include_content", undefined), SERVER)).toBe(
      "homeserver.yaml: push.include_content is not its reviewed value",
    );
    expect(synapseProblem(edited(synapse(), "push", true), SERVER)).toBe("homeserver.yaml: push is not a mapping");
    expect(masProblem(edited(mas(), "account", "yes"), SERVER)).toBe("mas.yaml: account is not a mapping");
  });

  test("an_unknown_setting_fails_at_the_top_and_inside_a_tuned_setting", () => {
    for (const key of ["rc_login", "rc_federation", "auto_join_rooms", "presence"]) {
      expect(synapseProblem(edited(synapse(), key, {}), SERVER), key).toBe(
        "homeserver.yaml: a setting the preflight does not allow",
      );
    }
    expect(synapseProblem(edited(synapse(), "push.jitter_delay", "10s"), SERVER)).toBe(
      "homeserver.yaml: a setting the preflight does not allow in push",
    );
    expect(masProblem(edited(mas(), "account.login_with_email_allowed", true), SERVER)).toBe(
      "mas.yaml: a setting the preflight does not allow in account",
    );
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
  "    networks:",
  "      chat_synapse_db:",
  "      chat_count:",
  "      chat_mas:",
  "        ipv4_address: 10.250.38.2",
  "      chat_edge_synapse:",
  "        ipv4_address: 10.250.38.51",
  "      chat_admin_synapse:",
  "        ipv4_address: 10.250.38.35",
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
/** The chat networks as ADR 0098 Decision 4 has them: fixed subnets, every one internal. */
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
  "  chat_synapse_db:",
  "    internal: true",
  "  chat_count:",
  "    internal: true",
  "  chat_admin_synapse:",
  "    internal: true",
  "    ipam:",
  "      config:",
  "        - subnet: 10.250.38.32/29",
  "  chat_edge_synapse:",
  "    internal: true",
  "    ipam:",
  "      config:",
  "        - subnet: 10.250.38.48/29",
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
  // chat-admin as its own listener check needs it (the next describe): its address on chat_admin, bound.
  const ADMIN = [
    "  chat-admin:",
    "    image: a",
    "    environment:",
    "      LISTEN_ADDRESS: 10.250.38.27",
    "    networks:",
    "      chat_admin_mas:",
    "      chat_admin:",
    "        ipv4_address: 10.250.38.27",
    "",
  ].join("\n");
  const ADMIN_NETWORK =
    "  chat_admin:\n    internal: true\n    ipam:\n      config:\n        - subnet: 10.250.38.24/29\n";

  test("mas_binds_its_fixed_address_on_each_internal_network", async () => {
    expect(await run(MAS_SERVICE + ADMIN + OTHER, "dev", CHAT_NETWORKS + ADMIN_NETWORK)).toEqual({
      pass: true,
      reason: "ok",
    });
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

describe("C36 the door's and chat-admin's listeners", () => {
  // ADR 0101 decision 2: the count port answers GET /count?did= with no authentication, so only the network Synapse and
  // web share with the door may reach it. Each listener binds the process's address on its one network (its config
  // refuses 0.0.0.0), and that address is the one Compose gives the process there.
  const DOOR = [
    "  chat-auth:",
    "    image: d",
    "    environment:",
    "      LISTEN_ADDRESS: 10.250.38.43",
    "      COUNT_LISTEN_ADDRESS: 10.250.38.19",
    '      COUNT_LISTEN_PORT: "8091"',
    "      COUNT_ORIGIN: http://10.250.38.19:8091",
    "    networks:",
    "      chat_edge:",
    "        ipv4_address: 10.250.38.43",
    "      chat_count:",
    "        ipv4_address: 10.250.38.19",
    "      chat_admin:",
    "",
  ].join("\n");
  const ADMIN = [
    "  chat-admin:",
    "    image: a",
    "    environment:",
    "      LISTEN_ADDRESS: 10.250.38.27",
    "    networks:",
    "      chat_admin:",
    "        ipv4_address: 10.250.38.27",
    "",
  ].join("\n");
  const PEERS = [
    "  synapse-peer:",
    "    image: s",
    "  web:",
    "    image: w",
    "    networks: [chat_count, chat_admin]",
    "  edge:",
    "    image: e",
    "    networks: [chat_edge]",
    "",
  ].join("\n");
  const NETWORKS = [
    // CHAT_NETWORKS already names chat_count (Synapse's networks); here it also carries its subnet.
    CHAT_NETWORKS.replace(
      "  chat_count:\n    internal: true\n",
      "  chat_count:\n    internal: true\n    ipam:\n      config:\n        - subnet: 10.250.38.16/29\n",
    ),
    "  chat_admin:",
    "    internal: true",
    "    ipam:",
    "      config:",
    "        - subnet: 10.250.38.24/29",
    "  chat_edge:",
    "    internal: true",
    "    ipam:",
    "      config:",
    "        - subnet: 10.250.38.40/29",
    "",
  ].join("\n");
  const at = (services: string, networks = NETWORKS) => run(services, "dev", networks);

  test("each_listener_binds_its_address_on_its_one_network", async () => {
    expect(await at(DOOR + ADMIN + PEERS)).toEqual({ pass: true, reason: "ok" });
    // Synapse's push whitelist holds only the door's count address (homeserver.yaml ip_range_whitelist).
    expect(await at(DOOR.replace("COUNT_LISTEN_ADDRESS: 10.250.38.19", "COUNT_LISTEN_ADDRESS: 10.250.38.20"))).toEqual({
      pass: false,
      reason: "chat-auth's COUNT_LISTEN_ADDRESS is not its reviewed address",
    });
    const unbound = DOOR.replace("      COUNT_LISTEN_ADDRESS: 10.250.38.19\n", "");
    expect(await at(unbound)).toEqual({
      pass: false,
      reason: "chat-auth's COUNT_LISTEN_ADDRESS is not its reviewed address",
    });
    expect(await at(DOOR.replace("ipv4_address: 10.250.38.19", "ipv4_address: 10.250.38.20"))).toEqual({
      pass: false,
      reason: "chat-auth's address on chat_count is not its COUNT_LISTEN_ADDRESS",
    });
    expect(
      await at(DOOR.replace("COUNT_ORIGIN: http://10.250.38.19:8091", "COUNT_ORIGIN: http://chat-auth:8091")),
    ).toEqual({
      pass: false,
      reason: "chat-auth's COUNT_ORIGIN is not its count listener",
    });
    expect(await at(ADMIN.replace("LISTEN_ADDRESS: 10.250.38.27", "LISTEN_ADDRESS: 10.250.38.26"))).toEqual({
      pass: false,
      reason: "chat-admin's LISTEN_ADDRESS is not its reviewed address",
    });
    expect(await at(DOOR.replace("ipv4_address: 10.250.38.43", "ipv4_address: 10.250.38.44"))).toEqual({
      pass: false,
      reason: "chat-auth's address on chat_edge is not its LISTEN_ADDRESS",
    });
  });

  test("each_listener_network_is_internal_on_its_subnet_with_only_its_peers", async () => {
    const open = NETWORKS.replace("  chat_count:\n    internal: true\n", "  chat_count:\n    internal: false\n");
    expect(await at(DOOR, open)).toEqual({ pass: false, reason: "chat_count is not internal" });
    const wide = NETWORKS.replace("10.250.38.24/29", "10.250.38.0/24");
    expect(await at(ADMIN, wide)).toEqual({ pass: false, reason: "chat_admin is not on its reviewed subnet" });
    const stranger = "  pds:\n    image: p\n    networks: [chat_count]\n";
    expect(await at(DOOR + stranger)).toEqual({
      pass: false,
      reason: "pds is on chat_count, which only chat-auth, synapse and web share",
    });
    const onEdge = "  web2:\n    image: w\n    networks: [chat_edge]\n";
    expect(await at(DOOR + onEdge)).toEqual({
      pass: false,
      reason: "web2 is on chat_edge, which only chat-auth and edge share",
    });
  });
});

describe("C36 Synapse's networks", () => {
  // ADR 0102 decision 8 and ADR 0098 Decision 4: each client listener binds Synapse's fixed address on its networks.
  const EDGE = "  edge:\n    image: e\n    networks: [chat_edge_synapse]\n";
  // chat-admin also holds its own listener's address on chat_admin (the door's and chat-admin's listener check).
  const ADMIN = [
    "  chat-admin:",
    "    image: a",
    "    environment:",
    "      LISTEN_ADDRESS: 10.250.38.27",
    "    networks:",
    "      chat_admin_synapse:",
    "      chat_admin_mas:",
    "      chat_admin:",
    "        ipv4_address: 10.250.38.27",
    "",
  ].join("\n");
  const ADMIN_NETWORK =
    "  chat_admin:\n    internal: true\n    ipam:\n      config:\n        - subnet: 10.250.38.24/29\n";

  test("synapse_holds_each_listener_address_on_its_internal_network", async () => {
    expect(
      await run(SYNAPSE_SERVICE + MAS_SERVICE + EDGE + ADMIN + OTHER, "dev", CHAT_NETWORKS + ADMIN_NETWORK),
    ).toEqual({
      pass: true,
      reason: "ok",
    });
    for (const [from, to, network] of [
      ["10.250.38.35", "10.250.38.36", "chat_admin_synapse"],
      ["10.250.38.51", "10.250.38.50", "chat_edge_synapse"],
      ["10.250.38.2", "10.250.38.4", "chat_mas"],
    ] as const) {
      expect(await run(SYNAPSE_SERVICE.replace(`ipv4_address: ${from}`, `ipv4_address: ${to}`))).toEqual({
        pass: false,
        reason: `synapse's address on ${network} is not its listener's bind`,
      });
    }
    const outside = SYNAPSE_SERVICE.replace("      chat_count:\n", "      chat_count:\n      app:\n");
    expect(await run(outside, "dev", `${CHAT_NETWORKS}  app: {}\n`)).toEqual({
      pass: false,
      reason:
        "synapse joins a network other than chat_synapse_db, chat_count, chat_mas, chat_edge_synapse and chat_admin_synapse",
    });
  });

  test("only_chat_admin_shares_its_listener_network_and_only_the_edge_the_other", async () => {
    const wide = CHAT_NETWORKS.replace("10.250.38.32/29", "10.250.38.32/24");
    expect(await run(SYNAPSE_SERVICE, "dev", wide)).toEqual({
      pass: false,
      reason: "chat_admin_synapse is not on its reviewed subnet",
    });
    const web = "  web:\n    image: w\n    networks: [chat_admin_synapse]\n";
    expect(await run(SYNAPSE_SERVICE + web)).toEqual({
      pass: false,
      reason: "web is on chat_admin_synapse, which only synapse and chat-admin share",
    });
    const door = "  chat-auth:\n    image: d\n    networks: [chat_edge_synapse]\n";
    expect(await run(SYNAPSE_SERVICE + door)).toEqual({
      pass: false,
      reason: "chat-auth is on chat_edge_synapse, which only synapse and edge share",
    });
  });
});
