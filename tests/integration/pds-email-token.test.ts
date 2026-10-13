// tests/support/pds-email-token.ts (P1.29h): confirms a local account's email through the PDS's real
// requestEmailConfirmation and confirmEmail, reading the token with the `pds-token-reader` service, and only on the
// local stack (architecture record 2026-10-13-p129h-local-token-reader, points 3 and 4 and Amendment 1). Docker,
// openssl and the PDS are stand-ins here; the running stack is P1.29t's.
import type { Stats } from "node:fs";
import { describe, expect, test } from "vitest";
import type { Call, Ran } from "../support/docker.ts";
import { confirmLocalEmail, type LocalStack, type PinnedPost } from "../support/pds-email-token.ts";

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
  edgeEnv: Record<string, string>;
  mounts: { Type: string; Name?: string; Destination: string }[];
  volumes: string[];
  reader: Ran;
  /** What resolving the edge's PDS_HOST answers, or "fails" for a resolver error. */
  resolved: { address: string }[] | "fails";
  status: [number, number];
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

const env = (values: Record<string, string>) => JSON.stringify(Object.entries(values).map(([k, v]) => `${k}=${v}`));

/** Runs confirmLocalEmail against `world`, recording every command, request and log line. */
async function attempt(world: World) {
  const commands: string[][] = [];
  const envs: Readonly<Record<string, string>>[] = [];
  const resolved: string[] = [];
  const requests: PinnedPost[] = [];
  const logged: string[] = [];
  const run = (file: string, args: readonly string[], call: Call): Ran => {
    expect(call.timeoutMs).toBeGreaterThan(0);
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
    if (line.includes(".Config.Env") && line.endsWith(PDS_ID)) return ok(env(world.pdsEnv));
    if (line.includes(".Config.Env") && line.endsWith(EDGE_ID)) return ok(env(world.edgeEnv));
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
    return world.resolved;
  };
  const post = async (request: PinnedPost): Promise<number> => {
    requests.push(request);
    const status = world.status[requests.length - 1] ?? 500;
    if (status === 0) throw new Error(`connect ECONNREFUSED ${request.address}:443 (${request.host})`);
    return status;
  };
  const kinds = (kind: string | undefined) =>
    kind === undefined
      ? null
      : ({ isFile: () => kind === "file", isSocket: () => kind === "socket" } as unknown as Stats);
  const stack: LocalStack = {
    run,
    resolve,
    post,
    log: (line) => logged.push(line),
    caller: world.caller,
    lstat: (path) => kinds(world.files[path]),
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
  return { commands, envs, resolved, requests, logged, error };
}

/** Nothing secret or personal in what the wrapper said or threw (SE-7). */
function expectNothingLeaked(result: Awaited<ReturnType<typeof attempt>>): void {
  const said = [...result.logged, result.error instanceof Error ? `${result.error.message} ${result.error.stack}` : ""];
  for (const value of [TOKEN, JWT, DID, EMAIL, "jwt-secret-fixture", "127.0.0.1", "pds.example.test"]) {
    expect(said.join("\n")).not.toContain(value);
  }
}

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
      expect(request.timeoutMs).toBeGreaterThan(0);
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
      ].map((host): [string, (w: World) => World] => [
        "DOCKER_HOST must be a Docker socket on this machine",
        (w) => ({ ...w, caller: { ...w.caller, DOCKER_HOST: host } }),
      ]),
      [
        "DOCKER_HOST must be a Docker socket on this machine",
        (w) => ({ ...w, caller: { ...w.caller, DOCKER_HOST: "unix:///tmp/not-a-socket" } }),
      ],
      ["the Docker daemon is not on this machine", (w) => ({ ...w, daemon: "homelab" })],
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
      [
        "a handle domain is not local",
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, PDS_SERVICE_HANDLE_DOMAINS: ".pds.example.test,.unset.ac" } }),
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
      ].map(([name, value]): [string, (w: World) => World] => [
        `${name} names a host outside the local stack`,
        (w) => ({ ...w, pdsEnv: { ...w.pdsEnv, [name as string]: value as string } }),
      ]),
      [
        "the PDS does not keep its data in a named volume at /home/node",
        (w) => ({ ...w, mounts: [{ Type: "bind", Destination: "/home/node" }] }),
      ],
      // Another project's volume, or one whose labels were not set by Compose for unset-dev's pdsdata.
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: [] })],
      ["the PDS volume is not the unset-dev project's pdsdata", (w) => ({ ...w, volumes: ["other_pdsdata"] })],
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
    // A stack service by exact label, a local name, and a dev root name pass as service URLs.
    const crawlers = { PDS_CRAWLERS: "http://plc:2582,https://relay.localhost", PDS_BSKY_APP_VIEW_URL: "" };
    const urls = await attempt({ ...local(), pdsEnv: { ...local().pdsEnv, ...crawlers } });
    expect(urls.error).toBeNull();
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

  test("email_token_fetch_errors_are_fixed_reasons", async () => {
    // The transport's own error names the address it tried; the wrapper says only which procedure got no answer.
    const unanswered = await attempt({ ...local(), status: [0, 200] });
    expect(unanswered.error).toEqual(new Error("the PDS did not answer requestEmailConfirmation"));
    expectNothingLeaked(unanswered);
  });
});
