// C36 (P6.02; ADR 0086; chat build plan step 1): the chat servers run only with the reviewed settings. A service named
// synapse or mas reads exactly one config file, mounted read-only, with no setting beside it in its environment: the
// Synapse image's start.py reads SYNAPSE_CONFIG_PATH and also SYNAPSE_WORKER, UID and GID (docker/start.py:234-314
// at v1.162.0), and MAS merges every MAS_* variable into its config and splits MAS_CONFIG on ":" into several files
// (crates/cli/src/commands/mod.rs:90-109 at v1.26.0). The file's top-level keys are exactly the reviewed ones, so no
// module, provider or inline secret rides in, and every security setting is its reviewed value. A stack with neither
// service passes. A reason names a setting from the lists below, never a value (P1.30m).
import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import type { Service } from "../compose-parse.ts";
import { type Check, type Env, fail, type Inputs, missing, type Outcome, pass } from "./types.ts";

/** ADR 0025: the chat server name. Local has no ruling, so a local stack may not run a chat server yet. */
const SERVER_NAME: Readonly<Record<Env, string | null>> = { dev: "staging.unset.cc", prod: "unset.cc", local: null };
const SECRET = /^\/run\/secrets\/[a-z0-9_]+$/;
type Doc = Record<string, unknown>;

/** Synapse 1.162.0's settings that must be exactly these (build plan step 1, Synapse table). */
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
    encryption_enabled_by_default_for_room_type: "all",
    enable_set_displayname: false,
    enable_set_avatar_url: false,
    allow_per_room_profiles: false,
    require_auth_for_profile_requests: true,
    limit_profile_requests_to_users_who_share_rooms: true,
    user_directory: { enabled: false },
    url_preview_enabled: false,
    user_ips_max_age: "1d",
    matrix_authentication_service: {
      enabled: true,
      endpoint: "http://mas:8080/",
      secret_path: "/run/secrets/synapse_mas_secret",
    },
  };
}
const SYNAPSE_SECRET_PATHS = ["signing_key_path", "macaroon_secret_key_path", "form_secret_path"];
const SYNAPSE_OTHER = ["database", "media_store_path", ...SYNAPSE_SECRET_PATHS];

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
  { name: "synapse", variable: "SYNAPSE_CONFIG_PATH", path: "/config/homeserver.yaml", problem: synapseProblem },
  { name: "mas", variable: "MAS_CONFIG", path: "/config/mas.yaml", problem: masProblem },
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
    return pass();
  },
};

/** The service reads its one mounted config through one literal variable, and that file is the reviewed one. */
function configProblem(
  inputs: Inputs,
  service: Service,
  rule: (typeof SERVICES)[number],
  serverName: string,
): Outcome | null {
  const { name } = service;
  if (service.envFiles.length > 0) return fail(`${name} reads an env file`);
  if (service.environment.some(([key]) => key !== rule.variable))
    return fail(`${name} sets a name other than its config path`);
  const value = service.environment[0]?.[1];
  if (service.environment.length !== 1 || value === undefined || !("literal" in value) || value.literal !== rule.path)
    return fail(`${name} does not read exactly its reviewed config path`);
  const mounts = service.mounts.filter((m) => m.target === rule.path);
  const mount = mounts[0];
  if (mounts.length !== 1 || mount?.type !== "bind" || !mount.readOnly || mount.source === null)
    return fail(`${name} does not mount its config read-only once`);
  const text = inputs.readRegular(mount.source);
  if (text === null) return missing(mount.source);
  if (text === "not a regular file") return fail(`${name}'s config is not a regular file`);
  const problem = rule.problem(readStrict(text), serverName);
  return problem === null ? null : fail(problem);
}

/**
 * The file's value under the compose reader's strict subset (compose-parse.ts): no duplicate key, no alias, no merge
 * key. Anything else is null, which every rule refuses. YAML 1.2's core schema reads `yes` or `off` as text where
 * Synapse's PyYAML (YAML 1.1) reads a boolean, so a value written that way fails its rule rather than passing.
 */
function readStrict(text: string): unknown {
  const doc = parseDocument(text, { version: "1.2", schema: "core", uniqueKeys: true, merge: false, strict: true });
  if (doc.errors.length > 0) return null;
  try {
    return doc.toJS({ maxAliasCount: 0 });
  } catch {
    return null;
  }
}

const isDoc = (value: unknown): value is Doc => typeof value === "object" && value !== null && !Array.isArray(value);
const keysOutside = (doc: Doc, allowed: readonly string[]) => Object.keys(doc).some((key) => !allowed.includes(key));
