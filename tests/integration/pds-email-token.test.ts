// tests/support/pds-email-token.ts (P1.29h): confirms a local account's email through the PDS's real
// requestEmailConfirmation and confirmEmail, reading the token with the `pds-token-reader` service, and only on the
// local stack (architecture record 2026-10-13-p129h-local-token-reader, points 3 and 4 and Amendment 1). Docker,
// openssl and the PDS are stand-ins here; the running stack is P1.29t's.
import type { Stats } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import type { Call, Ran } from "../support/docker.ts";
import {
  CLASSIFIED_KEYS,
  confirmLocalEmail,
  type LocalStack,
  outboundDrift,
  type PinnedPost,
} from "../support/pds-email-token.ts";

const DID = `did:plc:${"a".repeat(24)}`;
const EMAIL = "someone@example.test";
const JWT = "eyJhbGciOiJFUzI1NksifQ.access.signature";
const TOKEN = "ABCDE-23456";
const PDS_ID = "1".repeat(64);
const EDGE_ID = "2".repeat(64);
const VOLUME = "unset-dev_pdsdata";
const PLC_ID = "3".repeat(64);
const MACHINE = "devbox";
const ROOT_PATH = "/srv/unset-dev-env/dev-root-ca.pem";
const ROOT_PEM = "-----BEGIN CERTIFICATE-----\nMIIBfixture+/=\n-----END CERTIFICATE-----\n";
const SOCKET = "/var/run/docker.sock";

const NAME_CONSTRAINTS = [
  "X509v3 Name Constraints: critical",
  "    Permitted:",
  "      DNS:app.example.test",
  "      DNS:pds.example.test",
  "    Excluded:",
  "      IP:0.0.0.0/0.0.0.0",
  "",
].join("\n");

type World = {
  /** The caller's environment. */
  caller: Record<string, string>;
  /** What lstat finds, by path. */
  files: Record<string, "file" | "socket" | "dir" | "link">;
  /** Owner, mode and link count where they differ from root's 0755 with one name; folders above a file are root's. */
  owners?: Record<string, { uid?: number; mode?: number; nlink?: number }>;
  rootPem: string;
  /** The name `docker info` gives. */
  daemon: string;
  /** Running containers of the stack by service, beyond the pds and edge. */
  services: Record<string, string[]>;
  /** The dev root path the caller passes, when not ROOT_PATH. */
  devRoot?: string;
  constraints: Ran;
  pds: string[];
  edge: string[];
  pdsEnv: Record<string, string>;
  /** Lines printed for the PDS in this order instead of pdsEnv's, for a variable set twice. */
  pdsEnvLines?: [string, string][];
  edgeEnv: Record<string, string>;
  mounts: { Type: string; Name?: string; Destination: string }[];
  volumes: string[];
  reader: Ran;
  /** What resolving the edge's PDS_HOST answers, "fails" for a resolver error, "hangs" for one that never answers. */
  resolved: { address: string }[] | "fails" | "hangs";
  status: [number, number];
};
/** Every S3 key the previous head judged, set the way it accepted: a stack service, path style, a static key id. */
const S3_JUDGED = {
  PDS_BLOBSTORE_S3_ENDPOINT: "http://plc:2582",
  PDS_BLOBSTORE_S3_FORCE_PATH_STYLE: "true",
  PDS_BLOBSTORE_S3_ACCESS_KEY_ID: "key-id-fixture",
};
const local = (): World => ({
  caller: { PATH: "/usr/bin", HOME: "/home/dev", DOCKER_CONTEXT: "remote", COMPOSE_FILE: "x.yaml" },
  files: { [SOCKET]: "socket", [ROOT_PATH]: "file" },
  rootPem: ROOT_PEM,
  daemon: MACHINE,
  services: { plc: [PLC_ID] },
  constraints: { code: 0, out: NAME_CONSTRAINTS, err: "" },
  pds: [PDS_ID],
  edge: [EDGE_ID],
  pdsEnv: {
    PDS_HOSTNAME: "pds.example.test",
    PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test",
    PDS_DID_PLC_URL: "http://plc:2582",
    // What the dev PDS runs with (deployment/compose.dev.yaml).
    NODE_OPTIONS: "--max-old-space-size=768",
    // Read by the wrapper only as far as its keys: never kept, never shown.
    PDS_JWT_SECRET: "jwt-secret-fixture",
  },
  edgeEnv: { PDS_HOST: "pds.example.test", PDS_UPSTREAM: "pds:3000" },
  mounts: [{ Type: "volume", Name: VOLUME, Destination: "/home/node" }],
  volumes: [VOLUME],
  reader: { code: 0, out: TOKEN, err: "" },
  resolved: [{ address: "127.0.0.1" }, { address: "::1" }],
  status: [200, 200],
});

