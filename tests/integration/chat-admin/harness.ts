// Test harness for chat-admin: a fake MAS admin API on a local port (MAS is an unmanaged dependency, rule TE-1), the
// callers' signing keys, and a handler over a real jti file. The fake answers as MAS 1.26.0 does (docs/api/spec.json;
// the live checks of 2026-11-21 in the P6.04 PR): 201/409 on create, 404 for an unknown username, a scope filter
// that matches one whole scope token, 409 on revoking a revoked session; lock, unlock and deactivate answer 200 every
// time and 404 for an unknown ID (checked on the live 1.26.0, its own /api/spec.json, 2026-11-21).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"; // guard-allow: egress test fake, loopback listeners only
import type { AddressInfo } from "node:net"; // guard-allow: egress test fake, a type only
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChatAdminPayload, openJtiStore, signEnvelope } from "@unset/shared-admin-envelope";
import type { ServiceKey } from "../../../interfaces/chat-admin/envelope.ts";
import { createMas } from "../../../interfaces/chat-admin/mas.ts";
import { createQuotas } from "../../../interfaces/chat-admin/quota.ts";
import { createHandler, type HandlerDeps } from "../../../interfaces/chat-admin/server.ts";
import { openSweepCursor } from "../../../interfaces/chat-admin/sweep.ts";
import { createSynapse } from "../../../interfaces/chat-admin/synapse.ts";

export const CLIENT_ID = "01JCHATADM1N0000000000000A";
export const CLIENT_SECRET = "test-client-secret-not-real";
export const ALICE = "alice0000000000000000000";
export const SCOPE_PREFIX = "urn:matrix:client:api:* urn:matrix:client:device:";

type Session = {
  id: string;
  actor: string;
  scope: string;
  revoked: boolean;
  expiresIn: unknown;
  humanName: unknown;
  token: string;
};
type User = { id: string; username: string; locked: boolean; deactivated: boolean; displayname: unknown };

export type FakeMas = {
  url: URL;
  seen: { method: string; path: string; body: string; auth: string | undefined }[];
  users: Map<string, User>;
  /** Usernames the homeserver reserved: create answers 409 and by-username 404 (MAS users/add.rs, UsernameReserved). */
  reserved: Set<string>;
  sessions: Session[];
  /** Each deactivate call, with the body it carried ("" asks MAS to erase: skip_erase defaults to false). */
  erased: { username: string; body: string }[];
  /** When true every call answers 503, as a MAS that is starting or failing does. */
  down: boolean;
  /** Called before each personal-session list answers; a test can add a session to play a device-ID collision. */
  onList: (url: URL) => void;
  close: () => Promise<void>;
};

const ULID = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = () => Array.from(randomBytes(26), (b) => ULID[b % 32]).join("");

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const userResource = (u: User) => ({
  data: {
    type: "user",
    id: u.id,
    attributes: {
      username: u.username,
      locked_at: u.locked ? "2026-11-21T00:00:00Z" : null,
      deactivated_at: u.deactivated ? "2026-11-21T00:00:00Z" : null,
    },
  },
});
const sessionResource = (s: Session, token?: string) => ({
  type: "personal-session",
  id: s.id,
  attributes: {
    actor_user_id: s.actor,
    scope: s.scope,
    revoked_at: s.revoked ? "2026-11-21T00:00:00Z" : null,
    ...(token ? { access_token: token } : {}),
  },
});

function route(fake: FakeMas, req: IncomingMessage, body: string, res: ServerResponse, token: string) {
  const url = new URL(req.url ?? "", "http://mas");
  const path = url.pathname;
  if (fake.down) return json(res, 503, {});
  if (req.method === "POST" && path === "/oauth2/token") {
    const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
    const form = new URLSearchParams(body);
    const good = form.get("grant_type") === "client_credentials" && form.get("scope") === "urn:mas:admin";
    if (req.headers.authorization !== basic || !good) return json(res, 401, { error: "invalid_client" });
    return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 300 });
  }
  if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { errors: [{ title: "Unauthorized" }] });
  const parsed = body === "" ? {} : (JSON.parse(body) as Record<string, unknown>);
  if (req.method === "POST" && path === "/api/admin/v1/users") {
    const username = String(parsed.username);
    if (fake.users.has(username) || fake.reserved.has(username))
      return json(res, 409, { errors: [{ title: "exists" }] });
    const user = { id: ulid(), username, locked: false, deactivated: false, displayname: parsed.displayname };
    fake.users.set(username, user);
    return json(res, 201, userResource(user));
  }
  const byName = /^\/api\/admin\/v1\/users\/by-username\/([^/]+)$/.exec(path);
  if (req.method === "GET" && byName) {
    const user = fake.users.get(decodeURIComponent(byName[1] as string));
    return user === undefined
      ? json(res, 404, { errors: [{ title: "not found" }] })
      : json(res, 200, userResource(user));
  }
  const state = /^\/api\/admin\/v1\/users\/([0-9A-Z]{26})\/(lock|unlock|deactivate)$/.exec(path);
  if (req.method === "POST" && state) {
    const user = [...fake.users.values()].find((u) => u.id === state[1]);
    if (user === undefined) return json(res, 404, { errors: [{ title: "not found" }] });
    if (state[2] === "deactivate") {
      // MAS ends every session of a deactivated user (spec.json, deactivate).
      user.deactivated = true;
      fake.erased.push({ username: user.username, body });
      for (const s of fake.sessions) if (s.actor === user.id) s.revoked = true;
    } else user.locked = state[2] === "lock";
    return json(res, 200, userResource(user));
  }
  if (req.method === "POST" && path === "/api/admin/v1/personal-sessions") {
    const s = {
      id: ulid(),
      actor: String(parsed.actor_user_id),
      scope: String(parsed.scope),
      revoked: false,
      expiresIn: parsed.expires_in,
      humanName: parsed.human_name,
      token: `mpt_${randomBytes(12).toString("hex")}`,
    };
    fake.sessions.push(s);
    return json(res, 201, { data: sessionResource(s, s.token) });
  }
  if (req.method === "GET" && path === "/api/admin/v1/personal-sessions") {
    fake.onList(url);
    const scope = url.searchParams.get("filter[scope]");
    const status = url.searchParams.get("filter[status]");
    const hits = fake.sessions.filter(
      (s) =>
        s.actor === url.searchParams.get("filter[actor_user]") &&
        (scope === null || s.scope.split(" ").includes(scope)) &&
        (status === null || (status === "active") === !s.revoked),
    );
    return json(res, 200, { meta: { count: hits.length }, data: hits.map((s) => sessionResource(s)) });
  }
  const revoke = /^\/api\/admin\/v1\/personal-sessions\/([0-9A-Z]{26})\/revoke$/.exec(path);
  if (req.method === "POST" && revoke) {
    const s = fake.sessions.find((x) => x.id === revoke[1]);
    if (s === undefined) return json(res, 404, {});
    if (s.revoked) return json(res, 409, { errors: [{ title: "already revoked" }] });
    s.revoked = true;
    return json(res, 200, { data: sessionResource(s) });
  }
  json(res, 404, {});
}

