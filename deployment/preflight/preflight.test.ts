// P1.30, P1.30s and P1.30t: the deploy preflight against fixture stacks written to a temporary directory (git keeps no file modes, and
// C9 needs 0600). The only double is the child-process runner, the preflight's one unmanaged dependency (TE-1).
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { type Check, fail, type Inputs, missing, pass } from "./checks/types.ts";
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
const WEB = `ghcr.io/undefined6799/web@${digest("d")}`;
const CANARY = "canary-7f3c-never-printed";
const EDGE_DIR = join(import.meta.dirname, "..", "edge");

const PDS_ENV: Record<string, string> = {
  PDS_RECOVERY_DID_KEY: RECOVERY_KEY,
  PDS_INVITE_REQUIRED: "true",
  PDS_CRAWLERS: "",
  PDS_ADMIN_PASSWORD: `${CANARY}-${"x".repeat(16)}`,
  PDS_RATE_LIMITS_ENABLED: "false",
  PDS_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
  LOG_ENABLED: "false",
  PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test",
  PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "true",
  PDS_MODERATION_EMAIL_SMTP_URL: "smtps://mail.example.test:465",
  PDS_MODERATION_EMAIL_ADDRESS: "moderation@example.test",
};
const COMPOSE = `name: unset-prod
services:
  edge:
    image: ${EDGE}
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
    volumes:
      - ./edge/sites/enabled:/etc/caddy/sites/enabled:ro
    environment:
      PDS_HOST: pds.example.test
      PDS_UPSTREAM: pds:3000
      ACME_EMAIL: edge@example.test
  pds:
    image: ${PDS}
    env_file: pds.env
    environment:
      PDS_HOSTNAME: pds.example.test
  web:
    image: ${WEB}
    environment:
      FINGERPRINT_CHECK: arachnid
secrets:
  db_password:
    file: secrets/db_password
`;
const LOCK = {
  edge: { ref: EDGE, origin: "first-party", verify: "cosign-key" },
  pds: { ref: PDS, origin: "upstream", upstreamSource: "docker.io/example/pds", verify: "cosign-key" },
  web: { ref: WEB, origin: "first-party", verify: "cosign-key" },
};
const DEV = COMPOSE.replace("name: unset-prod", "name: unset-dev");
const DEV_ENV = { PDS_SERVICE_HANDLE_DOMAINS: ".0x40.space" };
const IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"].concat([
  "C13",
  "C14",
  "C15",
  "C16",
  "C17",
  "C18",
  "C19",
  "C20",
  "C21",
  "C22",
  "C23",
  "C24",
]);

type Stack = {
  compose?: string;
  pdsEnv?: Record<string, string | null>;
  lock?: object | null;
  dotEnv?: string;
  report?: string;
  /** The network table, written as both networks.dev.json and networks.prod.json: an object, raw text, or none. */
  networks?: object | string | null;
  /** Extra enabled edge sites, by file name. */
  sites?: Record<string, string>;
};
/** The all-good stack's table: every service on Compose's implicit default network. */
const TABLE = { default: { internal: false, members: ["edge", "pds", "web"] } };
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Writes a stack (the all-good one unless overridden) and returns its root and compose path. */
function stack({ compose = COMPOSE, pdsEnv = {}, lock = LOCK, dotEnv, report, networks = TABLE, sites }: Stack = {}) {
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
  // The shipped edge config, with the PDS site enabled the way an environment enables it (C18).
  const edge = join(root, "deployment/edge");
  for (const part of ["Caddyfile", "snippets", "sites"])
    cpSync(join(EDGE_DIR, part), join(edge, part), { recursive: true });
  mkdirSync(join(edge, "sites/enabled"));
  symlinkSync(join(edge, "sites/pds.caddy"), join(edge, "sites/enabled/pds.caddy"));
  for (const [name, text] of Object.entries(sites ?? {})) writeFileSync(join(edge, "sites/enabled", name), text);
  for (const env of ["dev", "prod"]) {
    if (networks === null) continue;
    const table = typeof networks === "string" ? networks : JSON.stringify(networks);
    writeFileSync(join(root, `deployment/networks.${env}.json`), table);
  }
  if (report !== undefined) {
    mkdirSync(join(root, "docs/human/retirement"), { recursive: true });
    writeFileSync(join(root, "docs/human/retirement/retirement-check.json"), report);
  }
  return { root, file: join(root, "deployment/compose.yaml") };
}

