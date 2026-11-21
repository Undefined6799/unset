// What chat-two-browsers.chromium.spec.ts runs against (build step 11): the whole chat with no stand-in for Matrix. The
// built page and the door's own composition root over real Postgres as `chat_auth` (as fixtures/chat-stack.ts), real
// chat-admin, and a real MAS 1.26.0 and Synapse with our settings, which the run is pointed at by its environment:
//   CHAT_E2E_SYNAPSE_URL           Synapse's client listener, e.g. http://127.0.0.1:8008 (server_name unset.cc)
//   CHAT_E2E_MAS_URL               MAS's listener with the oauth resource, e.g. http://127.0.0.1:8080
//   CHAT_E2E_MAS_ADMIN_URL         MAS's listener with the adminapi resource, e.g. http://127.0.0.1:8082
//   CHAT_E2E_MAS_CLIENT_ID         chat-admin's client, listed in MAS policy.data.admin_clients
//   CHAT_E2E_MAS_CLIENT_SECRET_FILE  its secret, in a file
//   CHAT_E2E_SYNAPSE_SQLITE        optional: Synapse's SQLite database, read-only, for what erasure leaves in the key tables
// The servers run outside the harness (Compose services for them land with the feature, ADR 0086); without these the
// spec skips and says so. web's half of the hop is played here, for whichever member the browser's `member` cookie
// on unset.sh names, with web's own chat-admin client signing the ticket.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http"; // guard-allow: egress test edge, forwards to the local Synapse and the door's count port only
import { createServer as createTlsServer } from "node:https"; // guard-allow: egress test edge, loopback listener only
import type { AddressInfo } from "node:net"; // guard-allow: egress test edge, a type only
import type { Did, Handle } from "@unset/domains-identity";
import { type ChatUser, newChatUser, parseDoorState, sessionRef } from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { loadConfig } from "@unset/shared-config";
import { createMas } from "../../../interfaces/chat-admin/mas.ts";
import { compose } from "../../../interfaces/chat-auth/compose.ts";
import { schema } from "../../../interfaces/chat-auth/config.ts";
import { NOTIFY_PATH as NOTIFY } from "../../../interfaces/chat-auth/count.ts";
import { loadChatPage } from "../../../interfaces/chat-auth/page.ts";
import { type FakeMas, startService } from "../../integration/chat-admin/harness.ts";
import { type ChatDatabase, certificate, close, connectProxy, file, listen } from "./chat-stack.ts";

export type RealServers = {
  readonly synapse: URL;
  readonly mas: URL;
  readonly masAdmin: URL;
  readonly clientId: string;
  readonly clientSecret: string;
};

/** The real servers from the environment, or null when the run is not pointed at any. */
export function realServers(): RealServers | null {
  const env = process.env;
  const names = ["SYNAPSE_URL", "MAS_URL", "MAS_ADMIN_URL", "MAS_CLIENT_ID", "MAS_CLIENT_SECRET_FILE"] as const;
  const values = names.map((name) => env[`CHAT_E2E_${name}`] ?? "");
  if (values.some((value) => value === "")) return null;
  const [synapse, mas, masAdmin, clientId, secretFile] = values as [string, string, string, string, string];
  const clientSecret = readFileSync(secretFile, "utf8").trim();
  return { synapse: new URL(synapse), mas: new URL(mas), masAdmin: new URL(masAdmin), clientId, clientSecret };
}

export type Member = { readonly did: Did; readonly user: ChatUser; readonly userId: string; readonly handle: string };

export type RealStack = {
  readonly proxy: string;
  /** A new member with a chat account made by chat-admin in the real MAS, display name `handle`. */
  readonly member: (handle: string) => Promise<Member>;
  /** web's chat-admin client, as the lifecycle jobs call it. */
  readonly chatAdmin: ReturnType<typeof createChatAdminClient>;
  /** A short-lived Synapse admin token for the checks only (a MAS personal session with urn:synapse:admin:*). */
  readonly synapseAdmin: () => Promise<string>;
  /** web's read of the door's stored count (GET /count?did=, ADR 0090 decision 2), over real Postgres as chat_auth. */
  readonly count: (did: Did) => Promise<number | null>;
  /** Each body Synapse's pusher posted to the door's count port, with the door's answer, in order. */
  readonly notifications: readonly Notified[];
  /** Posts `body` to the count port as Synapse would; the door's answer. */
  readonly notify: (body: unknown) => Promise<{ status: number; body: unknown }>;
  close(): Promise<void>;
};

