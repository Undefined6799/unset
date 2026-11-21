// C36 (P6.02; ADR 0086; chat build plan step 1): the chat servers run only with the reviewed settings. A service named
// synapse or mas reads exactly one config file, mounted read-only, with no setting beside it in its environment. Our
// Synapse image starts `synapse.app.homeserver -c /config/homeserver.yaml` (deployment/images/synapse.Dockerfile), so
// the synapse service sets no variable at all; MAS merges every MAS_* variable into its config and splits MAS_CONFIG
// on ":" into several files (crates/cli/src/commands/mod.rs:90-109 at v1.26.0), so mas sets MAS_CONFIG alone. The
// file's top-level keys are exactly the reviewed ones, so no other module, provider or inline secret rides in, and
// every security setting is its reviewed value. A stack with neither service passes. A reason names a setting from
// the lists below, never a value (P1.30m).
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import type { Service } from "../compose-parse.ts";
import { type Check, type Env, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** ADR 0025: the chat server name. Local has no ruling, so a local stack may not run a chat server yet. */
const SERVER_NAME: Readonly<Record<Env, string | null>> = { dev: "staging.unset.cc", prod: "unset.cc", local: null };
const SECRET = /^\/run\/secrets\/[a-z0-9_]+$/;
type Doc = Record<string, unknown>;

/** The door's fixed address on the count network it shares with Synapse and web only (ADR 0090 decision 2). */
export const DOOR_COUNT_ADDRESS = "10.250.38.19";

/** Synapse 1.165.0's settings that must be exactly these (build plan step 1, Synapse table). */
function synapseSettings(serverName: string): Doc {
  return {
    server_name: serverName,
    public_baseurl: `https://${serverName}/`,
    listeners: [
      {
        port: 8008,
        bind_addresses: ["0.0.0.0"],
        type: "http",
        tls: false,
        x_forwarded: false,
        resources: [{ names: ["client"], compress: false }],
      },
    ],
    log_config: "/config/log.yaml",
    report_stats: false,
    trusted_key_servers: [],
    federation_domain_whitelist: [],
    allow_profile_lookup_over_federation: false,
    enable_registration: false,
    allow_guest_access: false,
    // The rule encrypts every room not asked for as plain; "all" would encrypt the plain kind too (P6.10a).
    encryption_enabled_by_default_for_room_type: "off",
    enable_search: false,
    // Exactly the cap and one unbounded job; a default_policy would purge encrypted history (config_documentation.md
    // `retention` at v1.165.0).
    retention: { enabled: true, allowed_lifetime_max: "30d", purge_jobs: [{ interval: "12h" }] },
    enable_set_displayname: false,
    enable_set_avatar_url: false,
    allow_per_room_profiles: false,
    require_auth_for_profile_requests: true,
    limit_profile_requests_to_users_who_share_rooms: true,
    user_directory: { enabled: false },
    url_preview_enabled: false,
    // No uploads: the media repository is off, so no media endpoint is served (config_documentation.md
    // `enable_media_repo` at v1.165.0).
    enable_media_repo: false,
    user_ips_max_age: "1d",
    // Build step 10 (ADR 0090 decision 2): the door's count port is the one private address a pusher may reach, and a
    // push names no body or sender; its count is of rooms (config_documentation.md `ip_range_whitelist`, `push`).
    ip_range_whitelist: [DOOR_COUNT_ADDRESS],
    push: { enabled: true, include_content: false, group_unread_count_by_room: true },
    matrix_authentication_service: {
      enabled: true,
      endpoint: "http://mas:8080/",
      secret_path: "/run/secrets/synapse_mas_secret",
    },
    // The server rule and nothing else (P6.10a; ADR 0085), the only guarantee that rooms are encrypted: it refuses
    // any config, so none is given.
    modules: [{ module: "unset_chat_policy.RoomPolicy", config: {} }],
  };
}
const SYNAPSE_SECRET_PATHS = ["signing_key_path", "macaroon_secret_key_path", "form_secret_path"];
const SYNAPSE_OTHER = ["database", "media_store_path", ...SYNAPSE_SECRET_PATHS];
/** The connection and pool keys homeserver.yaml uses (config_documentation.md `database` at v1.165.0); no other. */
const SYNAPSE_DATABASE_ARGS = ["host", "dbname", "user", "passfile", "sslmode", "cp_min", "cp_max"];

/** MAS 1.26.0's settings that must be exactly these (build plan step 1, MAS table; ADR 0086 for the binds). */
function masSettings(serverName: string): Doc {
  return {
    http: {
      public_base: "http://mas:8080/",
      trusted_proxies: [],
      listeners: [
        {
          name: "synapse",
          resources: [{ name: "discovery" }, { name: "oauth" }, { name: "health" }],
          binds: [{ address: "10.250.38.3:8080" }],
        },
        {
          name: "chat-admin",
          resources: [{ name: "oauth" }, { name: "adminapi" }],
          binds: [{ address: "10.250.38.11:8081" }],
        },
      ],
    },
    matrix: {
      kind: "synapse",
      homeserver: serverName,
      endpoint: "http://synapse:8008/",
      secret_file: "/run/secrets/mas_synapse_secret",
    },
    passwords: { enabled: false },
    account: {
      displayname_change_allowed: false,
      account_deactivation_allowed: false,
      password_registration_enabled: false,
      email_change_allowed: false,
    },
  };
}
const MAS_OTHER = ["database", "clients", "policy", "secrets"];
const MAS_DATABASE_KEYS = ["host", "port", "username", "database", "password_file", "ssl_mode"];

/** Why a Synapse config is not the reviewed one, or null. */
export function synapseProblem(doc: unknown, serverName: string): string | null {
  const why = (text: string) => `homeserver.yaml: ${text}`;
  if (!isDoc(doc)) return why("is not a mapping");
  const settings = synapseSettings(serverName);
  const unknown = keysOutside(doc, [...Object.keys(settings), ...SYNAPSE_OTHER]);
  if (unknown) return why("a setting the preflight does not allow");
  for (const [key, expected] of Object.entries(settings))
    if (!isDeepStrictEqual(doc[key], expected)) return why(`${key} is not its reviewed value`);
  for (const key of SYNAPSE_SECRET_PATHS)
    if (!SECRET.test(String(doc[key]))) return why(`${key} is not a mounted secret`);
  const database = doc.database;
  if (!isDoc(database) || database.name !== "psycopg2" || !isDoc(database.args)) return why("database is not Postgres");
  if ("password" in database.args || !SECRET.test(String(database.args.passfile)))
    return why("database holds a password; it comes from a passfile");
  if (keysOutside(database, ["name", "args"]) || keysOutside(database.args, SYNAPSE_DATABASE_ARGS))
    return why("database is not its reviewed shape");
  return typeof doc.media_store_path === "string" ? null : why("media_store_path is not a path");
}

/** Why a MAS config is not the reviewed one, or null. */
export function masProblem(doc: unknown, serverName: string): string | null {
  const why = (text: string) => `mas.yaml: ${text}`;
  if (!isDoc(doc)) return why("is not a mapping");
  const settings = masSettings(serverName);
  if (keysOutside(doc, [...Object.keys(settings), ...MAS_OTHER])) return why("a setting the preflight does not allow");
  for (const [key, expected] of Object.entries(settings))
    if (!isDeepStrictEqual(doc[key], expected)) return why(`${key} is not its reviewed value`);
  const { database, clients, policy, secrets } = doc;
  if (!isDoc(database) || keysOutside(database, MAS_DATABASE_KEYS) || !SECRET.test(String(database.password_file)))
    return why("database is not its reviewed shape");
  const client = Array.isArray(clients) && clients.length === 1 ? clients[0] : null;
  const oneClient =
    isDoc(client) &&
    !keysOutside(client, ["client_id", "client_auth_method", "client_secret_file"]) &&
    client.client_auth_method === "client_secret_basic" &&
    typeof client.client_id === "string" &&
    SECRET.test(String(client.client_secret_file));
  if (!oneClient) return why("clients is not one admin client");
  if (!isDeepStrictEqual(policy, { data: { admin_clients: [client.client_id] } }))
    return why("policy is not exactly the admin client");
  const keys = isDoc(secrets) ? secrets.keys : null;
  const fileOnly =
    isDoc(secrets) &&
    !keysOutside(secrets, ["encryption_file", "keys"]) &&
    SECRET.test(String(secrets.encryption_file)) &&
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.every((key) => isDoc(key) && !keysOutside(key, ["key_file"]) && SECRET.test(String(key.key_file)));
  return fileOnly ? null : why("secrets is not file-only");
}

const SERVICES = [
  { name: "synapse", variable: null, path: "/config/homeserver.yaml", yaml: "1.1", problem: synapseProblem },
  { name: "mas", variable: "MAS_CONFIG", path: "/config/mas.yaml", yaml: "1.2", problem: masProblem },
] as const;

export const c36: Check = {
  id: "C36",
  run: (inputs) => {
    for (const rule of SERVICES) {
      const service = inputs.compose.services.find((s) => s.name === rule.name);
      if (service === undefined) continue;
      const serverName = SERVER_NAME[inputs.env];
      if (serverName === null) return fail("no chat server name is ruled for this environment");
      const outcome = configProblem(inputs, service, rule, serverName);
      if (outcome !== null) return outcome;
    }
    const mas = inputs.compose.services.find((s) => s.name === "mas");
    return (mas === undefined ? null : listenerNetworksProblem(inputs, mas, MAS_NETWORKS, MAS_JOINS)) ?? pass();
  },
};

/** The service reads its one mounted config, through one literal variable where it has one, and that file is the reviewed one. */
function configProblem(
  inputs: Inputs,
  service: Service,
  rule: (typeof SERVICES)[number],
  serverName: string,
): Outcome | null {
  const { name } = service;
  if (service.envFiles.length > 0) return fail(`${name} reads an env file`);
  const outcome = rule.variable === null ? noEnvironment(service) : configVariable(service, rule.variable, rule.path);
  if (outcome !== null) return outcome;
  const mounts = service.mounts.filter((m) => m.target === rule.path);
  const mount = mounts[0];
  if (mounts.length !== 1 || mount?.type !== "bind" || !mount.readOnly || mount.source === null)
    return fail(`${name} does not mount its config read-only once`);
  const text = inputs.readRegular(mount.source);
  if (text === null) return missing(mount.source);
  if (text === "not a regular file") return fail(`${name}'s config is not a regular file`);
  const problem = rule.problem(readStrict(text, rule.yaml), serverName);
  return problem === null ? null : fail(problem);
}

function noEnvironment(service: Service): Outcome | null {
  return service.environment.length === 0 ? null : fail(`${service.name} sets an environment variable`);
}

function configVariable(service: Service, variable: string, path: string): Outcome | null {
  const { name } = service;
  if (service.environment.some(([key]) => key !== variable))
    return fail(`${name} sets a name other than its config path`);
  const value = service.environment[0]?.[1];
  if (service.environment.length !== 1 || value === undefined || !("literal" in value) || value.literal !== path)
    return fail(`${name} does not read exactly its reviewed config path`);
  return null;
}

/** A network a server's listener binds one fixed address on, and the one other service that may join it. */
type ListenerNetwork = {
  readonly name: string;
  readonly subnet: string;
  readonly address: string;
  readonly peer: string;
};

/**
 * MAS's two listeners bind fixed addresses (mas.yaml), which keep each on one network only if MAS holds exactly those
 * addresses there (ADR 0086 Decision 4). So MAS joins chat_db and the two MAS networks and nothing else, has each
 * listener's address on its network, each network is internal on its reviewed subnet, and only Synapse shares one and
 * only chat-admin the other.
 */
const MAS_NETWORKS: readonly ListenerNetwork[] = [
  { name: "chat_mas", subnet: "10.250.38.0/29", address: "10.250.38.3", peer: "synapse" },
  { name: "chat_admin_mas", subnet: "10.250.38.8/29", address: "10.250.38.11", peer: "chat-admin" },
];
const MAS_JOINS = ["chat_db", ...MAS_NETWORKS.map((n) => n.name)];

const listing = (names: readonly string[]) => `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** `service` joins only `joins`, holds each listener's address on its network, and shares it with its peer alone. */
function listenerNetworksProblem(
  inputs: Inputs,
  service: Service,
  networks: readonly ListenerNetwork[],
  joins: readonly string[],
): Outcome | null {
  const owner = service.name;
  if (service.networkMode !== null || service.networks.some((n) => !joins.includes(n)))
    return fail(`${owner} joins a network other than ${listing(joins)}`);
  for (const { name, subnet, address, peer } of networks) {
    const held = service.addresses.filter(([network]) => network === name);
    if (held.length !== 1 || held[0]?.[1] !== address)
      return fail(`${owner}'s address on ${name} is not its listener's bind`);
    const network = inputs.compose.networks.find((n) => n.name === name);
    if (network === undefined || !network.internal) return fail(`${name} is not internal`);
    if (network.subnet !== subnet) return fail(`${name} is not on its reviewed subnet`);
    const stranger = inputs.compose.services.find(
      (s) => s.networks.includes(name) && s.name !== owner && s.name !== peer,
    );
    if (stranger !== undefined) return fail(`${stranger.name} is on ${name}, which only ${owner} and ${peer} share`);
  }
  return null;
}

/**
 * The file's value under the compose reader's strict subset (compose-parse.ts): no duplicate key, no alias, no merge
 * key. Anything else is null, which every rule refuses. Each file is read in the YAML its server reads: Synapse's
 * PyYAML is YAML 1.1, where a bare `off` or `yes` is a boolean, so only a quoted "off" passes its rule; MAS's serde
 * YAML is 1.2.
 */
export function readStrict(text: string, version: "1.1" | "1.2"): unknown {
  const schema = version === "1.1" ? "yaml-1.1" : "core";
  const doc = parseDocument(text, { version, schema, uniqueKeys: true, merge: false, strict: true });
  if (doc.errors.length > 0) return null;
  try {
    return doc.toJS({ maxAliasCount: 0 });
  } catch {
    return null;
  }
}

const isDoc = (value: unknown): value is Doc => typeof value === "object" && value !== null && !Array.isArray(value);
const keysOutside = (doc: Doc, allowed: readonly string[]) => Object.keys(doc).some((key) => !allowed.includes(key));