type Answer = { code: number; stdout: string; stderr: string; missing?: boolean };
type Answers = { verify?: { code: number; stderr: string }; mediaType?: string; ntp?: Answer; chrony?: Answer };
const ok = (stdout: string): Answer => ({ code: 0, stdout, stderr: "" });
const notInstalled: Answer = { code: 1, stdout: "", stderr: "run failed", missing: true };
const SYNCED = ok("yes\n");
const TRACKING = (offset: string) => ok(`Stratum         : 3\nSystem time     : ${offset} seconds fast of NTP time\n`);

/** The process runner double: verify-images passes, every manifest is an OCI index, the clock is synchronised, and
 * every call is recorded. */
function fakeRun(answers: Answers = {}) {
  const calls: string[][] = [];
  const run: Run = async (file, args) => {
    calls.push([file, ...args]);
    if (file === "timedatectl") return answers.ntp ?? SYNCED;
    if (file === "chronyc") return answers.chrony ?? TRACKING("0.000006523");
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
    expect(result.lines.map((l) => l.split(" ").slice(0, 2).join(" "))).toEqual(IDS.map((id) => `PASS ${id}`));
    expect(result.code).toBe(0);
  });

  test("c1_project_name_fails", async () => {
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod", "name: unset-dev") });
    await expectOnly("C1", { compose: COMPOSE.replace("name: unset-prod\n", "") });
  });

  test("c2_image_not_ours_or_unlocked_fails", async () => {
    // Not the lock's edge ref, so C18 fails too (P1.30w).
    for (const image of [
      `docker.io/library/caddy@${digest("a")}`,
      "ghcr.io/undefined6799/edge:latest",
      `ghcr.io/undefined6799/edge@${digest("c")}`,
    ]) {
      const result = await check({ compose: COMPOSE.replace(EDGE, image) });
      expect(failed(result.lines), image).toEqual(["C2", "C18"]);
      expect(result.code, image).toBe(1);
    }
  });

  test("missing_input_fails_check_not_run", async () => {
    const result = await check({ lock: null });
    expect(result.lines.find((l) => l.startsWith("FAIL C2"))).toMatch(/^FAIL C2 input missing: .*images\.lock\.json$/);
    // C18 reads the lock's edge ref (P1.30w), so it fails closed with the lock too, and without the edge entry alone.
    expect(failed(result.lines)).toEqual(["C2", "C3", "C4", "C5", "C18"]);
    expect(result.code).toBe(1);
    const { edge: _, ...noEdge } = LOCK;
    const unlisted = (await check({ lock: noEdge })).lines;
    expect(failed(unlisted)).toEqual(["C2", "C18"]);
    expect(unlisted).toContain("FAIL C18 input missing: the lock's edge entry");
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
    expect(failed(result.lines)).toEqual(["C3", "C4", "C5", "C24"]);
    const timedOut = result.lines.filter((l) => l.endsWith("timed out")).map((l) => l.split(" ")[1]);
    expect(timedOut).toEqual(["C3", "C5", "C24"]);
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
    await expectOnly("C7", { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_CRAWLERS: "https://bsky.network" } }, "dev");
    await expectOnly("C7", { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_CRAWLERS: null } }, "dev");
  });

  test("c7_pds_rate_limits_enabled_fails", async () => {
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "true" } });
    await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: "False" } });
  });

  test("c7_pds_rate_limits_unset_fails", async () => {
    expect(await expectOnly("C7", { pdsEnv: { PDS_RATE_LIMITS_ENABLED: null } })).toBe(
      "FAIL C7 PDS_RATE_LIMITS_ENABLED does not turn the PDS's own limits off",
    );
  });

  test("c8_any_bypass_var_fails", async () => {
    for (const [name, value] of [
      ["PDS_RATE_LIMIT_BYPASS_KEY", "k"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.2"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.4"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", "198.51.100.0/24"],
      ["PDS_RATE_LIMIT_BYPASS_IPS", ""],
    ] as const) {
      expect(await expectOnly("C8", { pdsEnv: { [name]: value } })).toBe(`FAIL C8 ${name} is set in pds`);
    }
    // In any service, not only the PDS.
    const edgeEnv = COMPOSE.replace("      ACME_EMAIL: edge@example.test", "$&\n      PDS_RATE_LIMIT_BYPASS_KEY: x");
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
    const mailpit = await check(
      { compose: DEV, pdsEnv: { ...DEV_ENV, PDS_EMAIL_SMTP_URL: "smtp://mailpit:1025" } },
      "dev",
    );
    expect(failed(mailpit.lines)).toEqual([]);
  });

  test("c12_log_enabled_fails", async () => {
    expect(await expectOnly("C12", { pdsEnv: { LOG_ENABLED: "true" } })).toContain("pds-debug-logging.md");
    const unset = await check({ pdsEnv: { LOG_ENABLED: null } });
    expect(failed(unset.lines)).toEqual([]);
  });

  test("c12_log_level_outside_allowlist_fails", async () => {
    // LOG_LEVEL is absent or one of five levels; debug and trace log personal data even with logging off for requests.
    for (const level of ["debug", "trace", "INFO", ""]) {
      expect(await expectOnly("C12", { pdsEnv: { LOG_LEVEL: level } })).toBe(
        "FAIL C12 LOG_LEVEL is not one of the allowed levels",
      );
    }
    for (const level of ["info", "warn", "error", "fatal", "silent"]) {
      expect(failed((await check({ pdsEnv: { LOG_LEVEL: level } })).lines)).toEqual([]);
    }
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
      check({ pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: `smtp://user:${CANARY}@mail.example.test` } }),
      check({ pdsEnv: { PDS_LEXICON_AUTHORITY_DID: CANARY, PDS_MOD_SERVICE_URL: CANARY } }),
      check({ pdsEnv: { PDS_RATE_LIMIT_BYPASS_KEY: CANARY } }),
      check({ pdsEnv: { PDS_RECOVERY_DID_KEY: CANARY } }),
      check({}, "prod", { checks: [{ id: "CX", run: () => Promise.reject(new Error(CANARY)) }] }),
    ]);
    for (const { lines } of outputs) expect(lines.join("\n")).not.toContain(CANARY);
  });

  // P1.30m (record 2026-10-12-p130m-preflight-withhold; architecture, end of 2026-10-12-c18-follow-ups): replacing a
  // value inside a reason leaked across maps, against fixed text and through the template, so the runner withholds a
  // whole reason that holds any value the run read, and prints no part of it.
  const WITHHELD = "reason withheld (it contained a configured value)";
  test("runner_withholds_a_reason_holding_any_configured_value", async () => {
    const quote = (text: (inputs: Inputs) => string, outcome = fail): Check => ({
      id: "CX",
      run: (inputs) => outcome(text(inputs)),
    });
    const read = (inputs: Inputs, service: string, name: string) =>
      inputs.serviceEnv.get(service)?.use(name, (v) => v) ?? "";
    // Two maps whose values overlap (N-A): naming the shorter one used to leave the longer one's tail.
    const overlap = COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", "      A: shared-value").replace(
      "      FINGERPRINT_CHECK: arachnid",
      "      FINGERPRINT_CHECK: arachnid\n      B: shared-value-tail",
    );
    const both = quote((i) => `${read(i, "pds", "A")} ${read(i, "web", "B")}`);
    expect((await check({ compose: overlap }, "prod", { checks: [both] })).lines).toEqual([`FAIL CX ${WITHHELD}`]);
    // A value one check read and kept, printed by a later check (N-D), and an `.env` value no service names.
    let kept = "";
    const keep: Check = {
      id: "CK",
      run: (i) => {
        kept = read(i, "pds", "PDS_HOSTNAME");
        return pass();
      },
    };
    const later = quote(() => `host ${kept} is wrong`);
    expect((await check({}, "prod", { checks: [keep, later] })).lines).toEqual(["PASS CK ok", `FAIL CX ${WITHHELD}`]);
    const dotEnvOnly = quote(() => "token dotenv-only-value");
    expect((await check({ dotEnv: "TOKEN=dotenv-only-value\n" }, "prod", { checks: [dotEnvOnly] })).lines).toEqual([
      `FAIL CX ${WITHHELD}`,
    ]);
    // A missing input and a passing reason are withheld the same way; the verdicts and the exit code stand.
    const absent = quote((i) => read(i, "pds", "PDS_HOSTNAME"), missing);
    expect(await check({}, "prod", { checks: [absent] })).toEqual({
      code: 1,
      lines: [`FAIL CX input missing: ${WITHHELD}`],
    });
    const passing = quote((i) => read(i, "web", "FINGERPRINT_CHECK"), pass);
    expect(await check({}, "prod", { checks: [passing] })).toEqual({ code: 0, lines: [`PASS CX ${WITHHELD}`] });
    // A configured value inside the replacement text itself (Codex review on #627): the reason is left empty.
    const marked = { dotEnv: "TOKEN=dotenv-only-value\nMARK=withheld\nWORD=missing\n" };
    expect((await check(marked, "prod", { checks: [dotEnvOnly] })).lines).toEqual(["FAIL CX "]);
    const absentMarked = quote(() => "dotenv-only-value", missing);
    expect((await check(marked, "prod", { checks: [absentMarked] })).lines).toEqual(["FAIL CX "]);
  });

  test("password_probe_is_withheld_whole", async () => {
    // N-C: a password equal to a word of C7's own text used to come back as that text with the word renamed.
    const result = await check({ pdsEnv: { PDS_ADMIN_PASSWORD: "short" } });
    expect(result.code).toBe(1);
    expect(result.lines.filter((l) => l.startsWith("FAIL"))).toEqual([`FAIL C7 ${WITHHELD}`]);
    expect(result.lines.join("\n")).not.toContain("PDS_ADMIN_PASSWORD");
  });

  test("c18_sentinel_withheld_end_to_end", async () => {
    // The edge reader's own scrub (P1.30h) is the first layer; the runner withholds whatever still holds a value.
    const sentinel = "sentinelhost.example.test";
    const compose = COMPOSE.replace("      PDS_HOST: pds.example.test", `      PDS_HOST: ${sentinel}`);
    const result = await check({ compose, sites: { "probe.caddy": '"{$PDS_HOST}" {\n\trespond 204\n}\n' } });
    expect(failed(result.lines)).toContain("C18");
    expect(result.lines.join("\n")).not.toContain(sentinel);
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

const SENTINEL = "sentinel-5d2e-never-printed";
/** Every variable name a check quotes, so a check that starts reading a new one is covered without editing a list. */
function checkedNames(): string[] {
  const dir = join(import.meta.dirname, "checks");
  const names = new Set(Object.keys(PDS_ENV));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const [, name] of readFileSync(join(dir, file), "utf8").matchAll(/"([A-Z][A-Z0-9_]{3,})"/g)) {
      if (name !== undefined) names.add(name);
    }
  }
  return [...names];
}
/** The all-good compose with `env` in both the pds and the web service's environment. */
function inEnvironment(env: Record<string, string>): string {
  const lines = Object.entries(env)
    .map(([k, v]) => `      ${k}: "${v}"`)
    .join("\n");
  return COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", lines).replace(
    "      FINGERPRINT_CHECK: arachnid",
    lines,
  );
}