export type Notified = { readonly body: unknown; readonly status: number; readonly answer: unknown };

/**
 * The door's count port as Synapse reaches it (ADR 0090 decision 2): the door's own count listener, behind a recorder
 * that keeps each body and answer. Synapse's `ip_range_whitelist` holds 127.0.0.1, as /tmp/spk/homeserver.p612.yaml
 * and C36's dev settings do, so the pusher may call this loopback address. The origin is known before the door is
 * composed, since the door hands it to the page as the pusher's URL (`COUNT_ORIGIN`).
 */
async function startCountPort() {
  let door: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => void res.writeHead(503).end();
  const inner = createServer((req, res) => door(req, res));
  await listen(inner);
  const innerUrl = `http://127.0.0.1:${(inner.address() as AddressInfo).port}`;
  const notifications: Notified[] = [];
  const front = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const upstream = request(
        new URL(req.url ?? "/", innerUrl),
        { method: req.method, headers: req.headers },
        (answer) => {
          const back: Buffer[] = [];
          answer.on("data", (chunk: Buffer) => back.push(chunk));
          answer.on("end", () => {
            const text = Buffer.concat(back).toString();
            if (req.url?.startsWith(NOTIFY)) {
              notifications.push({
                body: parsed(raw.toString()),
                status: answer.statusCode ?? 0,
                answer: parsed(text),
              });
            }
            res.writeHead(answer.statusCode ?? 502, answer.headers).end(text);
          });
        },
      );
      upstream.on("error", () => res.writeHead(502).end());
      upstream.end(raw);
    });
  });
  await listen(front);
  return {
    origin: `http://127.0.0.1:${(front.address() as AddressInfo).port}`,
    innerUrl,
    notifications,
    serve(listener: typeof door) {
      door = listener;
    },
    async close() {
      inner.closeAllConnections();
      front.closeAllConnections();
      await Promise.all([close(inner), close(front)]);
    },
  };
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const send = (url: URL | string, init: RequestInit) => fetch(url, init); // guard-allow: egress test, local MAS and the door's count port only

