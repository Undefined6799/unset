// The stack's own settings for the e2e chat servers (P6.02), read from deployment/: the config files with only the chat
// domain changed, the chat networks and fixed addresses compose gives synapse and mas, the listeners the spec is pointed
// at, and MAS from our mirror by the locked digest. chat-servers-up.ts runs what these describe.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const DEPLOYMENT = join(import.meta.dirname, "..", "..", "..", "deployment");

/** The chat domain the spec's door and page use, and the staging one the config files name. */
export const SERVER_NAME = "unset.cc";
const STAGING_NAME = "staging.unset.cc";

/** The three lines that name the chat domain, each required exactly once. */
export function withServerName(homeserver: string, mas: string, name = SERVER_NAME) {
  const swap = (text: string, line: string, next: string) => {
    const lines = text.split("\n");
    const at = lines.flatMap((value, i) => (value === line ? [i] : []));
    if (at.length !== 1) throw new Error(`expected the line "${line}" once, found it ${at.length} times`);
    lines[at[0] as number] = next;
    return lines.join("\n");
  };
  const named = swap(homeserver, `server_name: ${STAGING_NAME}`, `server_name: ${name}`);
  return {
    homeserver: swap(named, `public_baseurl: https://${STAGING_NAME}/`, `public_baseurl: https://${name}/`),
    mas: swap(mas, `  homeserver: ${STAGING_NAME}`, `  homeserver: ${name}`),
  };
}

type ComposeNetwork = { internal?: boolean; ipam?: { config?: { subnet?: string }[] } } | null;
type ComposeService = { networks?: string[] | Record<string, { ipv4_address?: string } | null> };
type Compose = { services: Record<string, ComposeService>; networks: Record<string, ComposeNetwork> };

export type NetworkSpec = { readonly internal: boolean; readonly subnet?: string };
export type Attachment = { readonly network: string; readonly address?: string };

/**
 * The chat networks the stack gives synapse and mas, and the ones Postgres shares with them, as compose declares them.
 */
export function chatNetworks(composeYaml: string) {
  const compose = parse(composeYaml) as Compose;
  // Compose takes a service's networks as a list of names or as a map with per-network settings.
  const attachments = (service: string): Attachment[] => {
    const listed = compose.services[service]?.networks ?? {};
    const entries = Array.isArray(listed) ? listed.map((name) => [name, null] as const) : Object.entries(listed);
    return entries.map(([network, value]) => ({
      network,
      ...(value?.ipv4_address === undefined ? {} : { address: value.ipv4_address }),
    }));
  };
  const synapse = attachments("synapse");
  const mas = attachments("mas");
  const used = new Set([...synapse, ...mas].map((a) => a.network));
  const postgres = attachments("postgres").filter((a) => used.has(a.network));
  const networks: Record<string, NetworkSpec> = {};
  for (const name of used) {
    const declared = compose.networks[name];
    const subnet = declared?.ipam?.config?.[0]?.subnet;
    networks[name] = { internal: declared?.internal === true, ...(subnet === undefined ? {} : { subnet }) };
  }
  return { networks, synapse, mas, postgres };
}

type Homeserver = { listeners: { port: number; bind_addresses: string[] }[] };
type MasConfig = {
  http: { listeners: { name: string; binds: { address: string }[] }[] };
  clients: { client_id: string }[];
};

/** Where the spec reaches the servers: Synapse's first client listener, and MAS's chat-admin listener. */
export function endpoints(homeserverYaml: string, masYaml: string) {
  const homeserver = parse(homeserverYaml) as Homeserver;
  const mas = parse(masYaml) as MasConfig;
  const client = homeserver.listeners[0];
  const admin = mas.http.listeners.find((listener) => listener.name === "chat-admin")?.binds[0]?.address;
  const synapseHealth = mas.http.listeners.find((listener) => listener.name === "synapse")?.binds[0]?.address;
  const clientId = mas.clients[0]?.client_id;
  if (client?.bind_addresses[0] === undefined || admin === undefined || synapseHealth === undefined) {
    throw new Error("homeserver.yaml or mas.yaml has no listener where the spec expects one");
  }
  if (clientId === undefined) throw new Error("mas.yaml has no client");
  return {
    synapse: `http://${client.bind_addresses[0]}:${client.port}`,
    mas: `http://${admin}`,
    masAdmin: `http://${admin}`,
    masHealth: `http://${synapseHealth}/health`,
    clientId,
  };
}

/** The mirrored MAS image by the digest bases.lock.json pins (mirror.list.json names the mirror). */
export function masImage(): string {
  const lock = JSON.parse(readFileSync(join(DEPLOYMENT, "images", "bases.lock.json"), "utf8")) as Record<
    string,
    { ref: string; digest: string }
  >;
  const mirrors = JSON.parse(readFileSync(join(DEPLOYMENT, "mirror.list.json"), "utf8")) as {
    source: string;
    mirror: string;
  }[];
  const entry = lock.mas;
  const mirror = mirrors.find((m) => entry !== undefined && m.source.startsWith(`${entry.ref}:`))?.mirror;
  if (entry === undefined || mirror === undefined) throw new Error("no mirrored MAS in bases.lock.json");
  return `${mirror}@${entry.digest}`;
}
