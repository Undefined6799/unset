// P1.30: the deploy preflight against fixture stacks written to a temporary directory (git keeps no file modes, and
// C9 needs 0600). The only double is the child-process runner, the preflight's one unmanaged dependency (TE-1).
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { Check } from "./checks/types.ts";
import { type Deps, preflight, type Run } from "./index.ts";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: number[]): string {
  let value = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let text = "";
  for (; value > 0n; value /= 58n) text = BASE58[Number(value % 58n)] + text;
  return text;
}
/** A compressed secp256k1 did:key built here, so no key-shaped string sits in the file. */
const RECOVERY_KEY = `did:key:z${base58([0xe7, 0x01, 0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const EDGE = `ghcr.io/undefined6799/edge@${digest("a")}`;
const PDS = `ghcr.io/undefined6799/mirror/pds@${digest("b")}`;
const CANARY = "canary-7f3c-never-printed";

const PDS_ENV: Record<string, string> = {
  PDS_RECOVERY_DID_KEY: RECOVERY_KEY,
  PDS_INVITE_REQUIRED: "true",
  PDS_CRAWLERS: "",
  PDS_ADMIN_PASSWORD: `${CANARY}-${"x".repeat(16)}`,
  PDS_RATE_LIMITS_ENABLED: "false",
  PDS_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
  LOG_ENABLED: "false",
};
const COMPOSE = `name: unset-prod
services:
  edge:
    image: ${EDGE}
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
  pds:
    image: ${PDS}
    env_file: pds.env
    environment:
      PDS_HOSTNAME: pds.example.test
secrets:
  db_password:
    file: secrets/db_password
