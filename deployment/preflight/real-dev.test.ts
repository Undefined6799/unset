// P2.26b (moved from P1.34d item 12): the whole preflight on the real compose.dev.yaml under --env dev, with the real
// deploy lock and Sigstore trusted root path, must pass. The checkout is this one, read as the deploy user's; its
// sibling folders are virtual and hold what the runbook puts there (docs/human/runbooks/dev-stack-secrets.md), with the
// staging names (ADR 0031) and a self-signed leaf for both made by openssl as ADR 0032 has it. There is no retirement
// report: C21 is waived under --env dev (P1.30s); preflight.test.ts keeps prod and local requiring it. The network
// checks answer through a fake runner: the pinned cosign, verify-images passing, OCI indexes and a synchronised clock.
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  type Stats,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseCompose } from "./compose-parse.ts";
import { COSIGN } from "./cosign.ts";
import { type Deps, preflight, type Run } from "./index.ts";

const DEPLOYMENT = resolve(import.meta.dirname, "..");
const CHECKOUT = resolve(DEPLOYMENT, "..");
const COMPOSE = join(DEPLOYMENT, "compose.dev.yaml");
const beside = (name: string) => join(dirname(CHECKOUT), name);
const APP = "staging.unset.sh";
const PDS = "staging.unset.ac";
const DEPLOY_UID = 4242;
const DEV = 0x7fff0003;

/** A did:key the way preflight.test.ts builds one, so no key-shaped string sits in this file. */
function recoveryKey(): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(
    `0x${Buffer.from([0xe7, 0x01, 0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)]).toString("hex")}`,
  );
  let text = "";
  while (n > 0n) {
    text = ALPHABET[Number(n % 58n)] + text;
    n /= 58n;
  }
  return `did:key:z${text}`;
}

