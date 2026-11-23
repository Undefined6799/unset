// What chat-two-browsers.chromium.spec.ts runs against (build step 11): the whole chat with no stand-in for Matrix. The
// built page and the door's own composition root over real Postgres as `chat_auth` (as fixtures/chat-stack.ts), real
// chat-admin, and a real MAS 1.26.0 and Synapse with our settings, which the run is pointed at by its environment:
//   CHAT_E2E_SYNAPSE_URL           Synapse's client listener, e.g. http://127.0.0.1:8008 (server_name unset.cc)
//   CHAT_E2E_MAS_URL               MAS's listener with the oauth resource, e.g. http://127.0.0.1:8080
//   CHAT_E2E_MAS_ADMIN_URL         MAS's listener with the adminapi resource, e.g. http://127.0.0.1:8082
//   CHAT_E2E_MAS_CLIENT_ID         chat-admin's client, listed in MAS policy.data.admin_clients
//   CHAT_E2E_MAS_CLIENT_SECRET_FILE  its secret, in a file
// The servers run outside the harness (Compose services for them land with the feature, ADR 0098); without these the
// spec skips and says so. web's half of the hop is played here, for whichever member the browser's `member` cookie
// on unset.sh names, with web's own chat-admin client signing the ticket.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type IncomingMessage, request, type ServerResponse } from "node:http"; // guard-allow: egress test edge, forwards to the local Synapse only
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
  /**
   * A new member with a chat account made by chat-admin in the real MAS, display name `handle`; with `publicName`,
   * also a public page under that name (what the door's /chat-name answers, ADR 0107).
   */
  readonly member: (handle: string, publicName?: string) => Promise<Member>;
  /** web's chat-admin client, as the lifecycle jobs call it. */
  readonly chatAdmin: ReturnType<typeof createChatAdminClient>;
  /** A short-lived Synapse admin token for the checks only (a MAS personal session with urn:synapse:admin:*). */
  readonly synapseAdmin: () => Promise<string>;
  close(): Promise<void>;
};

const send = (url: URL | string, init: RequestInit) => fetch(url, init); // guard-allow: egress test, local MAS only

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
    COUNT_ORIGIN: "http://chat-auth:8091",
    LISTEN_ADDRESS: "127.0.0.1",
    COUNT_LISTEN_ADDRESS: "127.0.0.2",
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
  const member = async (handle: string, publicName?: string): Promise<Member> => {
    const user = newChatUser((n) => randomBytes(n));
    const did =
      `did:plc:${[...randomBytes(24)].map((b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("")}` as Did;
    const created = await chatAdmin.createAccount(user, handle as Handle);
    if (created.kind !== "created") throw new Error(`chat account not created: ${created.kind}`);
    if (publicName !== undefined) db.addContact(did, user, publicName);
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
  // web's POST /logout for that session, through GET /logout/chat (interfaces/web chat-sign-out.ts): a ticket for the
  // ended session with a random one-time value, then the door's sign-out page. One GET stands for both.
  const logOut = async (req: IncomingMessage, res: ServerResponse) => {
    const named = /(?:^|;\s*)member=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const who = named === undefined ? undefined : members.get(decodeURIComponent(named));
    const state = parseDoorState(randomBytes(32).toString("base64url"));
    if (state === null || who === undefined) return res.writeHead(400).end();
    const sid = sessionRef(Buffer.alloc(32, 1));
    const ticket = await chatAdmin.signTicket({ user: who.user, did: who.did, sid, state });
    res.writeHead(303, { location: `https://unset.cc/sign-out/return#${new URLSearchParams({ ticket })}` }).end();
  };
  // web's POST /chat/dock (interfaces/web chat-dock.ts): the chat box's one-time value, from a form body, to a ticket.
  const dockTicket = async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const state = parseDoorState(new URLSearchParams(body).get("state"));
    const named = /(?:^|;\s*)member=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const who = named === undefined ? undefined : members.get(decodeURIComponent(named));
    if (state === null || who === undefined || req.headers.origin !== "https://unset.sh")
      return res.writeHead(400).end();
    const ticket = await chatAdmin.signTicket({
      user: who.user,
      did: who.did,
      sid: sessionRef(Buffer.alloc(32, 1)),
      state,
    });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ticket }));
  };
  const unsetSh = (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "https://unset.sh").pathname;
    if (path === "/chat/dock" && req.method === "POST") return void dockTicket(req, res);
    if (path === "/dock-host") return void res.writeHead(200, { "content-type": "text/html" }).end(DOCK_HOST);
    if (path === "/logout") return void logOut(req, res);
    if (path === "/logout/done")
      return void res
        .writeHead(200, { "content-type": "text/html" })
        .end('<title>Signing out</title><meta http-equiv="refresh" content="0;url=/signed-out">');
    if (path === "/signed-out")
      return void res.writeHead(200, { "content-type": "text/html" }).end("<title>Out</title>");
    return void signIn(req, res);
  };
  // The edge's route for the homeserver (ADR 0093 decision 6): the request as it came, to Synapse's client listener.
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
    if (req.headers.host === "unset.sh") return unsetSh(req, res);
    if (req.url?.startsWith("/_matrix/client/")) return toSynapse(req, res);
    door.listener(req, res);
  });
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
    async close() {
      proxy.closeAllConnections();
      edge.closeAllConnections();
      await Promise.all([close(proxy), close(edge)]);
      await door.close();
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

/**
 * unset.sh's shell around the chat box (interfaces/web routes/+layout.svelte), cut to the relay: the frame, the
 * hello, and the box's one-time value to POST /chat/dock and back, each message checked for the frame's own window and
 * origin as the shell does.
 */
const DOCK_HOST = `<!doctype html><title>unset.sh</title>
<iframe data-dock src="https://unset.cc/?dock" style="width:384px;height:576px"></iframe>
<script>
const frame = document.querySelector("iframe");
const to = (data) => frame.contentWindow.postMessage(data, "https://unset.cc");
frame.addEventListener("load", () => to({ type: "unset.dock.hello" }));
addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow || event.origin !== "https://unset.cc") return;
  const m = event.data;
  if (m?.type === "unset.dock.count") document.body.dataset.unread = String(m.unread);
  if (m?.type === "unset.dock.sign_in") {
    const r = await fetch("/chat/dock", { method: "POST", body: new URLSearchParams({ state: m.state }) });
    to({ type: "unset.dock.ticket", ticket: r.ok ? (await r.json()).ticket : null });
  }
});
</script>`;