/** A fake MAS (token endpoint and admin API on one port) on a free local port. */
export async function fakeMas(): Promise<FakeMas> {
  const token = `mat_${randomBytes(12).toString("hex")}`;
  const fake: FakeMas = {
    url: new URL("http://127.0.0.1"),
    seen: [],
    users: new Map(),
    reserved: new Set(),
    sessions: [],
    erased: [],
    down: false,
    onList: () => {
      // Nothing by default.
    },
    close: async () => {
      // Replaced once the server listens.
    },
  };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      fake.seen.push({ method: req.method ?? "", path: req.url ?? "", body, auth: req.headers.authorization });
      route(fake, req, body, res, token);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}

export function callerKey(kid: string, iss: "web" | "door", verbs: ServiceKey["verbs"]) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const service: ServiceKey = { kid, iss, key: publicKey, verbs };
  return { kid, privateKey, service };
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** web's ticket fields (ADR 0093 decision 3): a test DID, a session reference and the door's one-time value. */
export const TICKET = {
  did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
  sid: "s".repeat(43),
  state: "t".repeat(43),
} as const;

/** A payload for `verb` (default a mint, which carries the ticket fields; every other verb leaves them ""). */
export function payloadFor(overrides: Partial<Record<keyof ChatAdminPayload, unknown>> = {}): ChatAdminPayload {
  const iat = nowSeconds();
  const mint = (overrides.verb ?? "session.mint") === "session.mint";
  return {
    v: 1,
    env: "dev",
    aud: "chat-admin",
    verb: "session.mint",
    user: ALICE,
    name: "",
    device: "",
    ...(mint ? TICKET : { did: "", sid: "", state: "" }),
    jti: randomBytes(16).toString("base64url"),
    iat,
    exp: iat + 60,
    ...overrides,
  } as ChatAdminPayload;
}

export const signed = (key: ReturnType<typeof callerKey>, payload: ChatAdminPayload) =>
  signEnvelope(payload, { kid: key.kid, privateKey: key.privateKey });

export const tempDir = () => mkdtempSync(join(tmpdir(), "chat-admin-"));

/** A running chat-admin handler on a local port, with web's and the door's keys, over a fresh state folder. */
export async function startService(mas: FakeMas, overrides: Partial<HandlerDeps> = {}) {
  const web = callerKey("web-1", "web", [
    "account.create",
    "session.mint",
    "session.end",
    "account.lock",
    "account.unlock",
    "account.deactivate",
    "rooms.sweep",
  ]);
  const door = callerKey("door-1", "door", ["session.end"]);
  const logs: Record<string, unknown>[] = [];
  const deps: HandlerDeps = {
    keys: [web.service, door.service],
    env: "dev",
    mas: createMas({ adminUrl: mas.url, tokenUrl: mas.url, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
    // No Synapse unless a test brings one (fake-synapse.ts): a sweep against this one fails to connect.
    synapse: createSynapse({ adminUrl: new URL("http://127.0.0.1:9") }),
    sessionTtl: 3600,
    jti: openJtiStore(join(tempDir(), "jti.log"), nowSeconds()),
    sweepCursor: openSweepCursor(join(tempDir(), "sweep.cursor")),
    quotas: createQuotas(),
    log: (line) => logs.push(line),
    commit: "c".repeat(40),
    now: () => Date.now(),
    stop: () => {
      throw new Error("the service stopped");
    },
    ...overrides,
  };
  const server = createServer(createHandler(deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (url: string, init: RequestInit) => fetch(url, init); // guard-allow: egress test, local service only
  const post = (path: string, body: unknown, headers = { "content-type": "application/json" }) =>
    send(`${base}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { web, door, base, post, send, close, logs };
}