describe("compose.dev.yaml under the whole preflight (P2.26b)", () => {
  let pki = "";
  const files = new Map<string, { kind: "dir" | "file"; mode: number; uid: number; text?: string; names?: string[] }>();

  beforeAll(() => {
    pki = mkdtempSync(join(tmpdir(), "compose-dev-"));
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"],
        ...["-keyout", "leaf.key", "-out", "leaf.pem", "-days", "30", "-subj", `/CN=${APP}`],
        ...["-addext", "basicConstraints=critical,CA:FALSE"],
        ...["-addext", `subjectAltName=DNS:${APP},DNS:${PDS}`, "-addext", "extendedKeyUsage=serverAuth"],
      ],
      { cwd: pki, stdio: "ignore" },
    );
    const dir = (path: string, mode: number, names: string[]) =>
      files.set(beside(path), { kind: "dir", mode, uid: DEPLOY_UID, names });
    const file = (path: string, mode: number, text = "fixture\n", uid = DEPLOY_UID) =>
      files.set(beside(path), { kind: "file", mode, uid, text });
    const secrets = parseCompose(readFileSync(COMPOSE, "utf8"), COMPOSE).secretFiles.map(
      (path) => path.split("/").at(-1) as string,
    );
    const owner = (name: string) => (name.startsWith("pg_superuser") || /^pg_(migrator|tap)_/.test(name) ? 999 : 65532);
    dir("unset-dev-secrets", 0o700, secrets);
    for (const name of secrets) file(`unset-dev-secrets/${name}`, 0o400, "fixture\n", owner(name));
    files.set(beside("unset-dev-secrets/dev_tls_cert"), {
      kind: "file",
      mode: 0o400,
      uid: 65532,
      text: readFileSync(join(pki, "leaf.pem"), "utf8"),
    });
    dir("unset-dev-env", 0o700, ["dev-public.env", "pds.env", "newt.env"]);
    const publicEnv = readFileSync(join(DEPLOYMENT, "env/dev-public.example.env"), "utf8")
      .replaceAll("app.example.test", APP)
      .replace("PDS_HOSTNAME=pds.unset.localhost", `PDS_HOSTNAME=${PDS}`)
      .replace("PDS_SERVICE_HANDLE_DOMAINS=.pds.unset.localhost", "PDS_SERVICE_HANDLE_DOMAINS=.staging.unset.im");
    file("unset-dev-env/dev-public.env", 0o600, publicEnv);
    const pdsEnv = readFileSync(join(DEPLOYMENT, "env/pds.example.env"), "utf8")
      .replace("PDS_JWT_SECRET=replace-me", `PDS_JWT_SECRET=${"j".repeat(64)}`)
      .replace("PDS_ADMIN_PASSWORD=replace-me", `PDS_ADMIN_PASSWORD=${"x".repeat(32)}`)
      .replace(
        "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=replace-me",
        `PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX=${"1".repeat(64)}`,
      )
      .replace("PDS_RECOVERY_DID_KEY=replace-me", `PDS_RECOVERY_DID_KEY=${recoveryKey()}`)
      .replace("PDS_EMAIL_SMTP_URL=replace-me", "PDS_EMAIL_SMTP_URL=smtps://mailer:fixture@smtp.example.net:465")
      .replace(
        "PDS_MODERATION_EMAIL_SMTP_URL=replace-me",
        "PDS_MODERATION_EMAIL_SMTP_URL=smtps://mailer:fixture@smtp.example.net:465",
      );
    file("unset-dev-env/pds.env", 0o600, pdsEnv);
    const newtEnv = readFileSync(join(DEPLOYMENT, "env/newt.example.env"), "utf8")
      .replace("PANGOLIN_ENDPOINT=replace-me", "PANGOLIN_ENDPOINT=https://pangolin.example.net")
      .replace("NEWT_ID=replace-me", "NEWT_ID=fixture-site-id")
      .replace("NEWT_SECRET=replace-me", `NEWT_SECRET=${"s".repeat(48)}`);
    file("unset-dev-env/newt.env", 0o600, newtEnv);
  });
  afterAll(() => rmSync(pki, { recursive: true, force: true }));

  const inCheckout = (path: string) => path === CHECKOUT || path.startsWith(`${CHECKOUT}/`);
  const aboveCheckout = (path: string) => path === "/" || CHECKOUT.startsWith(`${path}/`);
  /** A stat of a virtual entry; a copy of a real one, so the methods are Node's. */
  const made = (kind: "dir" | "file", mode: number, uid: number, ino: number): Stats =>
    Object.assign(lstatSync(DEPLOYMENT), {
      mode: (kind === "dir" ? 0o040000 : 0o100000) | mode,
      uid,
      size: kind === "dir" ? 4096 : 24,
      nlink: kind === "dir" ? 2 : 1,
      dev: DEV,
      ino,
    });
  const look = (read: (path: string) => Stats) => (path: string) => {
    const entry = files.get(path);
    if (entry !== undefined) return made(entry.kind, entry.mode, entry.uid, 1 + [...files.keys()].indexOf(path));
    if (aboveCheckout(path)) return made("dir", 0o755, 0, 100 + path.length);
    if (!inCheckout(path)) return null;
    try {
      const info = read(path);
      // The checkout as the deploy user's, with no group or other write.
      return Object.assign(info, { uid: DEPLOY_UID, mode: info.mode & ~0o022 });
    } catch {
      return null;
    }
  };
  const real = <T>(path: string, read: () => T): T | null => {
    if (!inCheckout(path)) return null;
    try {
      return read();
    } catch {
      return null;
    }
  };

  /** The pinned cosign, verify-images passing, an OCI index for every ref, and a synchronised clock. */
  const run: Run = async (file) => {
    if (file === "sha256sum") return { code: 0, stdout: `${COSIGN.sha256.x64}  ${COSIGN.path}\n`, stderr: "" };
    if (file === "timedatectl") return { code: 0, stdout: "yes\n", stderr: "" };
    if (file === "chronyc")
      return { code: 0, stdout: "System time     : 0.000006523 seconds fast of NTP time\n", stderr: "" };
    if (file === "docker") {
      return { code: 0, stdout: JSON.stringify({ mediaType: "application/vnd.oci.image.index.v1+json" }), stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const deps: Deps = {
    root: CHECKOUT,
    run,
    // The x64 cosign the run double answers for, whatever host runs the test (P2.26v).
    arch: "x64",
    readText: (path) => files.get(path)?.text ?? real(path, () => readFileSync(path, "utf8")),
    readRegular: (path) => files.get(path)?.text ?? real(path, () => readFileSync(path, "utf8")),
    readEnv: (path) => {
      const entry = files.get(path);
      return entry?.text === undefined
        ? null
        : { text: entry.text, id: `${DEV}:${[...files.keys()].indexOf(path) + 1}` };
    },
    readdir: (path) => {
      const names = files.get(path)?.names;
      if (names !== undefined) return names.map((name) => Buffer.from(name));
      throw new Error("no such folder");
    },
    lstat: look(lstatSync),
    stat: look(statSync),
    realpath: (path) => (files.has(path) || aboveCheckout(path) ? path : real(path, () => realpathSync.native(path))),
    readlink: (path) => readlinkSync(path),
    statfs: () => ({ type: 0xef53 }),
    uid: DEPLOY_UID,
    environment: {},
  };
  const args = ["--env", "dev", "--compose", COMPOSE, "--interpolation-env", beside("unset-dev-env/dev-public.env")];

  test("preflight_passes_the_real_dev_file", async () => {
    const result = await preflight(args, deps);
    expect(result.lines.filter((line) => !line.startsWith("PASS "))).toEqual([]);
    // P2.24y: five first-party images (the PDS recipe joined them) and newt the one upstream. The C3 line reads
    // "reason withheld" because its count, 5, equals a configured value, which the preflight never prints
    // (preflight/index.ts withheldIfValued); only the verdict of that line is pinned.
    expect(result.lines.filter((line) => line.startsWith("PASS C3 "))).toHaveLength(1);
    expect(result.lines).toContain("PASS C4 1 upstream images verified");
    // Waived under --env dev without a retirement report; only the verdict is pinned, not the reason text.
    expect(result.lines.filter((line) => line.startsWith("PASS C21"))).toHaveLength(1);
    expect(result.code).toBe(0);
  });
});
