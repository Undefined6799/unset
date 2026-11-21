// What chat-page.chromium.spec.ts runs the chat page against (build step 7; ADR 0088): apps/chat built by Vite, served
// by the door's own composition root (interfaces/chat-auth/compose.ts) against real Postgres as `chat_auth` (TE-2) and
// real chat-admin, with web's own client signing the ticket. The fakes are the unmanaged dependencies only (TE-1): MAS
// (chat-admin's harness) and the homeserver, which answers the client-server API calls the page makes as Synapse would,
// keys included, for one account (https://spec.matrix.org/v1.18/client-server-api/). One TLS listener plays the
// edge: unset.cc's /_matrix/client/* to the homeserver, the rest of unset.cc to the door, and unset.sh's /chat/sign-in
// to web's half of the hop. The browser reaches it through a CONNECT proxy of its own, as the rest of the harness
// reaches unset.test (fixtures/servers.ts): the browser may run in Playwright's image (e2e.yml, P0.07n), where no
// launch flag of ours applies, so the names are mapped by the proxy, not by --host-resolver-rules.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"; // guard-allow: egress test fakes and proxy, loopback only
import { createServer as createTlsServer } from "node:https"; // guard-allow: egress test edge, loopback listener only
import { type AddressInfo, connect } from "node:net"; // guard-allow: egress the proxy's tunnels reach the loopback edge only
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { Did, Handle } from "@unset/domains-identity";
import { newChatUser, parseDoorState, sessionRef } from "@unset/domains-messaging";
import { createChatAdminClient } from "@unset/infrastructure-matrix";
import { createNetGuard } from "@unset/infrastructure-net-guard";
import { loadConfig } from "@unset/shared-config";
import { compose } from "../../../interfaces/chat-auth/compose.ts";
import { schema } from "../../../interfaces/chat-auth/config.ts";
import { loadChatPage } from "../../../interfaces/chat-auth/page.ts";
import { fakeMas, startService } from "../../integration/chat-admin/harness.ts";
import { migrateAsMigrator, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";
import { fakeRooms } from "./chat-rooms.ts";

const ROOT = join(import.meta.dirname, "../../..");
const ALICE = `did:plc:${"a".repeat(24)}` as Did;

/** A folder for this run's files, removed when the process ends. */
export function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "unset-e2e-chat-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** apps/chat as Vite builds it for production, into `outDir`. */
export function buildChatPage(outDir: string): void {
  execFileSync("npx", ["vite", "build", "apps/chat", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

export type ChatDatabase = { readonly port: number; readonly password: string };

/** Postgres with the real migrations, `chat_auth` given a password for this run. stopChatDatabase removes it. */
export async function startChatDatabase(): Promise<ChatDatabase> {
  const migratorPassword = randomPassword();
  const postgres = await startPostgres({
    initDir: join(ROOT, "deployment/postgres/init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  const password = randomPassword();
  postgres.sql("unset", `ALTER ROLE chat_auth PASSWORD '${password}'`);
  return { port: postgres.port, password };
}

export const stopChatDatabase = stopAllPostgres;

function file(dir: string, name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents);
  chmodSync(path, 0o600);
  return path;
}

function certificate(dir: string): { key: Buffer; cert: Buffer } {
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "1", "-subj"].concat([
      "/CN=unset.cc",
      "-addext",
      "subjectAltName=DNS:unset.cc,DNS:unset.sh",
      "-keyout",
      join(dir, "tls.key"),
      "-out",
      join(dir, "tls.crt"),
    ]),
    { stdio: "ignore" },
  );
  return { key: readFileSync(join(dir, "tls.key")), cert: readFileSync(join(dir, "tls.crt")) };
}

export type FakeHomeserver = ReturnType<typeof fakeHomeserver>;

type Json = Record<string, unknown>;
type Signed = Json & { signatures?: Record<string, Record<string, string>> };

/**
 * The homeserver, for one account: a quiet sync, and the key endpoints as the spec has them
 * (https://spec.matrix.org/v1.18/client-server-api/#end-to-end-encryption, #server-side-key-backups,
 * #client-config), kept in memory so a setup in one browser and an unlock in another meet the same keys. A second,
 * different signing-key upload is refused as Synapse refuses it under MAS (keys.py SigningKeyUploadServlet: 401 with
 * the m.oauth flow). Account data and changed device lists reach every browser's sync. Direct rooms are
 * fixtures/chat-rooms.ts (build step 9). Every request is kept, with its body, for the checks.
 */
function fakeHomeserver() {
  const seen: { method: string; url: string; auth: string; body: string }[] = [];
  /**
   * `cachedInitialAt`: answer an initial /sync (no `since`) as it stood at that tick, as Synapse does for a device
   * that asks again within sync_response_cache_duration (2 minutes by default: synapse v1.165.0
   * config/cache.py:211-212, the cache key in rest/client/sync.py:210 includes the device). Later syncs bring the rest.
   */
  const state: { refuse: boolean; cachedInitialAt: number | null } = { refuse: false, cachedInitialAt: null };
  const devices: Record<string, Signed> = {};
  const signing: { master?: Signed; self?: Signed; user?: Signed } = {};
  const accountData = new Map<string, { content: Json; at: number }>();
  let backup: Json | null = null;
  let changedAt = 0;
  let clock = 1;
  const rooms = fakeRooms(() => ++clock);
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const userOf = () => Object.values(devices)[0]?.user_id as string | undefined;
  const keyIdOf = (key: Signed | undefined) => Object.values((key?.keys as Record<string, string>) ?? {})[0];
  const merge = (target: Signed | undefined, signed: Signed) => {
    if (target === undefined) return;
    for (const [user, sigs] of Object.entries(signed.signatures ?? {})) {
      target.signatures = { ...target.signatures, [user]: { ...target.signatures?.[user], ...sigs } };
    }
  };
  const sync = (since: number, upTo = clock) => {
    const user = userOf();
    const events = [...accountData]
      .filter(([, v]) => v.at > since && v.at <= upTo)
      .map(([type, v]) => ({ type, content: v.content }));
    const changed = user !== undefined && changedAt > since && changedAt <= upTo;
    const lists = changed ? { changed: [user], left: [] } : { changed: [], left: [] };
    return {
      next_batch: `s${upTo}`,
      rooms: rooms.syncRooms(since),
      account_data: { events },
      to_device: { events: [] },
      device_lists: lists,
    };
  };
  const keys = (path: string, method: string, body: Json, res: ServerResponse) => {
    if (path === "/keys/upload") {
      const device = body.device_keys as Signed | undefined;
      if (device !== undefined) devices[device.device_id as string] = device;
      return reply(res, 200, { one_time_key_counts: { signed_curve25519: 50 } });
    }
    if (path === "/keys/query") {
      const user = userOf();
      if (user === undefined) return reply(res, 200, { device_keys: {}, failures: {} });
      const withUser = (key: Signed | undefined): Record<string, Signed> => (key === undefined ? {} : { [user]: key });
      // Anyone else asked for (the other people in a room) is known to have no devices, as Synapse answers for a
      // user who has none.
      const others = Object.keys((body.device_keys as Json | undefined) ?? {}).filter((u) => u !== user);
      return reply(res, 200, {
        device_keys: { ...Object.fromEntries(others.map((u) => [u, {}])), [user]: devices },
        master_keys: withUser(signing.master),
        self_signing_keys: withUser(signing.self),
        user_signing_keys: withUser(signing.user),
        failures: {},
      });
    }
    if (path === "/keys/device_signing/upload") {
      const master = body.master_key as Signed | undefined;
      if (master === undefined) return reply(res, 400, { errcode: "M_INVALID_PARAM", error: "No master key" });
      if (signing.master !== undefined && keyIdOf(master) !== keyIdOf(signing.master)) {
        const params = { url: "https://account.unset.test/?action=org.matrix.cross_signing_reset" };
        return reply(res, 401, { session: "dummy", flows: [{ stages: ["m.oauth"] }], params: { "m.oauth": params } });
      }
      signing.master = master;
      signing.self = body.self_signing_key as Signed;
      signing.user = body.user_signing_key as Signed;
      changedAt = ++clock;
      return reply(res, 200, {});
    }
    if (path === "/keys/signatures/upload") {
      for (const forUser of Object.values(body) as Record<string, Signed>[]) {
        for (const [id, signed] of Object.entries(forUser)) merge(devices[id] ?? signing.master, signed);
      }
      changedAt = ++clock;
      return reply(res, 200, { failures: {} });
    }
    if (path === "/room_keys/version" && method === "POST") {
      backup = { ...body, version: "1", etag: "0", count: 0 };
      return reply(res, 200, { version: "1" });
    }
    if (path.startsWith("/room_keys/version")) {
      return backup === null
        ? reply(res, 404, { errcode: "M_NOT_FOUND", error: "No backup" })
        : reply(res, 200, backup);
    }
    if (path === "/room_keys/keys") return reply(res, 200, { etag: "1", count: 0 });
    return null;
  };
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization ?? "", body: text });
      answer(req, res, text === "" ? {} : (JSON.parse(text) as Json));
    });
  };
  const answer = (req: IncomingMessage, res: ServerResponse, body: Json) => {
    const url = new URL(req.url ?? "/", "https://unset.cc");
    const method = req.method ?? "GET";
    const path = url.pathname.replace(/^\/_matrix\/client\/(v3|v1|unstable)/, "");
    if (url.pathname === "/_matrix/client/versions") return reply(res, 200, { versions: ["v1.11", "v1.12"] });
    if (state.refuse) return reply(res, 401, { errcode: "M_UNKNOWN_TOKEN", error: "Token is not active" });
    if (path === "/sync") {
      const since = Number(url.searchParams.get("since")?.slice(1) ?? "0");
      const initial = !url.searchParams.has("since");
      const wait = !initial && clock <= since ? 300 : 0;
      const upTo = initial && state.cachedInitialAt !== null ? state.cachedInitialAt : clock;
      setTimeout(() => reply(res, 200, sync(since, upTo)), wait);
      return;
    }
    if (path === "/capabilities") return reply(res, 200, { capabilities: {} });
    if (path === "/pushrules/") return reply(res, 200, { global: {} });
    if (/^\/user\/[^/]+\/filter$/.test(path)) return reply(res, 200, { filter_id: "f1" });
    const data = /^\/user\/[^/]+\/account_data\/([^/]+)$/.exec(path);
    if (data !== null) {
      const type = decodeURIComponent(data[1] ?? "");
      if (method === "PUT") {
        accountData.set(type, { content: body, at: ++clock });
        return reply(res, 200, {});
      }
      const stored = accountData.get(type);
      return stored === undefined
        ? reply(res, 404, { errcode: "M_NOT_FOUND", error: "Not found" })
        : reply(res, 200, stored.content);
    }
    if (keys(path, method, body, res) !== null) return;
    const room = rooms.answer(path, method, body, userOf() ?? "");
    if (room !== null) return reply(res, room[0], room[1]);
    if (path === "/keys/claim") return reply(res, 200, { one_time_keys: {}, failures: {} });
    if (path.startsWith("/sendToDevice/")) return reply(res, 200, {});
    return reply(res, 404, { errcode: "M_NOT_FOUND", error: "Not found" });
  };
  return { seen, state, handle, rooms, now: () => clock };
}

