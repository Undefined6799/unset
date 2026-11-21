// C3 (outside review 2026-11-19) against the pinned PDS image: a new card is created with swapCommit set to the head
// read by com.atproto.sync.getLatestCommit (infrastructure/pds/card-records.ts), so the card limit holds across tabs.
// This checks the two calls on the real PDS the stack runs (@atproto/pds 0.5.51, deployment/pds/source.lock.json):
// the head reads as a CID, a create on that head lands, and a second create on the same, now stale, head is refused
// as InvalidSwap with nothing written. The member's own token signs every call; the app's OAuth (DPoP) token takes the
// same verifier on both routes (api/com/atproto/sync/getLatestCommit.ts authorizationOrAdminTokenOptional and
// repo/createRecord.ts authorization at atproto fb16c8e0, auth-verifier.ts), which the full stack test (P1.33z) covers.
// PLC is the one service the PDS calls here; a stand-in on the throwaway network accepts its operation.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cleanUpAll, docker, killBefore, withCleanup } from "../support/docker.ts";

type LockEntry = { ref: string; tag: string; digest: string };
const bases = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../deployment/images/bases.lock.json"), "utf8"),
) as Record<string, LockEntry>;
const PDS = bases.pds === undefined ? undefined : `${bases.pds.ref}:${bases.pds.tag}@${bases.pds.digest}`;

const TEST_MS = 300_000;
const RUN_MS = 150_000;
const SHORT_MS = 20_000;
const runCall = { timeoutMs: killBefore(RUN_MS) };
const shortCall = { timeoutMs: killBefore(SHORT_MS) };
const hex = (bytes = 6): string => randomBytes(bytes).toString("hex");

/** Answers every PLC operation the PDS posts with 200, as plc.directory accepts a valid one. */
const PLC_STAND_IN = `require("node:http").createServer((q, s) => { q.resume(); q.on("end", () => {
  s.writeHead(200, { "content-type": "application/json" }); s.end("{}"); }); }).listen(2582);`;

/** Runs on the network: waits for the PDS, makes an account, then reads the head and creates twice on it. */
const PROBE = `const base = "http://pds:3000/xrpc/";
const call = async (method, nsid, body, token) => {
  const headers = token ? { authorization: "Bearer " + token } : {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + nsid, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
(async () => {
  for (let i = 0; i < 120; i += 1) {
    const up = await fetch("http://pds:3000/xrpc/_health").then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((d) => setTimeout(d, 500));
  }
  const made = await call("POST", "com.atproto.server.createAccount", {
    handle: "swap.pds.test", email: "swap@pds.test", password: process.argv[1],
  });
  if (made.status !== 200) return console.log(JSON.stringify({ made }));
  const { did, accessJwt: token } = made.body;
  const head = await call("GET", "com.atproto.sync.getLatestCommit?did=" + encodeURIComponent(did), undefined, token);
  const record = { $type: "sh.unset.card", content: { $type: "sh.unset.block.text", text: "a" },
    createdAt: new Date().toISOString() };
  const create = () => call("POST", "com.atproto.repo.createRecord",
    { repo: did, collection: "sh.unset.card", record, swapCommit: head.body.cid }, token);
  const first = await create();
  const stale = await create();
  const listed = await call("GET", "com.atproto.repo.listRecords?collection=sh.unset.card&repo=" +
    encodeURIComponent(did), undefined, token);
  console.log(JSON.stringify({
    head: [head.status, typeof head.body.cid],
    first: first.status,
    stale: [stale.status, stale.body.error],
    cards: (listed.body.records ?? []).length,
  }));
})();`;

describe("swapCommit on the pinned PDS", () => {
  test("a_create_on_a_stale_head_is_refused_and_writes_nothing", { timeout: TEST_MS }, () => {
    expect(PDS).toBeDefined();
    const network = `unset-test-swap-${hex()}`;
    const plc = `unset-test-plc-${hex()}`;
    const pds = `unset-test-pds-${hex()}`;
    const env = {
      PDS_HOSTNAME: "pds.test",
      PDS_SERVICE_HANDLE_DOMAINS: ".pds.test",
      PDS_PORT: "3000",
      PDS_DATA_DIRECTORY: "/tmp",
      PDS_BLOBSTORE_DISK_LOCATION: "/tmp/blobs",
      PDS_JWT_SECRET: hex(16),
      PDS_ADMIN_PASSWORD: hex(16),
      PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX: hex(32),
      PDS_DID_PLC_URL: "http://plc:2582",
      PDS_INVITE_REQUIRED: "false",
      PDS_CRAWLERS: "",
      PDS_RATE_LIMITS_ENABLED: "false",
      LOG_ENABLED: "false",
    };
    withCleanup(
      () => {
        expect(docker(["network", "create", "--internal", network], shortCall).code).toBe(0);
        const plcUp = docker(
          ["run", "-d", "--name", plc, "--network", network, "--network-alias", "plc", "--entrypoint", "node"].concat([
            PDS as string,
            "-e",
            PLC_STAND_IN,
          ]),
          runCall,
        );
        expect(plcUp.code, plcUp.err.slice(-2000)).toBe(0);
        const pdsUp = docker(
          ["run", "-d", "--name", pds, "--network", network, "--network-alias", "pds"]
            .concat(Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]))
            .concat([PDS as string]),
          runCall,
        );
        expect(pdsUp.code, pdsUp.err.slice(-2000)).toBe(0);
        const probe = docker(
          ["run", "--rm", "--network", network, "--entrypoint", "node", PDS as string, "-e", PROBE, hex(12)],
          runCall,
        );
        expect(probe.code, probe.err.slice(-2000)).toBe(0);
        const outcome = JSON.parse(probe.out.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>;
        if (!("first" in outcome)) {
          const logs = docker(["logs", "--tail", "60", pds], shortCall);
          expect.fail(`${JSON.stringify(outcome)}\n${logs.out.slice(-3000)}${logs.err.slice(-3000)}`);
        }
        expect(outcome).toEqual({ head: [200, "string"], first: 200, stale: [400, "InvalidSwap"], cards: 1 });
      },
      () =>
        cleanUpAll(
          () => void docker(["rm", "-f", pds, plc], shortCall),
          () => void docker(["network", "rm", network], shortCall),
        ),
    );
  });
});
