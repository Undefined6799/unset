// Test harness for pds-admin: a fake PDS on a local port, web's signing key, and a handler over real state files.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"; // guard-allow: egress test fake, loopback listeners only
import type { AddressInfo } from "node:net"; // guard-allow: egress test fake, a type only
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AdminPayload, openJtiStore, signEnvelope } from "@unset/shared-admin-envelope";
import type { ServiceKey } from "../../../interfaces/pds-admin/envelope.ts";
import { openRequestLog } from "../../../interfaces/pds-admin/log.ts";
import { createPds } from "../../../interfaces/pds-admin/pds.ts";
import { createHandler, type HandlerDeps } from "../../../interfaces/pds-admin/server.ts";

export const PDS_DID = "did:web:pds.example.com";
export const ALICE = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
export const PASSWORD = "test-admin-password-not-real";

/** What the fake PDS saw and how it answers. */
export type FakePds = {
  url: URL;
  seen: { path: string; auth: string | undefined; body: string }[];
  account: Record<string, unknown> | "not_found";
  takedown: boolean;
  codes: number;
  /** Status createInviteCode answers with; 200 by default. */
  createStatus: number;
  /** Called when createInviteCode arrives; it answers once what this returns has settled. */
  onCreate: () => void | Promise<void>;
  /** The admin password this PDS accepts; undefined accepts any, as before P2.09e. */
  password: string | undefined;
  /** Called when getSubjectStatus arrives; it answers once what this returns has settled. */
  onStatus: () => void | Promise<void>;
  /** When true, every call answers 503, as a PDS that is starting or failing does. */
  down: boolean;
  /** One admin method that answers 401 whatever the password: the PDS's password changed after the probe passed. */
  refuse: "getSubjectStatus" | "createInviteCode" | undefined;
  close: () => Promise<void>;
};

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

/** A fake PDS on a free local port. */
export async function fakePds(): Promise<FakePds> {
  const fake: FakePds = {
    url: new URL("http://127.0.0.1"),
    seen: [],
    account: { did: ALICE, emailConfirmedAt: "2026-11-01T00:00:00Z", invites: [] },
    takedown: false,
    codes: 0,
    createStatus: 200,
    password: undefined,
    down: false,
    refuse: undefined,
    onStatus: () => {
      // Nothing by default.
    },
    onCreate: () => {
      // Nothing by default.
    },
    close: async () => {
      // Replaced once the server listens.
    },
  };
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString();
    });
    req.on("end", () => {
      const path = req.url ?? "";
      fake.seen.push({ path, auth: req.headers.authorization, body });
      // A wrong admin password is the PDS's AuthRequiredError, 401 (@atproto/pds 0.5.51 auth-verifier.ts adminToken).
      const admin = path.includes("com.atproto.admin.") || path.includes("createInviteCode");
      const expected = `Basic ${Buffer.from(`admin:${fake.password}`).toString("base64")}`;
      if (fake.down) return json(res, 503, { error: "Unavailable" });
      const wrong = admin && fake.password !== undefined && req.headers.authorization !== expected;
      if (wrong || (fake.refuse !== undefined && path.includes(fake.refuse))) {
        return json(res, 401, { error: "AuthenticationRequired", message: "Authentication Required" });
      }
      if (path.startsWith("/xrpc/com.atproto.admin.getAccountInfo")) {
        // The one account this PDS holds; a DID other than its `did` is NotFound (getAccountInfo.ts), the password
        // probe's included. An account written without a `did` answers every DID, for the handler-only tests.
        const did = new URL(path, "http://pds").searchParams.get("did");
        if (fake.account === "not_found" || (typeof fake.account.did === "string" && fake.account.did !== did)) {
          return json(res, 400, { error: "NotFound", message: "Account not found" });
        }
        return json(res, 200, fake.account);
      }
      if (path.startsWith("/xrpc/com.atproto.admin.getSubjectStatus")) {
        void Promise.resolve(fake.onStatus()).then(() =>
          json(res, 200, { subject: { did: ALICE }, takedown: { applied: fake.takedown } }),
        );
        return;
      }
      if (path === "/xrpc/com.atproto.server.createInviteCode") {
        void Promise.resolve(fake.onCreate()).then(() => {
          if (fake.createStatus !== 200) return json(res, fake.createStatus, { error: "InternalServerError" });
          fake.codes += 1;
          return json(res, 200, { code: `pds-example-com-abcde-${String(fake.codes).padStart(5, "0")}` });
        });
        return;
      }
      if (path.startsWith("/xrpc/com.atproto.identity.resolveHandle")) {
        if (path.includes("admin.")) return json(res, 200, { did: ALICE });
        if (path.includes("status.")) return json(res, 503, { error: "Unavailable" });
        return json(res, 400, { error: "HandleNotFound", message: "Unable to resolve handle" });
      }
      json(res, 404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}

export function webKey(kid = "web-1") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const service: ServiceKey = { kid, iss: "web", key: publicKey, verbs: ["invite.issue"] };
  return { kid, privateKey, publicKey, service };
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function payloadFor(overrides: Partial<Record<keyof AdminPayload, unknown>> = {}): AdminPayload {
  const iat = nowSeconds();
  return {
    v: 1,
    env: "dev",
    aud: "pds-admin",
    pds_did: PDS_DID,
    verb: "invite.issue",
    target: ALICE,
    actor_did: ALICE,
    jti: randomBytes(16).toString("base64url"),
    iat,
    exp: iat + 60,
    ...overrides,
  } as AdminPayload;
}

export const signed = (key: ReturnType<typeof webKey>, payload: AdminPayload) =>
  signEnvelope(payload, { kid: key.kid, privateKey: key.privateKey });

/** A running pds-admin handler on a local port over a fresh state folder. */
export async function startService(pds: FakePds, overrides: Partial<HandlerDeps> = {}, stateDir = tempDir()) {
  const key = webKey();
  const logKey = randomBytes(32);
  const deps: HandlerDeps = {
    keys: [key.service],
    expected: { env: "dev", pdsDid: PDS_DID },
    limits: { signupsOpen: true, windowMs: 24 * 3_600_000, maxPerWindow: 5, maxPerDayGlobal: 100 },
    pds: createPds(pds.url, PASSWORD),
    jti: openJtiStore(join(stateDir, "jti.log"), nowSeconds()),
    log: openRequestLog(join(stateDir, "log.jsonl"), logKey),
    commit: "c".repeat(40),
    now: () => Date.now(),
    stop: () => {
      throw new Error("the service stopped");
    },
    ready: () => true,
    ...overrides,
  };
  const server = createServer(createHandler(deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (url: string, init: RequestInit) => fetch(url, init); // guard-allow: egress test, local service only
  const post = (body: unknown, path = "/v1/invite.issue", headers = { "content-type": "application/json" }) =>
    send(`${base}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  const connections = () => new Promise<number>((resolve) => server.getConnections((_, count) => resolve(count)));
  return {
    key,
    base,
    post,
    close,
    connections,
    stateDir,
    logFile: join(stateDir, "log.jsonl"),
    jtiFile: join(stateDir, "jti.log"),
  };
}

export const tempDir = () => mkdtempSync(join(tmpdir(), "pds-admin-"));