// The only inspect template for an environment: Docker prints each named pair as a JSON string on its own line and
// nothing else (Docker CLI 29.8.2 templates/templates.go:18-20; measured on a real container, see the PR).
const ENV_FORMAT =
  /^\{\{range \.Config\.Env\}\}\{\{if eq \(index \(split \. "="\) 0\)((?: "[A-Za-z0-9_]+")+)\}\}\{\{json \.\}\}\{\{println\}\}\{\{end\}\}\{\{end\}\}$/;

/** What Docker prints for `format` over `values`, or null for any other template. */
function picked(format: string, values: [string, string][]): { keys: string[]; out: string } | null {
  const named = ENV_FORMAT.exec(format)?.[1];
  if (named === undefined) return null;
  const keys = named
    .trim()
    .split(" ")
    .map((key) => JSON.parse(key) as string);
  const pairs = values.filter(([key]) => keys.includes(key));
  return { keys, out: `${pairs.map(([key, value]) => `${JSON.stringify(`${key}=${value}`)}\n`).join("")}\n` };
}

/** Runs confirmLocalEmail against `world`, recording every command, request and log line. */
async function attempt(world: World) {
  const commands: string[][] = [];
  const envs: Readonly<Record<string, string>>[] = [];
  const resolved: string[] = [];
  const requests: PinnedPost[] = [];
  const asked: Record<string, string[]> = {};
  const logged: string[] = [];
  const run = (file: string, args: readonly string[], call: Call): Ran => {
    expect(call.timeoutMs).toBeGreaterThan(0);
    expect(call.timeoutMs).toBeLessThanOrEqual(30_000);
    commands.push([file, ...args]);
    const line = [file, ...args].join(" ");
    const ok = (out: string): Ran => ({ code: 0, out, err: "" });
    if (file === "openssl") {
      // The PEM arrives on stdin, read by the wrapper; openssl is never given a path or a URI.
      expect(call.input).toBe(world.rootPem);
      expect(args).not.toContain("-in");
      return world.constraints;
    }
    expect(call.env, line).toBeDefined();
    envs.push(call.env ?? {});
    if (args[0] === "info") return ok(`${world.daemon}\n`);
    const ids = (list: string[]) => ok(list.map((id) => `${id}\n`).join(""));
    // A ps without the project filter would see other projects' containers too; the stand-in answers so.
    if (args[0] === "ps" && !line.includes("label=com.docker.compose.project=unset-dev")) return ids([PDS_ID, EDGE_ID]);
    if (line.includes("label=com.docker.compose.service=pds")) return ids(world.pds);
    if (line.includes("label=com.docker.compose.service=edge")) return ids(world.edge);
    const service = /label=com\.docker\.compose\.service=(\S+)/.exec(line)?.[1];
    if (args[0] === "ps" && service !== undefined) return ids(world.services[service] ?? []);
    if (args[0] === "inspect" && line.includes(".Config.Env")) {
      const id = args.at(-1) as string;
      const values =
        id === PDS_ID
          ? (world.pdsEnvLines ?? Object.entries(world.pdsEnv))
          : id === EDGE_ID
            ? Object.entries(world.edgeEnv)
            : undefined;
      const answer = picked(args[2] ?? "", values ?? []);
      if (values === undefined || args.length !== 4 || args[1] !== "--format" || answer === null) {
        throw new Error(`unexpected command ${line}`);
      }
      asked[id === PDS_ID ? "pds" : "edge"] = answer.keys;
      return ok(answer.out);
    }
    if (line.includes(".Mounts")) return ok(JSON.stringify(world.mounts));
    if (args[0] === "volume") {
      // Without both label filters every project's volumes would match.
      const filtered = line.includes("project=unset-dev") && line.includes("volume=pdsdata");
      return ids(filtered ? world.volumes : [...world.volumes, "other_pdsdata"]);
    }
    if (args.includes("pds-token-reader")) return world.reader;
    throw new Error(`unexpected command ${line}`);
  };
  const resolve = async (host: string) => {
    resolved.push(host);
    if (world.resolved === "fails") throw new Error(`getaddrinfo ENOTFOUND ${host}`);
    if (world.resolved === "hangs") {
      return new Promise<never>(() => {
        // Never settles: a resolver that does not answer.
      });
    }
    return world.resolved;
  };
  const post = async (request: PinnedPost): Promise<number> => {
    requests.push(request);
    const status = world.status[requests.length - 1] ?? 500;
    if (status === 0) throw new Error(`connect ECONNREFUSED ${request.address}:443 (${request.host})`);
    return status;
  };
  // Every folder above a listed path exists (root's, 0755), so the host pin's walk reaches the socket (P1.33j).
  const folder = (path: string) =>
    Object.keys(world.files).some((file) => file.startsWith(path === "/" ? "/" : `${path}/`));
  const kinds = (path: string) => {
    const kind = world.files[path] ?? (folder(path) ? "dir" : undefined);
    const { uid = 0, mode = 0o755, nlink = 1 } = world.owners?.[path] ?? {};
    return kind === undefined
      ? null
      : ({
          uid,
          mode,
          nlink,
          isFile: () => kind === "file",
          isSocket: () => kind === "socket",
          isDirectory: () => kind === "dir",
          isSymbolicLink: () => kind === "link",
        } as unknown as Stats);
  };
  const stack: LocalStack = {
    run,
    resolve,
    post,
    log: (line) => logged.push(line),
    caller: world.caller,
    walk: {
      lstat: kinds,
      readlink: () => {
        throw new Error("no links in this world");
      },
      statfs: () => ({ type: 0 }),
      uid: 1000,
    },
    readFile: (path) => {
      expect(path).toBe(ROOT_PATH);
      return world.rootPem;
    },
    hostname: MACHINE,
    devRootCert: world.devRoot ?? ROOT_PATH,
    composeFile: "/srv/unset/deployment/compose.dev.yaml",
    interpolationEnv: "/srv/unset-dev-env/dev-public.env",
  };
  let error: unknown = null;
  try {
    await confirmLocalEmail(stack, { did: DID, email: EMAIL, accessJwt: JWT });
  } catch (caught) {
    error = caught;
  }
  return { commands, envs, resolved, requests, asked, logged, error };
}