/** The door, chat-admin on the real MAS, an edge that sends /_matrix/client/* to the real Synapse, and the proxy. */
export async function startRealStack(
  db: ChatDatabase,
  pageDir: string,
  dir: string,
  servers: RealServers,
): Promise<RealStack> {
  const masClient = createMas({
    adminUrl: servers.masAdmin,
    tokenUrl: servers.mas,
    clientId: servers.clientId,
    clientSecret: servers.clientSecret,
  });
  const unused = { url: new URL("http://127.0.0.1:9") } as FakeMas;
  const service = await startService(unused, { mas: masClient, sessionTtl: 3600 });
  const doorKey = String(service.door.privateKey.export({ type: "pkcs8", format: "pem" }));
  const countPort = await startCountPort();
  const env = {
    UNSET_ENV: "dev",
    UNSET_SERVICE: "chat-auth",
    UNSET_COMMIT: "c".repeat(40),
    LISTEN_PORT: "8090",
    PUBLIC_ORIGIN: "https://unset.cc",
    HTTP_ALLOWED_HOSTS: "unset.cc",
    TRUSTED_PROXY_MODE: "socket",
    WEB_ORIGIN: "https://unset.sh",
    PG_HOST: "127.0.0.1",
    PG_PORT: String(db.port),
    PG_DATABASE: "unset",
    PG_USER: "chat_auth",
    PG_PASSWORD_FILE: file(dir, "pg", db.password),
    PG_SSLMODE: "disable",
    PG_POOL_MAX: "2",
    SEAL_KEYRING_FILE: file(
      dir,
      "seal",
      JSON.stringify({ active: "d1", keys: { d1: randomBytes(32).toString("base64") } }),
    ),
    NETGUARD_ALLOW_LOOPBACK: "true",
    CHAT_ADMIN_URL: service.base,
    CHAT_ADMIN_DOOR_KEY_FILE: file(dir, "door", doorKey),
    CHAT_ADMIN_DOOR_KID: service.door.kid,
    CHAT_SERVER_NAME: "unset.cc",
    COUNT_LISTEN_PORT: "8091",
    COUNT_ORIGIN: countPort.origin,
  };
  const door = await compose(
    loadConfig(schema, env),
    { request: () => undefined, untrustedPeer: () => undefined },
    loadChatPage(pageDir),
  );
  const guard = createNetGuard({ internalHosts: [], allowLoopback: true, commit: "c".repeat(40) });
  const chatAdmin = createChatAdminClient(guard, {
    origin: service.base,
    env: "dev",
    key: { kid: service.web.kid, privateKey: service.web.privateKey },
  });
  const members = new Map<string, Member>();
  const member = async (handle: string): Promise<Member> => {
    const user = newChatUser((n) => randomBytes(n));
    const did =
      `did:plc:${[...randomBytes(24)].map((b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("")}` as Did;
    const created = await chatAdmin.createAccount(user, handle as Handle);
    if (created.kind !== "created") throw new Error(`chat account not created: ${created.kind}`);
    const made = { did, user, userId: `@${user}:unset.cc`, handle };
    members.set(handle, made);
    return made;
  };
  // web's half of the hop for the member the browser names (interfaces/web chat-sign-in.ts): sign, then to the door.
  const signIn = async (req: IncomingMessage, res: ServerResponse) => {
    const state = parseDoorState(new URL(req.url ?? "/", "https://unset.sh").searchParams.get("state"));
    const named = /(?:^|;\s*)member=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const who = named === undefined ? undefined : members.get(decodeURIComponent(named));
    if (state === null || who === undefined) return res.writeHead(400).end();
    const ticket = await chatAdmin.signTicket({
      user: who.user,
      did: who.did,
      sid: sessionRef(Buffer.alloc(32, 1)),
      state,
    });
    res.writeHead(303, { location: `https://unset.cc/sign-in/return#${new URLSearchParams({ ticket })}` }).end();
  };
  // The edge's route for the homeserver (ADR 0081 decision 6): the request as it came, to Synapse's client listener.
  const toSynapse = (req: IncomingMessage, res: ServerResponse) => {
    const upstream = request(
      new URL(req.url ?? "/", servers.synapse),
      { method: req.method, headers: { ...req.headers, host: servers.synapse.host } },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    req.pipe(upstream);
  };
  const edge = createTlsServer(certificate(dir), (req, res) => {
    if (req.headers.host === "unset.sh") return void signIn(req, res);
    if (req.url?.startsWith("/_matrix/client/")) return toSynapse(req, res);
    door.listener(req, res);
  });
  countPort.serve(door.count.listener);
  await listen(edge);
  const proxy = await connectProxy((edge.address() as AddressInfo).port);
  const synapseAdmin = async () => {
    const token = await masAdminToken(servers);
    const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const name = `adm${randomBytes(8).toString("hex")}`;
    const made = await send(new URL("/api/admin/v1/users", servers.masAdmin), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ username: name }),
    });
    const id = ((await made.json()) as { data: { id: string } }).data.id;
    const minted = await send(new URL("/api/admin/v1/personal-sessions", servers.masAdmin), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        actor_user_id: id,
        human_name: "e2e checks",
        scope: "urn:matrix:client:api:* urn:synapse:admin:*",
        expires_in: 600,
      }),
    });
    return ((await minted.json()) as { data: { attributes: { access_token: string } } }).data.attributes.access_token;
  };
  return {
    proxy: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    member,
    chatAdmin,
    synapseAdmin,
    async count(did) {
      const answer = await send(`${countPort.innerUrl}/count?${new URLSearchParams({ did })}`, {});
      return ((await answer.json()) as { unread: number | null }).unread;
    },
    notifications: countPort.notifications,
    async notify(body) {
      const answer = await send(`${countPort.origin}${NOTIFY}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: answer.status, body: parsed(await answer.text()) };
    },
    async close() {
      proxy.closeAllConnections();
      edge.closeAllConnections();
      await Promise.all([close(proxy), close(edge)]);
      await door.close();
      await countPort.close();
      await service.close();
    },
  };
}

async function masAdminToken(servers: RealServers): Promise<string> {
  const basic = Buffer.from(`${servers.clientId}:${servers.clientSecret}`).toString("base64");
  const answer = await send(new URL("/oauth2/token", servers.mas), {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "urn:mas:admin" }).toString(),
  });
  return ((await answer.json()) as { access_token: string }).access_token;
}