describe("preflight C13 to C24 (P1.30s)", () => {
  const withEnv = (lines: string) => COMPOSE.replace("      PDS_HOSTNAME: pds.example.test", lines);
  const host = (name: string) => withEnv(`      PDS_HOSTNAME: ${name}`);

  test("c13_lexicon_authority_did_fails", async () => {
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" } });
    await expectOnly("C13", { pdsEnv: { PDS_LEXICON_AUTHORITY_DID: "" } });
  });

  test("c14_dev_mode_fails", async () => {
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "true" } });
    await expectOnly("C14", { pdsEnv: { PDS_DEV_MODE: "1" } });
    expect(failed((await check({ pdsEnv: { PDS_DEV_MODE: "false" } })).lines)).toEqual([]);
  });

  test("c15_handle_domain_0x40_me_fails", async () => {
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.0x40.me" } });
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: null } });
    await expectOnly("C15", { compose: DEV, pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test" } }, "dev");
    expect(failed((await check({ compose: DEV, pdsEnv: DEV_ENV }, "dev")).lines)).toEqual([]);
  });

  test("c16_confirmation_link_required", async () => {
    await expectOnly("C16", { pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: null } });
    await expectOnly("C16", { pdsEnv: { PDS_EMAIL_DISABLE_CONFIRMATION_LINK: "false" } });
  });

  test("c19_moderation_mail_missing_fails", async () => {
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_ADDRESS: null } });
    await expectOnly("C19", { pdsEnv: { PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" } });
    const dev = { ...DEV_ENV, PDS_MODERATION_EMAIL_SMTP_URL: "smtp://mailpit:1025" };
    expect(failed((await check({ compose: DEV, pdsEnv: dev }, "dev")).lines)).toEqual([]);
  });

  test("c20_mod_service_set_fails", async () => {
    await expectOnly("C20", { pdsEnv: { PDS_MOD_SERVICE_URL: "https://mod.example.test" } });
    await expectOnly("C20", { pdsEnv: { PDS_MOD_SERVICE_DID: "did:web:mod.example.test" } });
    expect(failed((await check({ pdsEnv: { PDS_REPORT_SERVICE_URL: "https://r.example.test" } })).lines)).toEqual([]);
  });

  test("c21_part_a_incomplete_fails", async () => {
    const old = host("0x40.space");
    expect(await expectOnly("C21", { compose: old })).toMatch(/input missing: .*retirement-check\.json$/);
    await expectOnly("C21", { compose: old, report: '{"retirement_part_a_complete": false}' });
    await expectOnly("C21", { compose: old, report: '{"retirement_part_a_complete": "true"}' });
    // Duplicate keys are refused by the strict reader rather than read as the last one.
    const twice = '{"retirement_part_a_complete": false, "retirement_part_a_complete": true}';
    await expectOnly("C21", { compose: old, report: twice });
    const done = await check({ compose: old, report: '{"retirement_part_a_complete": true}' });
    expect(failed(done.lines)).toEqual([]);
  });

  test("c21_hostname_case_and_trailing_dot", async () => {
    // A hostname is case-insensitive and may end in one root dot, so these name the old host too.
    for (const name of ["0X40.space", "0x40.SPACE", "0x40.space."]) {
      expect(await expectOnly("C21", { compose: host(name) })).toMatch(/input missing: .*retirement-check\.json$/);
    }
    expect((await check({ compose: host("pds.0x40.space") })).lines).toContain("PASS C21 n/a");
  });

  test("c15_subdomain_entry_refused", async () => {
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,x.0x40.me" } });
    await expectOnly("C15", { pdsEnv: { PDS_SERVICE_HANDLE_DOMAINS: ".x.0x40.me" } });
  });

  test("c22_non_integer_video_max_fails", async () => {
    for (const max of ["2e9", "-1", "0x10", "1.5"]) {
      const compose = withEnv(`      PDS_HOSTNAME: pds.example.test\n      VIDEO_MASTER_MAX_BYTES: "${max}"`);
      expect(await expectOnly("C22", { compose, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "4000000000" } })).toBe(
        "FAIL C22 VIDEO_MASTER_MAX_BYTES is not an integer",
      );
    }
  });

  test("c23_no_service_sets_fingerprint_check", async () => {
    const compose = COMPOSE.replace("    environment:\n      FINGERPRINT_CHECK: arachnid\n", "");
    expect(await expectOnly("C23", { compose })).toBe(
      "FAIL C23 no service sets FINGERPRINT_CHECK to the real fingerprint service",
    );
  });

  test("c24_time_tool_exit_nonzero_fails", async () => {
    const exit = { code: 1, stdout: "", stderr: "" };
    expect(await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: exit }).run })).toBe(
      "FAIL C24 timedatectl failed",
    );
    expect(await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: exit }).run })).toBe(
      "FAIL C24 chronyc tracking failed",
    );
  });

  test("failure_reasons_never_contain_secret_values", async () => {
    // Every variable a check names gets the sentinel, alone and appended to its good value, in the PDS env file and
    // in the pds and web services' environment; with the passing stack too, no output line may hold it.
    const names = checkedNames();
    const each = (value: (name: string) => string) => Object.fromEntries(names.map((n) => [n, value(n)]));
    const alone = each(() => SENTINEL);
    const appended = each((n) => `${PDS_ENV[n] ?? ""}${SENTINEL}`);
    const passing = {
      PDS_ADMIN_PASSWORD: `${SENTINEL}-${"x".repeat(16)}`,
      PDS_EMAIL_SMTP_URL: `smtps://user:${SENTINEL}@mail.example.test:465`,
      PDS_MODERATION_EMAIL_SMTP_URL: `smtps://user:${SENTINEL}@mail.example.test:465`,
    };
    const good = await check({ pdsEnv: passing });
    expect(failed(good.lines)).toEqual([]);
    const bad = ["prod", "dev"].flatMap((env) =>
      [alone, appended].flatMap((pdsEnv) => [check({ pdsEnv }, env), check({ compose: inEnvironment(pdsEnv) }, env)]),
    );
    const outputs = await Promise.all(bad);
    expect(outputs.map(({ code }) => code)).toEqual(outputs.map(() => 1));
    for (const { lines } of [good, ...outputs]) expect(lines.join("\n")).not.toContain(SENTINEL);
  });

  test("c22_blob_limit_below_master_fails", async () => {
    const master = withEnv("      PDS_HOSTNAME: pds.example.test\n      VIDEO_MASTER_MAX_BYTES: 2000000000");
    await expectOnly("C22", { compose: master });
    await expectOnly("C22", { compose: master, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "1999999999" } });
    expect(failed((await check({ compose: master, pdsEnv: { PDS_BLOB_UPLOAD_LIMIT: "2000000000" } })).lines)).toEqual(
      [],
    );
    expect((await check()).lines).toContain("PASS C22 n/a");
  });

  test("c23_prod_fake_fingerprint_fails", async () => {
    // C23 names the key and the service, never a value it could hold, so its reason prints in full (P1.30m).
    expect(
      await expectOnly("C23", { compose: COMPOSE.replace("FINGERPRINT_CHECK: arachnid", "FINGERPRINT_CHECK: fake") }),
    ).toBe("FAIL C23 FINGERPRINT_CHECK in web is not the real fingerprint service");
    await expectOnly("C23", { compose: COMPOSE.replace("FINGERPRINT_CHECK: arachnid", "FAKE_FINGERPRINT_LIST: x") });
    const both = COMPOSE.replace(
      "FINGERPRINT_CHECK: arachnid",
      "FINGERPRINT_CHECK: arachnid\n      FAKE_FINGERPRINT_LIST: x",
    );
    await expectOnly("C23", { compose: both });
    const dev = await check(
      { compose: DEV.replace("FINGERPRINT_CHECK: arachnid", "FINGERPRINT_CHECK: fake"), pdsEnv: DEV_ENV },
      "dev",
    );
    expect(dev.lines).toContain("PASS C23 n/a");
  });

  test("c24_clock_unsynchronised_fails", async () => {
    await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: ok("no\n") }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: TRACKING("2.500000000") }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ ntp: notInstalled }).run });
    await expectOnly("C24", {}, "prod", { run: fakeRun({ chrony: ok("System time : soon\n") }).run });
    // chrony is optional; a .localhost stack (an agent's throwaway one) asks the host nothing.
    expect(failed((await check({}, "prod", { run: fakeRun({ chrony: notInstalled }).run })).lines)).toEqual([]);
    const local = fakeRun({ ntp: ok("no\n") });
    expect((await check({ compose: host("pds.localhost") }, "prod", { run: local.run })).lines).toContain(
      "PASS C24 n/a",
    );
    expect(local.calls.some(([file]) => file === "timedatectl")).toBe(false);
  });
});

