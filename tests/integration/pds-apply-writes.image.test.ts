// ADR 0074 against the pinned PDS image: the one Save writes every changed card in one com.atproto.repo.applyWrites
// call with swapCommit set to the head read by com.atproto.sync.getLatestCommit (infrastructure/pds/card-records.ts
// saveCardRecords). This checks on the real PDS the stack runs (@atproto/pds 0.5.51, deployment/pds/source.lock.json)
// that both cards land in one commit, that a second call on the now stale head is refused as InvalidSwap with nothing
// written, and that an update naming a record that is not there fails the whole call, so the other card in it stays
// as it was, and that applyWrites takes a body of about 900 KB but refuses one past 1,000,000 bytes
// (applyWrites.js:50; APPLY_WRITES_BODY_BYTES) with nothing written. The member's own token signs every call; the app's OAuth token takes the same
// verifier (applyWrites.js checks the grant for each action and collection). PLC is the one service the PDS calls
// here; a stand-in accepts it.
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

/** Runs on the network: waits for the PDS, makes an account and two cards, then saves them together three ways. */
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
    handle: "cardsave.pds.test", email: "cardsave@pds.test", password: process.argv[1],
  });
  if (made.status !== 200) return console.log(JSON.stringify({ made }));
  const { did, accessJwt: token } = made.body;
  const card = (text) => ({ $type: "sh.unset.card", content: { $type: "sh.unset.block.text", text },
    createdAt: new Date().toISOString() });
  const keys = [];
  for (const text of ["a", "b"]) {
    const made = await call("POST", "com.atproto.repo.createRecord", { repo: did, collection: "sh.unset.card",
      record: card(text) }, token);
    keys.push(made.body.uri.split("/").at(-1));
  }
  const [a, b] = keys;
  const headOf = async () =>
    (await call("GET", "com.atproto.sync.getLatestCommit?did=" + encodeURIComponent(did), undefined, token)).body.cid;
  const update = (rkey, text) => ({ $type: "com.atproto.repo.applyWrites#update", collection: "sh.unset.card",
    rkey, value: card(text) });
  const save = (writes, swapCommit) => call("POST", "com.atproto.repo.applyWrites", { repo: did, writes, swapCommit },
    token);
  const texts = async () => {
    const listed = await call("GET", "com.atproto.repo.listRecords?collection=sh.unset.card&repo=" +
      encodeURIComponent(did), undefined, token);
    const byKey = Object.fromEntries((listed.body.records ?? []).map((r) => [r.uri.split("/").at(-1), r.value.content.text]));
    return { a: byKey[a], b: byKey[b], count: Object.keys(byKey).length };
  };
  const cids = async () => {
    const listed = await call("GET", "com.atproto.repo.listRecords?collection=sh.unset.card&repo=" +
      encodeURIComponent(did), undefined, token);
    return Object.fromEntries((listed.body.records ?? []).map((r) => [r.uri, r.cid]));
  };
  const head = await headOf();
  const both = await save([update(a, "A1"), update(b, "B1")], head);
  const afterBoth = await headOf();
  const storedCids = await cids();
  const stale = await save([update(a, "A2")], head);
  const missing = await save([update(a, "A3"), update("3jzfcijpj2z2z", "G")], afterBoth);
  const before = await texts();
  const nearLimit = await save([update(a, "x".repeat(450000)), update(b, "y".repeat(450000))], afterBoth);
  const tooLarge = await save([update(a, "x".repeat(510000)), update(b, "y".repeat(510000))], await headOf());
  const after = await texts();
  console.log(JSON.stringify({
    both: both.status,
    oneCommit: typeof both.body.commit?.cid === "string" && both.body.commit.cid === afterBoth,
    // Each update's result names its record and the CID it now has (P1.21v: the page settles on these).
    resultsNameEachCard: (both.body.results ?? []).length === 2 && both.body.results.every((r) =>
      r.$type === "com.atproto.repo.applyWrites#updateResult" && storedCids[r.uri] === r.cid),
    stale: [stale.status, stale.body.error],
    missing: missing.status === 200 ? 200 : missing.status >= 400,
    nearLimit: nearLimit.status,
    tooLarge: tooLarge.status,
    tooLargeWroteNothing: after.a.length === 450000 && after.b.length === 450000,
    texts: before,
  }));
})();`;

describe("applyWrites on the pinned PDS", () => {
  test("two_cards_save_in_one_commit_and_a_stale_partly_missing_or_too_large_save_writes_nothing", {
    timeout: TEST_MS,
  }, () => {
    expect(PDS).toBeDefined();
    const network = `unset-test-apply-${hex()}`;
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
        if (!("both" in outcome)) {
          const logs = docker(["logs", "--tail", "60", pds], shortCall);
          expect.fail(`${JSON.stringify(outcome)}\n${logs.out.slice(-3000)}${logs.err.slice(-3000)}`);
        }
        expect(outcome).toEqual({
          both: 200,
          oneCommit: true,
          resultsNameEachCard: true,
          stale: [400, "InvalidSwap"],
          missing: true,
          nearLimit: 200,
          tooLarge: 413,
          tooLargeWroteNothing: true,
          texts: { a: "A1", b: "B1", count: 2 },
        });
      },
      () =>
        cleanUpAll(
          () => void docker(["rm", "-f", pds, plc], shortCall),
          () => void docker(["network", "rm", network], shortCall),
        ),
    );
  });
});
