// P1.34d item 11: compose.local.yaml is compose.dev.yaml plus exactly the differences a throwaway stack on one machine
// needs (book edit 2026-10-13-p127l-to-third-lane, Amendment 4; architecture record 2026-10-13-p127l-local-gaps,
// Amendments 1 and 2). The preflight runs in full on the local file too; this catches a weakening it would allow, in
// either direction, naming the service and the key. `environment` is not compared: the preflight's env checks judge it,
// and pds_mail_unset_only_with_logging_off (compose.dev.test.ts) covers both files' PDS.
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
import { pdsNeighbours } from "./preflight/checks/networks.ts";
import { type Compose, type Mount, parseCompose, type Service, TOKEN_READER } from "./preflight/compose-parse.ts";
import { preflight } from "./preflight/index.ts";
import { isLocalOnlyNetwork, LOCAL_ONLY_NETWORKS, LOCAL_ONLY_SERVICES } from "./preflight/local-only.ts";

const DEPLOYMENT = import.meta.dirname;
const parse = (file: string): Compose => parseCompose(readFileSync(join(DEPLOYMENT, file), "utf8"), file);

/** The dev root's public folder, bound read-only into pds and web only (item 5). */
const TRUST: Mount = { type: "bind", source: "../../unset-dev-trust", target: "/etc/unset-dev-trust", readOnly: true };
/** What the local file may add to a service, beyond dev's: mounts, secrets and networks, by service. */
const ADDED: Record<string, { mounts?: Mount[]; secrets?: string[]; networks?: string[] }> = {
  pds: { mounts: [TRUST] },
  web: { mounts: [TRUST] },
  edge: { secrets: ["local_tls_cert", "local_tls_key"] },
};
/** The edge's sites, each its own read-only file in local (item 12), where dev binds the sites folder. */
const EDGE_SITES: { dev: Mount[]; local: Mount[] } = {
  dev: [{ type: "bind", source: "./edge/sites", target: "/etc/caddy/sites/enabled", readOnly: true }],
  local: [
    { type: "bind", source: "./edge/sites/pds.caddy", target: "/etc/caddy/sites/enabled/pds.caddy", readOnly: true },
    { type: "bind", source: "./edge/local/app.caddy", target: "/etc/caddy/sites/enabled/app.caddy", readOnly: true },
    { type: "bind", source: "./edge/local/tls.caddy", target: "/etc/caddy/snippets/tls.caddy", readOnly: true },
  ],
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const without = <T>(list: readonly T[], drop: readonly T[] = []): T[] =>
  list.filter((x) => !drop.some((d) => same(d, x)));

/** Each key of one service that differs between the files beyond what ADDED and EDGE_SITES allow. */
function serviceDrift(dev: Service, local: Service): string[] {
  const added = ADDED[dev.name] ?? {};
  const devMounts = dev.name === "edge" ? without(dev.mounts, EDGE_SITES.dev) : dev.mounts;
  const localMounts = without(local.mounts, [
    ...(added.mounts ?? []),
    ...(dev.name === "edge" ? EDGE_SITES.local : []),
  ]);
  const compared: [string, unknown, unknown][] = [
    ...Object.entries(dev.hardening).map(([key, value]): [string, unknown, unknown] => [
      key,
      value,
      local.hardening[key as keyof Service["hardening"]],
    ]),
    // A pulled image may be built locally instead (judged by C2 to C5, C18, C25 and C27 under the card), never the
    // other way round.
    ["image", dev.image, local.build !== null && dev.build === null ? dev.image : local.image],
    ["build", dev.build, local.build !== null && dev.build === null ? null : local.build],
    ["tmpfs", dev.tmpfs, local.tmpfs],
    ["logging", dev.logging, local.logging],
    ["profiles", dev.profiles, local.profiles],
    ["networkMode", dev.networkMode, local.networkMode],
    ["networks", dev.networks, without(local.networks, [...(added.networks ?? []), ...localOnlyOf(dev.name)])],
    ["ports", dev.ports, local.ports],
    ["mounts", devMounts, localMounts],
    ["secrets", dev.secrets, without(local.secrets, added.secrets)],
    ["dependsOn", dev.dependsOn, local.dependsOn],
  ];
  // Added items must be there in full, so a missing trust mount or leaf secret is a difference too.
  const missingAdded =
    !(added.mounts ?? []).every((m) => local.mounts.some((x) => same(x, m))) ||
    !(added.networks ?? []).every((n) => local.networks.includes(n)) ||
    !(added.secrets ?? []).every((n) => local.secrets.includes(n));
  return [
    ...compared.filter(([, a, b]) => !same(a, b)).map(([key]) => `${dev.name}: ${key} differs`),
    ...(missingAdded ? [`${dev.name}: an allowed local addition is missing`] : []),
  ];
}

/** The local-only networks `service` is a listed member of. */
const localOnlyOf = (service: string): string[] =>
  [...LOCAL_ONLY_NETWORKS].filter(([, row]) => row.members.includes(service)).map(([name]) => name);

/** Each local-only network the local file holds other than as listed, with exactly its listed members. */
function localOnlyNetworkDrift(local: Compose): string[] {
  const problems: string[] = [];
  for (const network of local.networks.filter(({ name }) => isLocalOnlyNetwork(name))) {
    const row = LOCAL_ONLY_NETWORKS.get(network.name);
    if (row === undefined) problems.push(`${network.name} is not on the local-only list`);
  }
  for (const [name, row] of LOCAL_ONLY_NETWORKS) {
    const network = local.networks.find((n) => n.name === name);
    const members = local.services.filter((s) => s.networks.includes(name)).map((s) => s.name);
    if (
      network === undefined ||
      network.internal !== row.internal ||
      !same([...members].sort(), [...row.members].sort())
    )
      problems.push(`${name} differs from the local-only list`);
  }
  return problems;
}

/** Every difference between the files that the local stack is not allowed; none means they agree. */
function drift(dev: Compose, local: Compose): string[] {
  const problems: string[] = [];
  for (const s of local.services) {
    const twin = dev.services.find((d) => d.name === s.name);
    if (twin === undefined && !LOCAL_ONLY_SERVICES.has(s.name)) problems.push(`${s.name} is only in the local file`);
    if (twin !== undefined) problems.push(...serviceDrift(twin, s));
  }
  for (const s of dev.services) {
    if (LOCAL_ONLY_SERVICES.has(s.name)) problems.push(`${s.name} is in the dev file`);
    else if (!local.services.some((l) => l.name === s.name)) problems.push(`${s.name} is only in the dev file`);
  }
  const shared = local.networks.filter(({ name }) => !LOCAL_ONLY_NETWORKS.has(name));
  if (!same(dev.networks, shared)) problems.push("the networks or their internal flags differ");
  problems.push(...localOnlyNetworkDrift(local));
  return problems;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (bytes: number[]): string => {
  let value = bytes.reduce((n, b) => n * 256n + BigInt(b), 0n);
  let text = "";
  for (; value > 0n; value /= 58n) text = BASE58[Number(value % 58n)] + text;
  return text;
};

/** A copy of `compose` with `name`'s service changed by `edit`. */
const editService = (compose: Compose, name: string, edit: (s: Service) => Service): Compose => ({
  ...compose,
  services: compose.services.map((s) => (s.name === name ? edit(s) : s)),
});

describe("compose.local.yaml against compose.dev.yaml (P1.34d item 11)", () => {
  const dev = parse("compose.dev.yaml");
  const local = parse("compose.local.yaml");

  test("compose_local_name_pinned", () => {
    expect(local.name).toBe("unset-local");
  });

  test("compose_local_differs_from_dev_only_as_allowed", () => {
    expect(drift(dev, local)).toEqual([]);
    // The neighbour rule C17 runs at deploy, on the real local file too (#742 item 11; verify-895 F2).
    expect(pdsNeighbours(local)).toEqual([]);
  });

  test("a_weakening_in_either_file_is_named", () => {
    const harden = (s: Service, change: Partial<Service["hardening"]>): Service => ({
      ...s,
      hardening: { ...s.hardening, ...change },
    });
    const cases: [Compose, Compose, string][] = [
      [dev, editService(local, "web", (s) => harden(s, { capDrop: [] })), "web: capDrop differs"],
      [dev, editService(local, "pds", (s) => harden(s, { readOnly: false })), "pds: readOnly differs"],
      [dev, editService(local, "postgres", (s) => harden(s, { user: "0:0" })), "postgres: user differs"],
      [editService(dev, "edge", (s) => harden(s, { capAdd: [] })), local, "edge: capAdd differs"],
      [
        dev,
        editService(local, "edge", (s) => ({ ...s, ports: [{ hostIp: null, published: "443", target: "443" }] })),
        "edge: ports differs",
      ],
      [dev, editService(local, "postgres", (s) => ({ ...s, networks: ["db", "edge"] })), "postgres: networks differs"],
      [dev, editService(local, "migrate", (s) => ({ ...s, mounts: [...s.mounts, TRUST] })), "migrate: mounts differs"],
      [
        dev,
        editService(local, "pds", (s) => ({ ...s, mounts: s.mounts.filter((m) => !same(m, TRUST)) })),
        "pds: an allowed local addition is missing",
      ],
      [
        dev,
        editService(local, "edge", (s) => ({ ...s, secrets: [...s.secrets, "pg_web_password"] })),
        "edge: secrets differs",
      ],
      [dev, editService(local, TOKEN_READER, (s) => ({ ...s, name: "reader2" })), "reader2 is only in the local file"],
      [
        { ...dev, services: [...dev.services, ...local.services.filter((s) => s.name === TOKEN_READER)] },
        local,
        `${TOKEN_READER} is in the dev file`,
      ],
      [
        dev,
        { ...local, networks: local.networks.map((n) => ({ ...n, internal: false })) },
        "the networks or their internal flags differ",
      ],
      // A PLC network the local-only list does not name (architecture 02:32Z).
      [
        dev,
        {
          ...editService(local, "web", (s) => ({ ...s, networks: [...s.networks, "plc_web"] })),
          networks: [...local.networks, { name: "plc_web", internal: true }],
        },
        "plc_web is not on the local-only list",
      ],
    ];
    for (const [d, l, problem] of cases) expect(drift(d, l), problem).toContain(problem);
  });

  test("only_pds_and_web_trust_the_dev_root", () => {
    // Item 5: NODE_EXTRA_CA_CERTS names the bound root on pds and web in the local file, and nowhere else in either.
    const trusting = (compose: Compose) =>
      compose.services
        .filter((s) => s.environment.some(([key]) => key === "NODE_EXTRA_CA_CERTS"))
        .map((s) => [s.name, s.environment.find(([key]) => key === "NODE_EXTRA_CA_CERTS")?.[1]]);
    expect(trusting(local)).toEqual([
      ["pds", { literal: "/etc/unset-dev-trust/root.pem" }],
      ["web", { literal: "/etc/unset-dev-trust/root.pem" }],
    ]);
    expect(trusting(dev)).toEqual([]);
  });
});

/**
 * Item 12: the whole preflight on the real compose.local.yaml under --env local, which admits builds, must pass. The
 * checkout is this one, read as the deploy user's; its sibling folders are virtual and hold what the runbook puts there
 * (docs/human/runbooks/dev-stack-secrets.md), with a throwaway dev root and leaf made by openssl as the runbook does.
 */
describe("compose.local.yaml under the whole preflight (P1.34d item 12)", () => {
  const CHECKOUT = resolve(DEPLOYMENT, "..");
  const beside = (name: string) => join(dirname(CHECKOUT), name);
  const APP = "app.unset.localhost";
  const PDS = "pds.unset.localhost";
  const DEPLOY_UID = 4242;
  const DEV = 0x7fff0002;
  let pki = "";
  const files = new Map<string, { kind: "dir" | "file"; mode: number; uid: number; text?: string; names?: string[] }>();

  beforeAll(() => {
    pki = mkdtempSync(join(tmpdir(), "compose-local-"));
    const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: pki, stdio: "ignore" });
    const key = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
    openssl(
      ...["req", "-x509", ...key, "-keyout", "root.key", "-out", "root.pem", "-days", "30", "-subj", "/CN=root"],
      ...["-addext", "basicConstraints=critical,CA:TRUE,pathlen:0"],
      ...["-addext", "keyUsage=critical,keyCertSign,cRLSign"],
      ...[
        "-addext",
        `nameConstraints=critical,permitted;DNS:${APP},permitted;DNS:${PDS},excluded;IP:0.0.0.0/0.0.0.0,excluded;IP:::/::`,
      ],
    );
    openssl(
      ...["req", "-x509", ...key, "-keyout", "leaf.key", "-out", "leaf.pem", "-days", "30", "-subj", `/CN=${APP}`],
      ...["-CA", "root.pem", "-CAkey", "root.key", "-addext", "basicConstraints=critical,CA:FALSE"],
      ...["-addext", `subjectAltName=DNS:${APP},DNS:${PDS}`, "-addext", "extendedKeyUsage=serverAuth"],
    );
    const pem = (name: string) => readFileSync(join(pki, name), "utf8");
    const dir = (path: string, mode: number, names: string[]) =>
      files.set(beside(path), { kind: "dir", mode, uid: DEPLOY_UID, names });
    const file = (path: string, mode: number, text = "fixture\n", uid = DEPLOY_UID) =>
      files.set(beside(path), { kind: "file", mode, uid, text });
    const secrets = parse("compose.local.yaml").secretFiles.map((path) => path.split("/").at(-1) as string);
    const owner = (name: string) => (name.startsWith("pg_superuser") || /^pg_(migrator|tap)_/.test(name) ? 999 : 65532);
    dir("unset-dev-secrets", 0o700, secrets);
    for (const name of secrets) file(`unset-dev-secrets/${name}`, 0o400, "fixture\n", owner(name));
    dir("unset-dev-env", 0o700, ["dev-public.env", "pds.env", "local-leaf.pem"]);
    file(
      "unset-dev-env/dev-public.env",
      0o600,
      [
        `WEB_PUBLIC_ORIGIN=https://${APP}`,
        `WEB_ALLOWED_HOSTS=${APP}`,
        "WEB_MEDIA_ORIGIN=https://media.example.net",
        `APP_HOST=${APP}`,
        `PDS_HOSTNAME=${PDS}`,
        `PDS_SERVICE_HANDLE_DOMAINS=.${PDS}`,
        "EDGE_ACME_EMAIL=edge@example.test",
        "",
      ].join("\n"),
    );
    // The template with its two checked placeholders filled: a recovery did:key built here (as preflight.test.ts does,
    // so no key-shaped string sits in the file) and an admin password of 32 characters.
    const recovery = `did:key:z${base58([0xe7, 0x01, 0x02, ...Array.from({ length: 32 }, (_, i) => i + 1)])}`;
    const pdsEnv = readFileSync(join(DEPLOYMENT, "env/pds.example.env"), "utf8")
      .replace("PDS_RECOVERY_DID_KEY=replace-me", `PDS_RECOVERY_DID_KEY=${recovery}`)
      .replace("PDS_ADMIN_PASSWORD=replace-me", `PDS_ADMIN_PASSWORD=${"x".repeat(32)}`);
    file("unset-dev-env/pds.env", 0o600, pdsEnv);
    file("unset-dev-env/local-leaf.pem", 0o644, pem("leaf.pem"));
    dir("unset-dev-trust", 0o755, ["root.pem"]);
    file("unset-dev-trust/root.pem", 0o644, pem("root.pem"));
    dir("unset-dev-ca", 0o700, ["root.key", "root.pem"]);
    file("unset-dev-ca/root.key", 0o400);
    file("unset-dev-ca/root.pem", 0o600, pem("root.pem"));
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

  test("preflight_passes_the_real_local_file", async () => {
    const result = await preflight(
      [
        "--env",
        "local",
        "--compose",
        join(DEPLOYMENT, "compose.local.yaml"),
        "--interpolation-env",
        beside("unset-dev-env/dev-public.env"),
      ],
      {
        root: CHECKOUT,
        run: async (file) =>
          file === "timedatectl"
            ? { code: 0, stdout: "yes\n", stderr: "" }
            : file === "docker"
              ? {
                  code: 0,
                  stdout: JSON.stringify({ mediaType: "application/vnd.oci.image.index.v1+json" }),
                  stderr: "",
                }
              : { code: 0, stdout: "", stderr: "" },
        readText: (path) => files.get(path)?.text ?? real(path, () => readFileSync(path, "utf8")),
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
        realpath: (path) =>
          files.has(path) || aboveCheckout(path) ? path : real(path, () => realpathSync.native(path)),
        readlink: (path) => readlinkSync(path),
        statfs: () => ({ type: 0xef53 }),
        uid: DEPLOY_UID,
        environment: {},
      },
    );
    expect(result.lines.filter((line) => !/^(PASS|UNSIGNED) /.test(line))).toEqual([
      "LOCAL unsigned, local-only stack: never deploy it",
    ]);
    expect(result.code).toBe(0);
  });
});
