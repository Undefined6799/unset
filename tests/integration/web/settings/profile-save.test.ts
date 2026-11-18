// P1.20h: the profile save (POST /profile) on the built web server against the stand-in PDS (stand-in-pds.ts), the
// outcomes interfaces/http/routes/profile.test.ts checks with a real OAuth client restoring the member's grant and
// signing each call (TE-1: only the PDS and its authorization server are stood in). Postgres as `web` (TE-2). A
// conflict and a dead grant need a PDS that answers InvalidSwap after a read or 401 to a call, which the stand-in does
// not play; save.server.test.ts checks how the action answers both.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, PDS_HOST, type RunningWeb, startWeb } from "../built-server.ts";
import type { PdsWrite } from "../stand-in-pds.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-save-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
// The server unseals the grant this file stores, so both use one keyring, handed to the server by file.
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });

const PDS = `https://${PDS_HOST}`;
const OWNER = parseDid(`did:plc:${"s".repeat(24)}`) as Did;
const OTHER = `did:plc:${"m".repeat(24)}`;

/** A signed-in browser for OWNER: a grant the OAuth client restores against the stand-in PDS, then a session. */
async function signedIn(): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(OWNER, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: PDS,
      sub: OWNER as SavedSession["tokenSet"]["sub"],
      aud: PDS,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, OWNER, { issuerOrigin: PDS }));
  return `__Host-sid=${created.cookieValue}`;
}

type Server = { web: RunningWeb; writes: () => PdsWrite[] };

/** A server with the stand-in PDS holding OWNER's repo; `failing` names XRPC methods that answer 503. */
async function server(failing?: readonly string[]): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), "web-save-"));
  const writesFile = join(dir, "writes.jsonl");
  writeFileSync(writesFile, "");
  const keyringFile = join(dir, "seal_keyring");
  writeFileSync(keyringFile, KEYRING);
  const pds = { origin: PDS, did: OWNER, records: {}, writesFile, ...(failing === undefined ? {} : { failing }) };
  const web = await startWeb(pg, { SEAL_KEYRING_FILE: keyringFile }, { pds });
  const writes = () =>
    readFileSync(writesFile, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as PdsWrite);
  return { web, writes };
}

let up: Server;
let down: Server;
let cookie: string;
beforeAll(async () => {
  buildOnce(provided.port);
  [up, down] = await Promise.all([server(), server(["putRecord"])]);
  cookie = await signedIn();
}, 120_000);
afterAll(async () => {
  await Promise.all([up?.web.stop(), down?.web.stop()]);
  await pool.end();
});

/** A browser's plain form post to /profile from our own origin. */
const save = (on: Server, body: string) =>
  on.web.fetch("/profile", {
    method: "POST",
    body,
    headers: {
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      accept: "text/html",
      "x-forwarded-for": clientAddress(),
      cookie,
    },
  });

describe("POST /profile on the stand-in PDS", () => {
  test("saves the session's own profile and returns to it", async () => {
    const before = up.writes().length;
    const response = await save(up, "displayName=+Alice+&headline=Designer.&website=https%3A%2F%2Falice.example");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${OWNER}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const written = up.writes().slice(before);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      method: "putRecord",
      collection: "sh.unset.profile",
      rkey: "self",
      record: { displayName: "Alice", headline: "Designer.", website: "https://alice.example" },
    });
  });

  test("Settings › Profile comes back to Settings, and the second save swaps on the first", async () => {
    const before = up.writes().length;
    const response = await save(up, "displayName=Alice&headline=&next=%2Fsettings%2Fprofile");
    expect(response.headers.get("location")).toBe("/settings/profile");
    const [written] = up.writes().slice(before);
    expect(written?.swapRecord).not.toBeNull(); // compare-and-swap on the stored record (DA-4)
  });

  test("a DID in the form never picks whose profile is written (SE-2)", async () => {
    // The stand-in refuses any repo but OWNER's, so a write to OTHER would fail rather than redirect.
    const before = up.writes().length;
    const response = await save(up, `displayName=Mallory&did=${OTHER}&repo=${OTHER}`);
    expect(response.headers.get("location")).toBe(`/${OWNER}`);
    expect(up.writes().slice(before)).toHaveLength(1);
  });

  test("a refused field writes nothing", async () => {
    const before = up.writes().length;
    expect((await save(up, "displayName=A%0AB")).status).toBe(400);
    expect(up.writes()).toHaveLength(before);
  });

  test("an unavailable PDS answers 503 and the session is kept", async () => {
    const response = await save(down, "displayName=Alice");
    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("__Host-sid=;");
    expect(down.writes()).toEqual([]);
    const again = await down.web.fetch("/settings/profile", {
      headers: { accept: "text/html", "x-forwarded-for": clientAddress(), cookie },
    });
    expect(again.status).toBe(200);
  });
});
