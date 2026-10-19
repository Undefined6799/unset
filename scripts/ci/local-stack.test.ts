// P1.35t: the local-stack workflow's pure parts. Docker, sudo and openssl are unmanaged and run only in the workflow.
import { ECDH, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  CLIENT_ID,
  generate,
  maskLines,
  p256DidKey,
  probeVerdict,
  psRows,
  RED_ERROR,
  redCompose,
  SERVICES,
  secp256k1PrivateHex,
  servicesVerdict,
} from "./local-stack.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** The preflight's C6 shape (deployment/preflight/checks/pds.ts isAtprotoDidKey), for a P-256 key. */
function isP256DidKey(value: string): boolean {
  if (!value.startsWith("did:key:z")) return false;
  let n = 0n;
  for (const char of value.slice("did:key:z".length)) n = n * 58n + BigInt(BASE58.indexOf(char));
  const hex = n.toString(16).padStart(70, "0");
  return hex.length === 70 && /^8024(02|03)/.test(hex);
}

const ROOT = join(import.meta.dirname, "../..");
const COMPOSE = readFileSync(join(ROOT, "deployment/compose.local.yaml"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/local-stack.yml"), "utf8");

describe("generated values (D2)", () => {
  test("every_value_is_masked_raw_base64_and_url_encoded", () => {
    const pem = "first line\nabc+/=\nlast line\n";
    const lines = maskLines(pem);
    expect(lines).toContain("::add-mask::abc+/=");
    expect(lines).toContain(`::add-mask::${Buffer.from("abc+/=").toString("base64")}`);
    expect(lines).toContain(`::add-mask::${encodeURIComponent("abc+/=")}`);
    expect(lines).toContain(`::add-mask::${Buffer.from(pem).toString("base64")}`);
    expect(lines.every((line) => !line.slice(1).includes("\n"))).toBe(true);
    expect(maskLines("")).toEqual([]);
  });

  test("values_have_the_runbook_shapes", () => {
    const v = generate();
    for (const password of [v.migrator, v.superuser, v.tap, v.web, v.api, v.indexer]) {
      expect(Buffer.from(password, "base64")).toHaveLength(32);
    }
    expect(new Set([v.migrator, v.superuser, v.tap, v.web, v.api, v.indexer]).size).toBe(6);
    expect(v.jwtSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(v.adminPassword).toMatch(/^[0-9a-f]{64}$/);
    expect(v.rotationKey).toMatch(/^[0-9a-f]{64}$/);
    expect(isP256DidKey(v.recoveryDidKey)).toBe(true);
    const keyring = JSON.parse(v.keyring);
    expect(keyring.active).toBe("k1");
    expect(Buffer.from(keyring.keys.k1, "base64")).toHaveLength(32);
    const [jwk, ...more] = JSON.parse(v.oauthKeys);
    expect(more).toEqual([]);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256", kid: "web-ci", alg: "ES256" });
    expect(typeof jwk.d).toBe("string");
    expect(v.rootKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(v.leafKey).not.toBe(v.rootKey);
  });

  test("recovery_did_key_has_the_preflight_shape", () => {
    for (let i = 0; i < 16; i++) {
      expect(isP256DidKey(p256DidKey(generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey))).toBe(true);
    }
  });

  test("recovery_did_key_carries_the_key_point", () => {
    for (let i = 0; i < 16; i++) {
      const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      let n = 0n;
      for (const char of p256DidKey(publicKey).slice("did:key:z".length)) n = n * 58n + BigInt(BASE58.indexOf(char));
      const point = Buffer.from(n.toString(16).padStart(70, "0").slice(4), "hex");
      const uncompressed = ECDH.convertKey(point, "prime256v1", undefined, "hex", "uncompressed") as string;
      const { x, y } = publicKey.export({ format: "jwk" });
      const xy = Buffer.concat([Buffer.from(x as string, "base64url"), Buffer.from(y as string, "base64url")]);
      expect(uncompressed).toBe(`04${xy.toString("hex")}`);
    }
  });

  test("secp256k1_key_outside_range_refused", () => {
    expect(() => secp256k1PrivateHex(Buffer.alloc(32))).toThrow();
    expect(() => secp256k1PrivateHex(Buffer.alloc(32, 0xff))).toThrow();
    expect(() => secp256k1PrivateHex(Buffer.alloc(31, 1))).toThrow();
    const n = Buffer.from("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", "hex");
    expect(() => secp256k1PrivateHex(n)).toThrow();
    n[31] = 0x40;
    expect(secp256k1PrivateHex(n)).toBe(n.toString("hex"));
  });
});

describe("red stack (item 4)", () => {
  test("red_stack_drops_exactly_the_trust_lines", () => {
    const red = redCompose(COMPOSE);
    const settings = (text: string) => text.split("\n").filter((line) => !/^\s*#/.test(line));
    expect(settings(red).filter((line) => /unset-dev-trust|NODE_EXTRA_CA_CERTS/.test(line))).toEqual([]);
    expect(settings(COMPOSE).filter((line) => /unset-dev-trust|NODE_EXTRA_CA_CERTS/.test(line))).toHaveLength(4);
    expect(COMPOSE.split("\n").length - red.split("\n").length).toBe(4);
  });

  test("red_stack_refuses_a_drifted_file", () => {
    const once = COMPOSE.replace("      NODE_EXTRA_CA_CERTS: /etc/unset-dev-trust/root.pem\n", "");
    expect(() => redCompose(once)).toThrow();
    expect(() => redCompose(COMPOSE.replaceAll("unset-dev-trust:ro", "unset-dev-trust"))).toThrow();
  });
});

describe("the one bounded wait (D4)", () => {
  const up = [
    { Service: "postgres", State: "running", Health: "healthy" },
    { Service: "migrate", State: "exited", ExitCode: 0 },
    { Service: "pds", State: "running", Health: "" },
    { Service: "edge", State: "running", Health: "" },
    { Service: "web", State: "running", Health: "" },
  ];
  const swap = (service: string, row: object) =>
    up.map((r) => (r.Service === service ? { Service: service, ...row } : r));

  test("wait_passes_only_when_every_service_is_up", () => {
    expect(SERVICES).toEqual(["postgres", "migrate", "pds", "edge", "web"]);
    expect(servicesVerdict(up)).toBe("up");
    expect(servicesVerdict(up.filter((r) => r.Service !== "web"))).toBe("failed: web missing");
    expect(servicesVerdict(swap("migrate", { State: "exited", ExitCode: 1 }))).toBe("failed: migrate exited");
    expect(servicesVerdict(swap("pds", { State: "exited", ExitCode: 0 }))).toBe("failed: pds exited");
    expect(servicesVerdict(swap("postgres", { State: "running", Health: "unhealthy" }))).toBe(
      "failed: postgres unhealthy",
    );
  });

  test("wait_waits_on_a_starting_container", () => {
    expect(servicesVerdict(swap("migrate", { State: "running" }))).toBe("starting");
    expect(servicesVerdict(swap("postgres", { State: "running", Health: "starting" }))).toBe("starting");
    expect(servicesVerdict(swap("web", { State: "created" }))).toBe("starting");
    expect(servicesVerdict(swap("edge", { State: "restarting" }))).toBe("starting");
  });

  test("ps_json_read_in_both_forms", () => {
    const lines = up.map((r) => JSON.stringify(r)).join("\n");
    expect(psRows(lines)).toEqual(up);
    expect(psRows(JSON.stringify(up))).toEqual(up);
    expect(psRows("")).toEqual([]);
  });
});

describe("the client_id probe (items 3, 4)", () => {
  // The shape web serves (infrastructure/pds/oauth/oauth-client.ts clientMetadata), abridged.
  const metadata = {
    client_id: CLIENT_ID,
    redirect_uris: ["https://app.unset.localhost/oauth/callback"],
    jwks_uri: "https://app.unset.localhost/oauth/jwks.json",
  };

  test("green_probe_passes_only_on_web_metadata", () => {
    expect(probeVerdict("green", JSON.stringify({ status: 200, body: metadata }))).toBeNull();
    expect(
      probeVerdict("green", JSON.stringify({ status: 200, body: { ...metadata, client_id: "x" } })),
    ).not.toBeNull();
    expect(probeVerdict("green", JSON.stringify({ status: 404, body: metadata }))).not.toBeNull();
    const elsewhere = { ...metadata, redirect_uris: ["https://evil.example/oauth/callback"] };
    expect(probeVerdict("green", JSON.stringify({ status: 200, body: elsewhere }))).not.toBeNull();
    expect(
      probeVerdict("green", JSON.stringify({ status: 200, body: { ...metadata, redirect_uris: [] } })),
    ).not.toBeNull();
    const auth = { ...metadata, jwks_uri: "https://evil.example/oauth/jwks.json" };
    expect(probeVerdict("green", JSON.stringify({ status: 200, body: auth }))).not.toBeNull();
    expect(probeVerdict("green", JSON.stringify({ status: 200, body: null }))).not.toBeNull();
    expect(probeVerdict("green", JSON.stringify({ code: RED_ERROR }))).not.toBeNull();
    expect(probeVerdict("green", "")).not.toBeNull();
  });

  test("red_probe_passes_only_on_the_exact_error", () => {
    expect(probeVerdict("red", JSON.stringify({ code: RED_ERROR }))).toBeNull();
    expect(probeVerdict("red", JSON.stringify({ code: `${RED_ERROR}_` }))).not.toBeNull();
    expect(probeVerdict("red", JSON.stringify({ code: "ECONNREFUSED" }))).not.toBeNull();
    expect(probeVerdict("red", JSON.stringify({ code: "TimeoutError" }))).not.toBeNull();
    expect(probeVerdict("red", JSON.stringify({ status: 200, body: metadata }))).not.toBeNull();
    expect(probeVerdict("red", "not json")).not.toBeNull();
  });
});

describe("the workflow (items 1, 2, 5, 6)", () => {
  test("workflow_is_pull_request_only_and_read_only", () => {
    expect(WORKFLOW).toMatch(/^on:\n {2}pull_request:\n {4}types: \[[^\]]+\]\n\n/m);
    expect(WORKFLOW).not.toMatch(/pull_request_target|workflow_run|push:|workflow_dispatch/);
    expect(WORKFLOW).toMatch(/^permissions: \{\}$/m);
    expect(WORKFLOW.match(/^ {4}permissions:\n {6}contents: read$/gm)?.length).toBe(2);
    expect(WORKFLOW.match(/permissions:/g)?.length).toBe(3);
    expect(WORKFLOW).not.toMatch(/secrets\.|vars\.|environment:|id-token|continue-on-error|privileged|cap_add/);
    expect(WORKFLOW).not.toMatch(/actions\/cache|cache-to|cache-from|upload-artifact/);
    expect(WORKFLOW).not.toMatch(/compose config|docker inspect|printenv|\benv\b *$/m);
  });

  test("workflow_drops_credentials_and_always_cleans_up", () => {
    const checkouts = WORKFLOW.match(/uses: actions\/checkout@/g) ?? [];
    expect(checkouts.length).toBe(2);
    expect(WORKFLOW.match(/persist-credentials: false/g)?.length).toBe(2);
    expect(WORKFLOW.match(/node scripts\/ci\/local-stack\.ts -- clean/g)?.length).toBe(2);
    for (const block of WORKFLOW.split(/\n(?= {6}- )/).filter((b) => /-- clean|local:down|red-down/.test(b))) {
      expect(block).toMatch(/if: always\(\)/);
    }
  });
});