/** Nothing secret or personal in what the wrapper said or threw (SE-7). */
function expectNothingLeaked(result: Awaited<ReturnType<typeof attempt>>): void {
  const said = [...result.logged, result.error instanceof Error ? `${result.error.message} ${result.error.stack}` : ""];
  for (const value of [TOKEN, JWT, DID, EMAIL, "jwt-secret-fixture", "127.0.0.1", "pds.example.test"]) {
    expect(said.join("\n")).not.toContain(value);
  }
}

// The only import line of @atproto/pds 0.5.37's dist/config/env.js.
const IMPORT = "import { envBool, envInt, envList, envStr } from '@atproto/common';";

describe("tests/support/pds-email-token.ts", () => {
  test("local_confirm_uses_real_endpoint", async () => {
    const result = await attempt(local());
    expect(result.error).toBeNull();
    // Both requests go to the first vetted address, named for TLS by the edge's host and checked against the dev root.
    expect(result.resolved).toEqual(["pds.example.test"]);
    expect(result.requests.map(({ host, address, path, ca }) => [host, address, path, ca])).toEqual([
      ["pds.example.test", "127.0.0.1", "/xrpc/com.atproto.server.requestEmailConfirmation", ROOT_PEM],
      ["pds.example.test", "127.0.0.1", "/xrpc/com.atproto.server.confirmEmail", ROOT_PEM],
    ]);
    for (const request of result.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${JWT}`);
      // RE-1: a deadline, and a short one; nothing here waits on more than the local machine.
      expect(request.timeoutMs).toBeGreaterThan(0);
      expect(request.timeoutMs).toBeLessThanOrEqual(10_000);
    }
    expect(JSON.parse(String(result.requests[1]?.body))).toEqual({ email: EMAIL, token: TOKEN });
    // The reader runs once, after the request, as the tools profile's one-off container on the pinned project.
    expect(result.commands.at(-1)).toEqual([
      "docker",
      "compose",
      "--project-name",
      "unset-dev",
      "--file",
      "/srv/unset/deployment/compose.dev.yaml",
      "--env-file",
      "/srv/unset-dev-env/dev-public.env",
      "--profile",
      "tools",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "pds-token-reader",
      "/reader/read.ts",
      DID,
    ]);
    expect(result.logged.length).toBeGreaterThan(0);
    expectNothingLeaked(result);
  });

  test("email_token_never_logged_or_thrown", async () => {
    const refused = await attempt({ ...local(), status: [200, 400] });
    expect(refused.error).toEqual(new Error("the PDS refused confirmEmail (HTTP 400)"));
    expectNothingLeaked(refused);
    const garbled = await attempt({ ...local(), reader: { code: 0, out: `${TOKEN}\n${TOKEN}`, err: "" } });
    expect(garbled.error).toEqual(new Error("the token reader printed something other than one token"));
    expect(garbled.requests).toHaveLength(1);
    expectNothingLeaked(garbled);
    const failed = await attempt({ ...local(), reader: { code: 1, out: "", err: `${TOKEN} anything else\n` } });
    expect(failed.error).toEqual(new Error("the token reader failed"));
    expectNothingLeaked(failed);
    const named = await attempt({
      ...local(),
      reader: { code: 1, out: "", err: "no confirm_email token for this account\n" },
    });
    expect(named.error).toEqual(new Error("the token reader failed: no confirm_email token for this account"));
  });

  test("email_token_reader_refuses_non_local", async () => {
    const cases: [string, (w: World) => World][] = [
      // The daemon (coordinator's review of #786, B2): only a unix socket on this machine whose daemon names it.
      ...[
        "tcp://203.0.113.5:2375",
        "ssh://deploy@203.0.113.5",
        "npipe:////./pipe/docker",
        "unix://run/docker.sock",
        // Another scheme over the same absolute path (coordinator's second review of #786, S3').
        `ssh://${SOCKET}`,
        `tcp://${SOCKET}`,
        `npipe://${SOCKET}`,
        `UNIX://${SOCKET}`,
      ].map((host): [string, (w: World) => World] => [
        "DOCKER_HOST must be a Docker socket on this machine",
        (w) => ({ ...w, caller: { ...w.caller, DOCKER_HOST: host } }),
      ]),
      [
        "DOCKER_HOST must be a Docker socket on this machine",
        (w) => ({
          ...w,
          caller: { ...w.caller, DOCKER_HOST: "unix:///tmp/not-a-socket" },
          files: { ...w.files, "/tmp": "dir" },
        }),
      ],
      // The shared host pin (P1.33j, B2'): a socket in a folder another user can write, and a second name for it.
      [
        "DOCKER_HOST must be a Docker socket on this machine: its folder is a path that another user can change",
        (w) => ({
          ...w,
          caller: { ...w.caller, DOCKER_HOST: "unix:///tmp/docker.sock" },
          files: { ...w.files, "/tmp/docker.sock": "socket" },
          owners: { "/tmp": { mode: 0o1777 } },
        }),
      ],
      [
        "DOCKER_HOST must be a Docker socket on this machine: it has another name (a hard link)",
        (w) => ({ ...w, owners: { [SOCKET]: { nlink: 2 } } }),
      ],
      // The daemon's name exactly: never a prefix, a longer name or another case.
      ...["homelab", "devbox2", "devbox.example.test", "dev", "DEVBOX", "Devbox", "", "devbox devbox"].map(
        (daemon): [string, (w: World) => World] => [
          "the Docker daemon is not on this machine",
          (w) => ({ ...w, daemon }),
        ],
      ),
      // The dev root (S2): an absolute path to a regular file holding one PEM certificate, read here.
      ...[
        "dev-root-ca.pem",
        "file:///srv/unset-dev-env/dev-root-ca.pem",
        "http://203.0.113.5/ca.pem",
        "/srv/../x.pem",
      ].map((path): [string, (w: World) => World] => [
        "the dev root certificate path is not absolute",
        (w) => ({ ...w, files: { ...w.files, [path]: "file" }, devRoot: path }),
      ]),
      ["the dev root certificate is not a regular file", (w) => ({ ...w, files: { [SOCKET]: "socket" } })],
      ["the dev root certificate is not a regular file", (w) => ({ ...w, files: { ...w.files, [ROOT_PATH]: "link" } })],
      ["the dev root certificate is not one PEM certificate", (w) => ({ ...w, rootPem: "not a certificate\n" })],
      ["the dev root certificate is not one PEM certificate", (w) => ({ ...w, rootPem: `${ROOT_PEM}${ROOT_PEM}` })],
      ["the dev root certificate is unreadable", (w) => ({ ...w, constraints: { code: 1, out: "", err: "x" } })],
      [
        "the dev root names no DNS names",
        (w) => ({ ...w, constraints: { code: 0, out: "No extensions in certificate\n", err: "" } }),
      ],
      [
        "the dev root's name constraints are not critical",
        (w) => ({ ...w, constraints: { code: 0, out: NAME_CONSTRAINTS.replace(": critical", ":"), err: "" } }),
      ],
      ["expected exactly one running pds container of the unset-dev project", (w) => ({ ...w, pds: [] })],
      ["expected exactly one running pds container of the unset-dev project", (w) => ({ ...w, pds: [PDS_ID, PDS_ID] })],
      ["expected exactly one running edge container of the unset-dev project", (w) => ({ ...w, edge: [] })],
      [
        "the edge's PDS_HOST is not one of the dev root's names",
        (w) => ({ ...w, edgeEnv: { PDS_HOST: "pds.unset.ac" } }),
      ],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "unset.ac" } })],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "evil.localhost.example" } })],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "pdslocalhost" } })],
      ["PDS_HOSTNAME is not local", (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HOSTNAME: "localhost" } })],
      [
        "a handle domain is not local",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.unset.ac" } }),
      ],
      // A handle domain is a suffix and starts with its dot.
      [
        "a handle domain is not local",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_SERVICE_HANDLE_DOMAINS: "pds.example.test" } }),
      ],
      [
        "the PDS has a mail server set",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_EMAIL_SMTP_URL: "smtps://mail.example.test" } }),
      ],
      [
        "the PDS has a mail server set",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_MODERATION_EMAIL_SMTP_URL: "smtps://mail.example.test" } }),
      ],
      // Service URLs (B3): an unset PLC URL is the public directory; any public host is refused, a stack service passes.
      [
        "PDS_DID_PLC_URL is unset, so the PDS uses the public PLC",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_DID_PLC_URL: "" } }),
      ],
      ...[
        ["PDS_DID_PLC_URL", "https://plc.directory"],
        ["PDS_DID_PLC_URL", "https://plc.directory.example"],
        ["PDS_DID_PLC_URL", "http://plc2:2582"],
        ["PDS_DID_PLC_URL", "not a url"],
        ["PDS_CRAWLERS", "http://plc:2582,https://bsky.network"],
        ["PDS_BSKY_APP_VIEW_URL", "https://api.bsky.app"],
        ["PDS_ENTRYWAY_URL", "https://entryway.example"],
        ["PDS_MOD_SERVICE_URL", "https://mod.example"],
        ["PDS_REPORT_SERVICE_URL", "https://report.example"],
        // Look-alikes of the local names (S2'): .localhost is a suffix with its dot, never a substring.
        ["PDS_DID_PLC_URL", "https://localhost.evil.example"],
        ["PDS_DID_PLC_URL", "https://evil-localhost.example"],
        ["PDS_DID_PLC_URL", "https://evillocalhost"],
        ["PDS_DID_PLC_URL", "https://pds.example.test.evil.example"],
        ["PDS_DID_PLC_URL", "http://[::ffff:127.0.0.1]:2582"],
        // Loopback is a whole address, never a prefix (coordinator's verify of #803 at 94ab296, S2).
        ["PDS_DID_PLC_URL", "https://127.0.0.1.evil.example"],
        ["PDS_REDIS_SCRATCH_ADDRESS", "127.0.0.1.evil.example:6379"],
        // Every other outbound key of @atproto/pds 0.5.37's env.js (Amendment 3, S2'), set to a public name.
        ["PDS_BLOBSTORE_S3_ENDPOINT", "https://s3.example"],
        ["PDS_BSKY_APP_VIEW_CDN_URL_PATTERN", "https://cdn.example/img/%s/plain/%s/%s@%s"],
        ["PDS_HANDLE_BACKUP_NAMESERVERS", "127.0.0.1,198.51.100.53"],
        ["PDS_HANDLE_BACKUP_NAMESERVERS", "198.51.100.53:53"],
        ["PDS_REDIS_SCRATCH_ADDRESS", "redis.example:6379"],
        ["PDS_REDIS_SCRATCH_ADDRESS", "203.0.113.9:6379"],
      ].map(([name, value]): [string, (w: World) => World] => [
        `${name} names a host outside the local stack`,
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, [name as string]: value as string } }),
      ]),
      // Codex on #803: keys that pick a provider whose endpoint is AWS's own when none is set (@atproto/pds 0.5.37
      // dist/config/config.js:51-60, an unset endpoint; dist/config/secrets.js:26-30, KMS takes no endpoint at all).
      [
        "PDS_PLC_ROTATION_KEY_KMS_KEY_ID is set, so the PDS uses AWS KMS",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_PLC_ROTATION_KEY_KMS_KEY_ID: "alias/plc" } }),
      ],
      // Coordinator's verify of #803 at 94ab296, B1-B6: keys that send the PDS out without naming a host the wrapper
      // judges. hCaptcha needs all three of its keys (dist/config/config.js:265-271), so the public site key alone is
      // refused and the secret is never read.
      [
        "PDS_HCAPTCHA_SITE_KEY is set, so the PDS calls hCaptcha",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_HCAPTCHA_SITE_KEY: "site-key-fixture" } }),
      ],
      ...["did:web:lexicon.example.test", `did:plc:${"b".repeat(24)}`].map((did): [string, (w: World) => World] => [
        "PDS_LEXICON_AUTHORITY_DID is set, so the PDS resolves lexicons through that DID",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_LEXICON_AUTHORITY_DID: did } }),
      ]),
      // Any bucket (verify at d24dd55, B2): the locked S3 client still leaves the stack with every S3 key judged. With
      // no region it asks instance metadata, AWS_DEFAULTS_MODE or the AWS config file can do the same, and some bucket
      // names ignore both path style and the endpoint. The PDS keeps blobs on disk instead.
      ...[{}, S3_JUDGED, { ...S3_JUDGED, PDS_BLOBSTORE_S3_REGION: "us-east-1" }].map(
        (s3): [string, (w: World) => World] => [
          "PDS_BLOBSTORE_S3_BUCKET is set, so the PDS stores blobs in S3",
          (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_BLOBSTORE_S3_BUCKET: "blobs", ...s3 } }),
        ],
      ),
      // Process-level keys, pinned here: @did-plc/lib 0.0.4 bundles axios with proxy-from-env, which reads each name
      // in lower and upper case, npm's included (dist/index.js:19222-19271; verify at d24dd55, B1). NODE_USE_ENV_PROXY
      // routes Node's global fetch too (Node v24.19.0 doc/api/cli.md).
      ...[
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "npm_config_proxy",
        "npm_config_http_proxy",
        "npm_config_https_proxy",
        "NPM_CONFIG_PROXY",
        "NPM_CONFIG_HTTP_PROXY",
        "NPM_CONFIG_HTTPS_PROXY",
        "NODE_USE_ENV_PROXY",
      ].map((name): [string, (w: World) => World] => [
        `${name} is set, so the PDS sends requests through a proxy`,
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, [name]: "http://proxy.example.test:3128" } }),
      ]),
      ...[
        "--use-env-proxy",
        "--import @atproto/pds/telemetry",
        "--max-old-space-size=768 --require /tmp/x.js",
        "--max-old-space-size=0",
        " --max-old-space-size=768",
      ].map((options): [string, (w: World) => World] => [
        "NODE_OPTIONS is not only a heap size",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, NODE_OPTIONS: options } }),
      ]),
      // A variable printed twice is refused, whichever value comes last (S3; runc keeps the last).
      ...[
        ["https://plc.directory", "http://plc:2582"],
        ["http://plc:2582", "https://plc.directory"],
      ].map((values): [string, (w: World) => World] => [
        "a container variable is set twice",
        (w) => ({
          ...w,
          pdsEnvLines: [
            ...Object.entries(w.pdsEnv).filter(([key]) => key !== "PDS_DID_PLC_URL"),
            ...values.map((value): [string, string] => ["PDS_DID_PLC_URL", value]),
          ],
        }),
      ]),
      [
        "the PDS does not keep its data in a named volume at /home/node",
        (w) => ({ ...w, mounts: [{ Type: "bind", Destination: "/home/node" }] }),
      ],
      // Another project's volume, or one whose labels were not set by Compose for unset-dev's pdsdata.
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: [] })],
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: ["other_pdsdata"] })],
      // Exactly one labelled volume, and it is the one mounted.
      [
        "the PDS volume is not the unset-dev project's pdsdata",
        (w) => ({ ...w, volumes: [VOLUME, "unset-dev_pdsdata2"] }),
      ],
      // The mount at /home/node is judged, not the first volume.
      [
        "the PDS does not keep its data in a named volume at /home/node",
        (w) => ({
          ...w,
          mounts: [
            { Type: "volume", Name: VOLUME, Destination: "/other" },
            { Type: "bind", Destination: "/home/node" },
          ],
        }),
      ],
      [
        "the PDS volume is not the unset-dev project's pdsdata",
        (w) => ({ ...w, mounts: [{ Type: "volume", Name: "other_pdsdata", Destination: "/home/node" }] }),
      ],
    ];
    for (const [reason, edit] of cases) {
      const result = await attempt(edit(local()));
      expect(result.error, reason).toEqual(new Error(reason));
      // Refused before anything reaches the PDS or the reader runs.
      expect(result.requests, reason).toEqual([]);
      expect(
        result.commands.some((c) => c.includes("pds-token-reader")),
        reason,
      ).toBe(false);
      expectNothingLeaked(result);
    }
    // The .localhost form passes: a PDS_HOSTNAME under it is local by definition (RFC 6761, section 6.3).
    const localhost = await attempt({ ...local(), pdsEnv: { ...local().pdsEnv, PDS_HOSTNAME: "pds.localhost" } });
    expect(localhost.error).toBeNull();
    // A stack service by exact label, a local name, a dev root name and a loopback address pass; an unset key passes.
    const outbound = {
      PDS_CRAWLERS: "http://plc:2582,https://relay.localhost",
      PDS_BSKY_APP_VIEW_URL: "",
      // An endpoint alone sends nothing (no bucket), but is still judged.
      PDS_BLOBSTORE_S3_ENDPOINT: "https://app.example.test",
      PDS_BLOBSTORE_S3_SECRET_ACCESS_KEY: "s3-secret-fixture",
      PDS_HANDLE_BACKUP_NAMESERVERS: "127.0.0.53,[::1]:53",
      PDS_REDIS_SCRATCH_ADDRESS: "127.0.0.1:6379",
      PDS_BSKY_APP_VIEW_CDN_URL_PATTERN: "http://[::1]:2584/img/%s/plain/%s/%s@%s",
      // Links and images the browser loads, never fetched by the PDS (dist/config/config.js:222-252).
      PDS_LOGO_URL: "https://logo.example/logo.png",
    };
    const urls = await attempt({ ...local(), pdsEnv: { ...local().pdsEnv, ...outbound } });
    expect(urls.error).toBeNull();
    // No NODE_OPTIONS at all passes too.
    const { NODE_OPTIONS: _, ...noOptions } = local().pdsEnv;
    const bare = await attempt({ ...local(), pdsEnv: noOptions });
    expect(bare.error).toBeNull();
  });

  test("email_token_docker_runs_on_this_machine_only", async () => {
    // Every docker call gets DOCKER_HOST set (so a stored currentContext never applies) and only the allowlisted
    // variables: DOCKER_CONTEXT, COMPOSE_* and the rest of the caller's environment are dropped.
    const result = await attempt(local());
    expect(result.error).toBeNull();
    expect(result.envs.length).toBeGreaterThan(5);
    for (const env of result.envs) {
      expect(env).toEqual({ DOCKER_HOST: `unix://${SOCKET}`, PATH: "/usr/bin", HOME: "/home/dev" });
    }
    // The daemon is asked first, before any other docker call.
    expect(result.commands.find(([file]) => file === "docker")?.[1]).toBe("info");
    const rootless = `/run/user/1000/docker.sock`;
    const chosen = await attempt({
      ...local(),
      caller: { ...local().caller, DOCKER_HOST: `unix://${rootless}` },
      files: { ...local().files, [rootless]: "socket" },
    });
    expect(chosen.error).toBeNull();
    expect(chosen.envs.every((env) => env.DOCKER_HOST === `unix://${rootless}`)).toBe(true);
  });

  test("email_token_pds_host_resolves_to_loopback_only", async () => {
    // Amendment 2, S1: system DNS is outside the dev root's name constraint, so every answer must be this machine's.
    const refused = "the edge's PDS_HOST does not resolve to loopback only";
    const cases: [World["resolved"], string][] = [
      [[{ address: "192.168.1.20" }], refused],
      [[{ address: "127.0.0.1" }, { address: "203.0.113.7" }], refused],
      [[{ address: "::1" }, { address: "2001:db8::7" }], refused],
      [[{ address: "::ffff:127.0.0.1" }], refused],
      [[{ address: "0.0.0.0" }], refused],
      [[], refused],
      ["fails", "the edge's PDS_HOST does not resolve"],
    ];
    for (const [resolved, reason] of cases) {
      const result = await attempt({ ...local(), resolved });
      expect(result.error, JSON.stringify(resolved)).toEqual(new Error(reason));
      // Refused before the token is asked for or read.
      expect(result.requests).toEqual([]);
      expect(result.commands.some((command) => command.includes("pds-token-reader"))).toBe(false);
      expectNothingLeaked(result);
    }
    const v6 = await attempt({ ...local(), resolved: [{ address: "::1" }] });
    expect(v6.error).toBeNull();
    expect(v6.requests.map(({ address }) => address)).toEqual(["::1", "::1"]);
    const range = await attempt({ ...local(), resolved: [{ address: "127.0.1.1" }] });
    expect(range.error).toBeNull();
  });

  test("email_token_pds_host_lookup_has_a_deadline", async () => {
    // RE-1: a resolver that never answers ends the run, before the token is asked for.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = attempt({ ...local(), resolved: "hangs" });
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await pending;
      expect(result.error).toEqual(new Error("the edge's PDS_HOST does not resolve"));
      expect(result.requests).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("email_token_inspect_reads_only_named_keys", async () => {
    // Coordinator's second review of #786, N3: Docker prints only the named variables, so the PDS's secrets never
    // reach this process.
    const result = await attempt(local());
    expect(result.error).toBeNull();
    expect(result.asked.edge).toEqual(["PDS_HOST"]);
    expect(result.asked.pds).toContain("PDS_HOSTNAME");
    expect(result.asked.pds).toContain("PDS_REDIS_SCRATCH_ADDRESS");
    expect(result.asked.pds).toContain("NODE_OPTIONS");
    // These name a key or a site and hold no secret: the KMS key id and hCaptcha's public site key. They are asked so
    // a set one is refused.
    const named = ["PDS_PLC_ROTATION_KEY_KMS_KEY_ID", "PDS_HCAPTCHA_SITE_KEY"];
    const secretLike = (key: string) => /SECRET|PASSWORD|KEY|TOKEN|SALT/.test(key) && !named.includes(key);
    expect(result.asked.pds?.filter(secretLike)).toEqual([]);
  });

  test("email_token_redirect_is_refused", async () => {
    // A 3xx is not success: node:https follows nothing, and the wrapper takes only 2xx.
    const moved = await attempt({ ...local(), status: [302, 200] });
    expect(moved.error).toEqual(new Error("the PDS refused requestEmailConfirmation (HTTP 302)"));
    expect(moved.commands.some((command) => command.includes("pds-token-reader"))).toBe(false);
    expectNothingLeaked(moved);
  });

  test("email_token_outbound_drift_names_new_and_stale_keys", () => {
    // The check pds-email-token.image.test.ts runs on the pinned image's env.js, here on a file in its shape.
    const reads = (keys: string[]) =>
      `${IMPORT}\nexport function readEnv() {\n  return {\n${keys
        .map((key, i) => `    k${i}: envStr('${key}'),\n`)
        .join("")}  };\n}\n`;
    const current = [...CLASSIFIED_KEYS];
    expect(outboundDrift(reads(current))).toEqual([]);
    // Every new key fails until it is classified, whatever its name (coordinator's verify of #803 at 94ab296, B7): a
    // key that picks a provider by being set names no host. So does a classified key upstream dropped.
    expect(outboundDrift(reads([...current, "PDS_NEW_SERVICE_URL", "PDS_NEW_PROVIDER_TOKEN"]))).toEqual([
      "PDS_NEW_SERVICE_URL unclassified",
      "PDS_NEW_PROVIDER_TOKEN unclassified",
    ]);
    expect(outboundDrift(reads(current.filter((key) => key !== "PDS_CRAWLERS")))).toEqual([
      "PDS_CRAWLERS no longer read",
    ]);
    // A read in another form cannot pass as "no keys".
    const other = "  x: envUrl('PDS_X_URL'),\n";
    expect(outboundDrift(reads(current).replace("  };", `${other}  };`))).toEqual([
      "env.js reads a key in a form this check does not parse",
    ]);
    expect(outboundDrift("export {}\n")).toEqual(["env.js reads a key in a form this check does not parse"]);
    // Codex on #803: a helper call spaced or wrapped before its parenthesis, or a name in double quotes, is a read too.
    // So is every other shape that reaches the environment (S1): process.env in any form, a helper under another
    // name or called another way, and a comment before the parenthesis.
    const shapes = [
      "envStr ('PDS_X_URL')",
      "envStr\n      ('PDS_X_URL')",
      'envStr("PDS_X_URL")',
      "process.env.PDS_X_URL",
      "process.env['PDS_X_URL']",
      "(({ PDS_X_URL }) => PDS_X_URL)(process.env)",
      "(0, common_1.envStr)('PDS_X_URL')",
      "envStr?.('PDS_X_URL')",
      "envStr.call(null, 'PDS_X_URL')",
      "envStr /* url */ ('PDS_X_URL')",
      // One shape per rule that only that rule catches: process, a call of another env helper, a key-shaped name.
      "process.env[name]",
      "envAny(name)",
      "envAny (name)",
      "globalThis['proc' + 'ess'].env.PDS_X_URL",
    ];
    for (const shape of shapes) {
      expect(outboundDrift(reads(current).replace("  };", `  x: ${shape},\n  };`)), shape).toEqual([
        "env.js reads a key in a form this check does not parse",
      ]);
    }
    const imports: [string, string][] = [
      ["import { envStr as e } from '@atproto/common';", "e('PDS_X_URL')"],
      ["import { envBool, envInt, envList, envStr, readKey } from '@atproto/common';", "readKey('PDS_X_URL')"],
      [`${IMPORT}\nconst str = envStr;`, "str(name)"],
      [IMPORT.replace("envStr }", "envStr, readKey as r }"), "r(name)"],
      [`${IMPORT}\nexport * from './other.js';`, "envStr('PDS_X_URL')"],
      [`${IMPORT}\nimport * as common from '@atproto/common';`, "common[helper](name)"],
      [`${IMPORT}\nconst common = require('@atproto/common');`, "common[helper](name)"],
      [`${IMPORT}\nconst { envStr: s } = require('@atproto/common');`, "s('PDS_X_URL')"],
    ];
    for (const [head, call] of imports) {
      const file = reads(current).replace(IMPORT, head).replace("  };", `  x: ${call},\n  };`);
      expect(outboundDrift(file), head).toEqual(["env.js reads a key in a form this check does not parse"]);
    }
  });

  test("email_token_fetch_errors_are_fixed_reasons", async () => {
    // The transport's own error names the address it tried; the wrapper says only which procedure got no answer.
    const unanswered = await attempt({ ...local(), status: [0, 200] });
    expect(unanswered.error).toEqual(new Error("the PDS did not answer requestEmailConfirmation"));
    expectNothingLeaked(unanswered);
  });
});