describe("preflight C17 (P1.30t)", () => {
  // Two declared networks and the implicit default, in both service forms (compose-spec 05-services.md "networks").
  const NETWORKED = COMPOSE.replace(
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]',
    '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks:\n      front:\n        aliases: [edge]\n      inner:',
  )
    .replace("    env_file: pds.env", "    env_file: pds.env\n    networks: [inner]")
    .replace("secrets:", "networks:\n  front: {}\n  inner:\n    internal: true\nsecrets:");
  const NETWORKED_TABLE = {
    default: { internal: false, members: ["web"] },
    front: { internal: false, members: ["edge"] },
    inner: { internal: true, members: ["edge", "pds"] },
  };
  const cannotRun = async (s: Stack, pattern: RegExp) => {
    const result = await check(s);
    expect(result.code).toBe(2);
    expect(result.lines[0]).toMatch(pattern);
  };

  test("c17_extra_service_on_pds_network_fails", async () => {
    // Only the services the table names may share a network with the PDS (P1.30's check table, C17).
    const withPdsNetwork = (webNetworks: string) =>
      COMPOSE.replace("    env_file: pds.env", "    env_file: pds.env\n    networks: [pds_net]")
        .replace(
          '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]',
          '    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]\n    networks: [default, pds_net]',
        )
        .replace(`    image: ${WEB}`, `    image: ${WEB}\n    networks: ${webNetworks}`)
        .replace("secrets:", "networks:\n  pds_net:\n    internal: true\nsecrets:");
    const table = {
      default: { internal: false, members: ["edge", "web"] },
      pds_net: { internal: true, members: ["edge", "pds"] },
    };
    expect(failed((await check({ compose: withPdsNetwork("[default]"), networks: table })).lines)).toEqual([]);
    expect(await expectOnly("C17", { compose: withPdsNetwork("[default, pds_net]"), networks: table })).toBe(
      "FAIL C17 web is on pds_net, the table says not",
    );
  });

  test("c17_default_network_counted", async () => {
    // A service with no networks key joins `default`, so a table without it, or without one of its members, fails.
    await expectOnly("C17", { networks: {} });
    await expectOnly("C17", { networks: { default: { internal: false, members: ["edge", "pds"] } } });
    // A top-level networks.default changes that network's settings.
    const internal = COMPOSE.replace("secrets:", "networks:\n  default:\n    internal: true\nsecrets:");
    await expectOnly("C17", { compose: internal });
    const table = { default: { internal: true, members: ["edge", "pds", "web"] } };
    expect(failed((await check({ compose: internal, networks: table })).lines)).toEqual([]);
  });

  test("c17_list_and_map_forms", async () => {
    expect(failed((await check({ compose: NETWORKED, networks: NETWORKED_TABLE })).lines)).toEqual([]);
    const outer = { ...NETWORKED_TABLE, inner: { internal: false, members: ["edge", "pds"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: outer })).toContain("inner: internal differs");
    // An attachment key outside the four the subset reads, an empty list, and a network no file defines are refused.
    const mac = NETWORKED.replace("        aliases: [edge]", "        mac_address: 02:42:ac:11:00:02");
    await cannotRun({ compose: mac, networks: NETWORKED_TABLE }, /mac_address/);
    const empty = NETWORKED.replace("networks: [inner]", "networks: []");
    await cannotRun({ compose: empty, networks: NETWORKED_TABLE }, /empty/);
    const undefinedNetwork = NETWORKED.replace("networks: [inner]", "networks: [back]");
    await cannotRun({ compose: undefinedNetwork, networks: NETWORKED_TABLE }, /network back is not defined/);
  });

  test("c17_external_network_refused", async () => {
    const top = (spec: string) => NETWORKED.replace("  front: {}", `  front:\n    ${spec}`);
    await cannotRun({ compose: top("external: true"), networks: NETWORKED_TABLE }, /external/);
    await cannotRun({ compose: top("driver: overlay"), networks: NETWORKED_TABLE }, /driver/);
    await cannotRun({ compose: top("driver_opts: {}"), networks: NETWORKED_TABLE }, /driver_opts/);
    expect(failed((await check({ compose: top("driver: bridge"), networks: NETWORKED_TABLE })).lines)).toEqual([]);
  });

  test("c17_network_mode_fails", async () => {
    for (const mode of ["host", '"service:edge"', '"container:x"', "bridge"]) {
      const compose = COMPOSE.replace("    env_file: pds.env", `    env_file: pds.env\n    network_mode: ${mode}`);
      const table = { default: { internal: false, members: ["edge", "web"] } };
      expect(await expectOnly("C17", { compose, networks: table })).toBe("FAIL C17 network_mode is set in pds");
    }
  });

  test("c17_table_mismatch_each_direction", async () => {
    const spare = { ...NETWORKED_TABLE, spare: { internal: true, members: [] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: spare })).toContain("spare is not in compose");
    const { front: _front, ...noFront } = NETWORKED_TABLE;
    expect(await expectOnly("C17", { compose: NETWORKED, networks: noFront })).toContain("front is not in the table");
    const extra = { ...NETWORKED_TABLE, front: { internal: false, members: ["edge", "web"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: extra })).toContain("web is not on front");
    const fewer = { ...NETWORKED_TABLE, inner: { internal: true, members: ["edge"] } };
    expect(await expectOnly("C17", { compose: NETWORKED, networks: fewer })).toContain("pds is on inner");
  });

  test("c17_table_duplicate_key_refused", async () => {
    const twice =
      '{"default": {"internal": true, "members": []}, "default": {"internal": false, "members": ["edge", "pds", "web"]}}';
    expect(await expectOnly("C17", { networks: twice })).toBe("FAIL C17 the network table is unreadable");
    // The table's own shape is strict too: an unknown key, a repeated member or a string boolean is refused.
    await expectOnly("C17", { networks: { default: { ...TABLE.default, aliases: [] } } });
    await expectOnly("C17", { networks: { default: { internal: false, members: ["edge", "pds", "web", "web"] } } });
    await expectOnly("C17", { networks: { default: { internal: "false", members: ["edge", "pds", "web"] } } });
  });

  test("c17_missing_table_input_missing", async () => {
    expect(await expectOnly("C17", { networks: null })).toMatch(/^FAIL C17 input missing: .*networks\.prod\.json$/);
    const dev = await check({ compose: DEV, pdsEnv: DEV_ENV, networks: null }, "dev");
    expect(dev.lines.find((l) => l.startsWith("FAIL C17"))).toMatch(/networks\.dev\.json$/);
  });
});