const listen = (server: { listen(port: number, host: string, done: () => void): unknown }) =>
  new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = (server: { close(done: () => void): unknown }) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

/**
 * The browser's proxy: it answers CONNECT for unset.cc:443 and unset.sh:443 only, by opening the tunnel to the edge on
 * 127.0.0.1, and refuses everything else, so a page that reached for any other host fails the test.
 */
async function connectProxy(edgePort: number) {
  const allowed = new Set(["unset.cc:443", "unset.sh:443"]);
  const proxy = createHttpServer((_req, res) => res.writeHead(405).end());
  proxy.on("connect", (req: IncomingMessage, client: Duplex, head: Buffer) => {
    if (!allowed.has(req.url ?? "")) return void client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    const upstream = connect(edgePort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });
  await listen(proxy);
  return proxy;
}

export type ChatStack = {
  /** The proxy a browser context sends unset.cc and unset.sh through. */
  readonly proxy: string;
  readonly homeserver: FakeHomeserver;
  close(): Promise<void>;
};

/** A fresh door, chat-admin with a 75 s session, MAS, homeserver, edge and proxy, for one test. */
export async function startChatStack(db: ChatDatabase, pageDir: string, dir: string): Promise<ChatStack> {
  const mas = await fakeMas();
  const service = await startService(mas, { sessionTtl: 75 });
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
    CHAT_SERVER_NAME: "staging.unset.cc",
  };
  const door = await compose(
    loadConfig(schema, env),
    { request: () => undefined, untrustedPeer: () => undefined },
    loadChatPage(pageDir),
  );
  const user = newChatUser((n) => randomBytes(n));
  const guard = createNetGuard({ internalHosts: [], allowLoopback: true, commit: "c".repeat(40) });
  const web = createChatAdminClient(guard, {
    origin: service.base,
    env: "dev",
    key: { kid: service.web.kid, privateKey: service.web.privateKey },
  });
  const created = await web.createAccount(user, "a.unset.name" as Handle);
  if (created.kind !== "created") throw new Error(`chat account not created: ${created.kind}`);
  const homeserver = fakeHomeserver();
  // web's half of the hop for the signed-in member (interfaces/web chat-sign-in.ts): sign, then back to the door.
  const signIn = async (req: IncomingMessage, res: ServerResponse) => {
    const state = parseDoorState(new URL(req.url ?? "/", "https://unset.sh").searchParams.get("state"));
    if (state === null) return res.writeHead(400).end();
    const ticket = await web.signTicket({ user, did: ALICE, sid: sessionRef(Buffer.alloc(32, 1)), state });
    res.writeHead(303, { location: `https://unset.cc/sign-in/return#${new URLSearchParams({ ticket })}` }).end();
  };
  const edge = createTlsServer(certificate(dir), (req, res) => {
    if (req.headers.host === "unset.sh") return void signIn(req, res);
    if (req.url?.startsWith("/_matrix/client/")) return homeserver.handle(req, res);
    door.listener(req, res);
  });
  await listen(edge);
  const proxy = await connectProxy((edge.address() as AddressInfo).port);
  return {
    proxy: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    homeserver,
    async close() {
      proxy.closeAllConnections();
      edge.closeAllConnections();
      await Promise.all([close(proxy), close(edge)]);
      await door.close();
      await service.close();
      await mas.close();
    },
  };
}