`;
const LOCK = {
  edge: { ref: EDGE, origin: "first-party", verify: "cosign-key" },
  pds: { ref: PDS, origin: "upstream", upstreamSource: "docker.io/example/pds", verify: "cosign-key" },
};

type Stack = { compose?: string; pdsEnv?: Record<string, string | null>; lock?: object | null; dotEnv?: string };
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Writes a stack (the all-good one unless overridden) and returns its root and compose path. */
function stack({ compose = COMPOSE, pdsEnv = {}, lock = LOCK, dotEnv }: Stack = {}) {
  const root = mkdtempSync(join(tmpdir(), "preflight-"));
  dirs.push(root);
  mkdirSync(join(root, "deployment/secrets"), { recursive: true });
  const secret = (path: string, text: string) => {
    writeFileSync(join(root, path), text);
    chmodSync(join(root, path), 0o600);
  };
  const env = Object.entries({ ...PDS_ENV, ...pdsEnv }).flatMap(([k, v]) => (v === null ? [] : [`${k}=${v}\n`]));
  secret("deployment/pds.env", env.join(""));
  secret("deployment/secrets/db_password", `${CANARY}\n`);
  if (dotEnv !== undefined) secret("deployment/.env", dotEnv);
  if (lock !== null) writeFileSync(join(root, "deployment/images.lock.json"), JSON.stringify(lock));
  writeFileSync(join(root, "deployment/cosign.pub"), "public key fixture\n");
  writeFileSync(join(root, "deployment/compose.yaml"), compose);
  return { root, file: join(root, "deployment/compose.yaml") };
}

/** The process runner double: verify-images passes, every manifest is an OCI index, and every call is recorded. */
function fakeRun(answers: { verify?: { code: number; stderr: string }; mediaType?: string } = {}) {
  const calls: string[][] = [];
  const run: Run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "docker") {
      const mediaType = answers.mediaType ?? "application/vnd.oci.image.index.v1+json";
      return { code: 0, stdout: JSON.stringify({ mediaType }), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "", ...answers.verify };
  };
  return { run, calls };
}

async function check(s: Stack = {}, env = "prod", deps: Partial<Deps> = {}) {
  const { root, file } = stack(s);
  return preflight(["--env", env, "--compose", file], { root, run: fakeRun().run, ...deps });
}
const failed = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL")).map((l) => l.split(" ")[1]);
async function expectOnly(id: string, s: Stack, env = "prod", deps: Partial<Deps> = {}) {
  const result = await check(s, env, deps);
  expect(failed(result.lines)).toEqual([id]);
  expect(result.code).toBe(1);
  return result.lines.find((l) => l.startsWith(`FAIL ${id}`));
}

describe("preflight", () => {
  test("preflight_all_good_passes", async () => {
    const result = await check();
    expect(result.lines.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(
      Array.from({ length: 12 }, (_, i) => `PASS C${i + 1}`),
    );
    expect(result.code).toBe(0);
  });

  test("c1_project_name_fails", async () => {
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod", "name: unset-dev") });
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod\n", "") });
  });

  test("c2_image_not_ours_or_unlocked_fails", async () => {
    await expectOnly("C2", { compose: COMPOSE.replace(EDGE, `docker.io/library/caddy@${digest("a")}`) });
    await expectOnly("C2", { compose: COMPOSE.replace(EDGE, "ghcr.io/undefined6799/edge:latest") });
    await expectOnly("C2", { compose: COMPOSE.replace(EDGE, `ghcr.io/undefined6799/edge@${digest("c")}`) });
  });

  test("missing_input_fails_check_not_run", async () => {
    const result = await check({ lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C2"))).toMatch(/^FAIL C2 input missing: .*images\.lock\.json$/);
    expect(failed(result.lines)).toEqual(["C2", "C3", "C4", "C5"]);
    expect(result.code).toBe(1);
  });

  test("c3_c4_signature_fails", async () => {
    const edge = fakeRun({ verify: { code: 1, stderr: "edge: signature does not verify: bad\n" } });
    expect(await expectOnly("C3", {}, "prod", { run: edge.run })).toContain("edge: signature does not verify");
    const pds = fakeRun({ verify: { code: 1, stderr: "pds: signature does not verify: bad\n" } });
    await expectOnly("C4", {}, "prod", { run: pds.run });
    // A failure that names no entry (a spawn error) fails both.
    const both = await check({}, "prod", { run: fakeRun({ verify: { code: 1, stderr: "" } }).run });
    expect(failed(both.lines)).toEqual(["C3", "C4"]);
  });

  test("c5_platform_manifest_fails", async () => {
    const { run } = fakeRun({ mediaType: "application/vnd.oci.image.manifest.v1+json" });
    await expectOnly("C5", {}, "prod", { run });
  });

  test("network_check_times_out_and_fails", async () => {
    const run: Run = (_file, _args, signal) =>
      new Promise((done) => signal.addEventListener("abort", () => done({ code: 1, stdout: "", stderr: "" })));
    const result = await check({}, "prod", { run, timeoutMs: 20 });
    // C4 shares C3's verifier run, so it fails on that run's aborted answer rather than its own clock.
    expect(failed(result.lines)).toEqual(["C3", "C4", "C5"]);
    expect(result.lines.filter((l) => l.endsWith("timed out")).map((l) => l.split(" ")[1])).toEqual(["C3", "C5"]);
  });

  test("c6_recovery_key_fails", async () => {
    expect(await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: null } })).toContain("cannot be added");
    // An Ed25519 did:key (multicodec 0xed): a valid did:key, but not a type the PDS accepts for rotation.
    const ed25519 = `did:key:z${base58([0xed, 0x01, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
    await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: ed25519 } });
    await expectOnly("C6", { pdsEnv: { PDS_RECOVERY_DID_KEY: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" } });
  });

  test("c7_settings_fail", async () => {
    await expectOnly("C7", { pdsEnv: { PDS_INVITE_REQUIRED: "false" } });
    await expectOnly("C7", { pdsEnv: { PDS_ADMIN_PASSWORD: "short" } });
    const dev = COMPOSE.replace("name: unset-prod", "name: unset-dev");
    await expectOnly("C7", { compose: dev, pdsEnv: { PDS_CRAWLERS: "https://bsky.network" } }, "dev");
    await expectOnly("C7", { compose: dev, pdsEnv: { PDS_CRAWLERS: null } }, "dev");
  });

  test("c7_pds_rate_limits_enabled_fails", async () => {
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "true" } });
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "False" } });
  });

  test("c7_pds_rate_limits_unset_fails", async () => {
    expect(await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: null } })).toBe(
      "FAIL C7 PDS_RATE_LIMITS_ENABLED is not exactly false",
    );
  });

  test("c8_any_bypass_var_fails", async () => {
    for (const [name, value] of [
      ["PDS_RATE_LIMIT_BYPASS_KEY", "k"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "172.30.10.2"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "172.30.10.4"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "172.30.10.0/24"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", ""],
    ] as const) {
      expect(await expectOnly("C8", { pdsEnv: { [name]: value } })).toBe(`FAIL C8 ${name} is set in pds`);
    }
    // In any service, not only the PDS.
    const edgeEnv = COMPOSE.replace("    ports:", "    environment:\n      PDS_RATE_LIMIT_BYPASS_KEY: x\n    ports:");
    await expectOnly("C8", { compose: edgeEnv });
  });

  test("c9_secret_file_fails", async () => {
    const { root, file } = stack();
    chmodSync(join(root, "deployment/secrets/db_password"), 0o644);
    const loose = await preflight(["--env", "prod", "--compose", file], { root, run: fakeRun().run });
    expect(loose.lines).toContain(`FAIL C9 ${join(root, "deployment/secrets/db_password")} is not mode 0600`);
    const other = await check({}, "prod", { uid: 4242 });
    expect(failed(other.lines)).toEqual(["C9"]);
    const absent = await check({ compose: COMPOSE.replace("secrets/db_password", "secrets/absent") });
    expect(failed(absent.lines)).toEqual(["C9"]);
  });

  test("c10_published_port_fails", async () => {
    await expectOnly("C10", { compose: COMPOSE.replace('"127.0.0.1:2019:2019"', '"2019:2019"') });
    const pdsPort = COMPOSE.replace(
      "    env_file: pds.env",
      '    env_file: pds.env\n    ports: ["127.0.0.1:443:3000"]',
    );
    await expectOnly("C10", { compose: pdsPort });
    const range = COMPOSE.replace("    env_file: pds.env", '    env_file: pds.env\n    ports: ["0.0.0.0:3000:3000"]');
    await expectOnly("C10", { compose: range });
  });

  test("c11_smtp_fails", async () => {
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: null } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587" } });
    await expectOnly("C11", { pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    await expectOnly("C11", {
      pdsEnv: { PDS_EMAIL_SMTP_URL: "smtps://mail.example.test?tls.rejectUnauthorized=false" },
    });
    const tls = await check({ pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mail.example.test:587?requireTLS=true" } });
    expect(failed(tls.lines)).toEqual([]);
    const dev = COMPOSE.replace("name: unset-prod", "name: unset-dev");
    const mailpit = await check({ compose: dev, pdsEnv: { PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } }, "dev");
    expect(failed(mailpit.lines)).toEqual([]);
  });

  test("c12_log_enabled_fails", async () => {
    expect(await expectOnly("C12", { pdsEnv: { LOG_ENABLED: "true" } })).toContain("pds-debug-logging.md");
    const unset = await check({ pdsEnv: { LOG_ENABLED: null } });
    expect(failed(unset.lines)).toEqual([]);
  });

  test("environment_overrides_env_file_and_interpolates_dotenv", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not a JS template.
    const compose = COMPOSE.replace("      PDS_HOSTNAME:", "      LOG_ENABLED: ${LOG}\n      PDS_HOSTNAME:");
    await expectOnly("C12", { compose, dotEnv: "LOG=true\n" });
    expect(failed((await check({ compose, dotEnv: "LOG=false\n" })).lines)).toEqual([]);
  });

  test("preflight_never_prints_secrets", async () => {
    const outputs = await Promise.all([
      check(),
      check({ pdsEnv: { PDS_ADMIN_PASSWORD: CANARY } }),
      check({ pdsEnv: { PDS_EMAIL_SMTP_URL: `smtp://user:${CANARY}@mail.example.test` } }),
      check({ pdsEnv: { PDS_RATE_LIMIT_BYPASS_KEY: CANARY } }),
      check({ pdsEnv: { PDS_RECOVERY_DID_KEY: CANARY } }),
      check({}, "prod", { checks: [{ id: "CX", run: () => Promise.reject(new Error(CANARY)) }] }),
    ]);
    for (const { lines } of outputs) expect(lines.join("\n")).not.toContain(CANARY);
  });

  test("preflight_no_skip_flag", async () => {
    const { root, file } = stack();
    for (const argv of [
      ["--env", "prod", "--compose", file, "--skip", "C3"],
      ["--env", "prod", "--compose", file, "C3"],
      ["--env", "staging", "--compose", file],
      ["--env", "prod"],
    ]) {
      expect((await preflight(argv, { root, run: fakeRun().run })).code).toBe(2);
    }
  });

  test("preflight_check_throws_fails_closed", async () => {
    const throws: Check = {
      id: "CX",
      run: () => {
        throw new Error("boom");
      },
    };
    const result = await check({}, "prod", { checks: [throws] });
    expect(result).toEqual({ code: 1, lines: ["FAIL CX check error"] });
  });

  test("preflight_does_not_call_docker_compose_config", async () => {
    const { run, calls } = fakeRun();
    await check({}, "prod", { run });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).not.toContain("compose");
    expect(calls.map((call) => call.slice(0, 2))).toContainEqual(["docker", "buildx"]);
  });

  test("unreadable_env_file_cannot_run", async () => {
    const result = await check({ compose: COMPOSE.replace("env_file: pds.env", "env_file: absent.env") });
    expect(result.code).toBe(2);
    expect(result.lines[0]).toMatch(/^ERROR cannot read .*absent\.env$/);
    const loose = await check({ pdsEnv: { PDS_HOSTNAME: '"quoted"' } });
    expect(loose.code).toBe(2);
  });
});
