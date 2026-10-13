// P1.29h: confirms a local test account's email through the PDS's real requestEmailConfirmation and confirmEmail,
// standing in for the inbox only. The token comes from the local stack's `pds-token-reader` service
// (tests/support/pds-email-token-read.ts), travels only from its stdout into the confirmEmail body, and is never
// logged, thrown or written down (SE-7). An admin "mark confirmed" and real SMTP on a developer machine stay refused.
//
// Local only (architecture record 2026-10-13-p129h-local-token-reader, point 4 and Amendment 1, guard (ii)): before
// anything reaches the PDS it refuses unless the Docker daemon is this machine's, the edge's PDS_HOST is one of the
// dev root's constrained names (P1.34d), PDS_HOSTNAME and every handle domain are local, the PDS sends no mail, every
// service URL the PDS calls names the local stack (an unset PDS_DID_PLC_URL is the public directory), and the PDS's
// data volume is the one Compose made for `unset-dev`'s `pdsdata`, by its labels and not its name. P1.27l's local label
// joins these when it lands, and P1.33p refuses the tools profile on any public stack. Every reason is fixed text,
// never a value.
//
// The daemon, as the stack wrapper pins its children's (deployment/preflight/stack.ts childEnv and
// refuseRemoteDaemon; tests/ cannot import it, since deployment's project references tests'): every docker call runs
// with only CHILD_ENV and DOCKER_HOST, always set to a unix socket on this machine, which overrides a stored
// currentContext (Docker CLI 29.8.2, stack.test.ts a_stored_remote_context_never_reaches_the_children); DOCKER_CONTEXT
// and every other variable are dropped, and tcp://, ssh:// or any other scheme is refused. Then `docker info` must
// name this host, so a socket forwarded from another machine is refused too.
import { lookup } from "node:dns/promises";
import type { Stats } from "node:fs";
import { request } from "node:https"; // guard-allow: egress local PDS only, to a vetted loopback address
import { isAbsolute, normalize } from "node:path";
import type { Call, Ran } from "./docker.ts";
import { READER_REASONS } from "./pds-email-token-read.ts";

/** How the wrapper reaches the local stack; tests pass stand-ins. */
export type LocalStack = {
  /** runOrKill (tests/support/docker.ts) in a real run. */
  run: (file: string, args: readonly string[], call: Call) => Ran;
  /** Every address `host` resolves to: resolveAll in a real run. */
  resolve: (host: string) => Promise<{ address: string }[]>;
  /** httpsPost in a real run: one request to a vetted address, TLS checked against the dev root only. */
  post: (request: PinnedPost) => Promise<number>;
  log: (line: string) => void;
  /** The caller's environment (process.env), narrowed to CHILD_ENV and DOCKER_HOST before any docker call. */
  caller: Readonly<Record<string, string | undefined>>;
  /** node:fs lstat, null when nothing is there: for the daemon's socket and the dev root. */
  lstat: (path: string) => Stats | null;
  readFile: (path: string) => string;
  /** This machine's name (node:os hostname()), which the daemon must give back. */
  hostname: string;
  /** The dev root's public certificate (P1.34d; `unset-dev-env/` beside the checkout), an absolute path. */
  devRootCert: string;
  composeFile: string;
  interpolationEnv: string;
};
export type LocalAccount = { did: string; email: string; accessJwt: string };
/** One HTTPS POST to `host`, connected to `address` and to nothing else, its certificate checked against `ca`. */
export type PinnedPost = {
  host: string;
  address: string;
  port?: number;
  path: string;
  headers: Record<string, string>;
  body?: string;
  ca: string;
  timeoutMs: number;
};

const PROJECT = "unset-dev";
const COMMAND_MS = 30_000;
const REQUEST_MS = 10_000;
const TOKEN = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;
const MAIL = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL"];
/** Every URL the PDS calls out to (@atproto/pds 0.5.37 dist/config/env.js); PDS_CRAWLERS is a comma list. */
const SERVICE_URLS = [
  "PDS_DID_PLC_URL",
  "PDS_BSKY_APP_VIEW_URL",
  "PDS_CRAWLERS",
  "PDS_ENTRYWAY_URL",
  "PDS_MOD_SERVICE_URL",
  "PDS_REPORT_SERVICE_URL",
];
/** The only PDS variables read; the rest of its environment, its secrets included, is dropped on parse. */
const PDS_KEYS = ["PDS_HOSTNAME", "PDS_SERVICE_HANDLE_DOMAINS", ...MAIL, ...SERVICE_URLS];
/** One PEM certificate and nothing else. */
const PEM = /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/;
const KNOWN_READER_REASONS = new Set<string>(Object.values(READER_REASONS));

/** What a docker call may see of the caller's environment (stack.ts CHILD_ENV_NAMES). */
const CHILD_ENV = ["PATH", "HOME", "DOCKER_CONFIG", "DOCKER_CERT_PATH"];
const DEFAULT_DOCKER_HOST = "unix:///var/run/docker.sock";

/** Docker on this machine's daemon only: every call carries the pinned environment and a kill timeout. */
type Docker = (args: readonly string[]) => Ran;

/** Runs requestEmailConfirmation, reads the token on the local stack, and sends it to confirmEmail. */
export async function confirmLocalEmail(stack: LocalStack, account: LocalAccount): Promise<void> {
  const docker = localDaemon(stack);
  const pds = await pinnedPds(stack, checkLocalStack(stack, docker));
  stack.log("local stack checked");
  await post(stack, pds, "requestEmailConfirmation", account.accessJwt);
  const token = readToken(stack, docker, account.did);
  await post(stack, pds, "confirmEmail", account.accessJwt, { email: account.email, token });
  stack.log("email confirmed through the PDS");
}

// 127.0.0.0/8 written as a resolver prints it; ::1 is the only IPv6 loopback, and a mapped form is refused.
const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** Where the PDS is reached: its name for TLS, the one vetted address, and the dev root to check the name against. */
type PinnedPds = { host: string; address: string; ca: string };

/**
 * The PDS's host pinned to loopback (Amendment 2, S1): every address it resolves to is 127.0.0.0/8 or ::1, else it is
 * refused. System DNS (an /etc/hosts line, a search domain) is outside what the dev root's name constraint controls,
 * and the token is a credential, so it goes only to an address on this machine.
 */
async function pinnedPds(stack: LocalStack, { host, ca }: { host: string; ca: string }): Promise<PinnedPds> {
  let answers: { address: string }[];
  try {
    answers = await stack.resolve(host);
  } catch {
    refuse("the edge's PDS_HOST does not resolve");
  }
  const loopback = (address: string) => LOOPBACK_V4.test(address) || address === "::1";
  const [first] = answers;
  if (first === undefined || !answers.every(({ address }) => loopback(address))) {
    refuse("the edge's PDS_HOST does not resolve to loopback only");
  }
  return { host, address: first.address, ca };
}

/** Docker pinned to this machine's daemon, once `docker info` names this host. */
function localDaemon(stack: LocalStack): Docker {
  const host = stack.caller.DOCKER_HOST ?? DEFAULT_DOCKER_HOST;
  const socket = host.startsWith("unix://") ? host.slice("unix://".length) : "";
  if (!isAbsolute(socket) || stack.lstat(socket)?.isSocket() !== true) {
    refuse("DOCKER_HOST must be a Docker socket on this machine");
  }
  const env: Record<string, string> = { DOCKER_HOST: host };
  for (const name of CHILD_ENV) {
    const value = stack.caller[name];
    if (value !== undefined) env[name] = value;
  }
  const docker: Docker = (args) => stack.run("docker", args, { timeoutMs: COMMAND_MS, env });
  const info = docker(["info", "--format", "{{.Name}}"]);
  if (info.code !== 0) refuse("docker info failed");
  if (info.out.trim() !== stack.hostname) refuse("the Docker daemon is not on this machine");
  return docker;
}

/** The PDS's host on the edge and the dev root's PEM, once every local-only check holds. */
function checkLocalStack(stack: LocalStack, docker: Docker): { host: string; ca: string } {
  const ca = devRootPem(stack);
  const names = devRootNames(stack, ca);
  const pds = oneContainer(docker, "pds");
  const edge = oneContainer(docker, "edge");
  const pdsEnv = containerEnv(docker, pds, PDS_KEYS);
  const pdsHost = containerEnv(docker, edge, ["PDS_HOST"]).get("PDS_HOST");
  if (pdsHost === undefined || !names.has(pdsHost)) refuse("the edge's PDS_HOST is not one of the dev root's names");
  const isLocal = (name: string) => name.endsWith(".localhost") || names.has(name);
  if (!isLocal(pdsEnv.get("PDS_HOSTNAME") ?? "")) refuse("PDS_HOSTNAME is not local");
  const domains = (pdsEnv.get("PDS_SERVICE_HANDLE_DOMAINS") ?? "").split(",");
  if (!domains.every((domain) => domain.startsWith(".") && isLocal(domain.slice(1)))) {
    refuse("a handle domain is not local");
  }
  if (MAIL.some((name) => (pdsEnv.get(name) ?? "") !== "")) refuse("the PDS has a mail server set");
  checkServiceUrls(docker, pdsEnv, isLocal);
  checkPdsVolume(docker, pds);
  return { host: pdsHost, ca };
}

/**
 * Every service URL the PDS calls names the local stack: a local name, or one of the stack's own services by its
 * Compose label (a single-label host such as the local PLC's). An unset PDS_DID_PLC_URL fails, since the PDS then
 * uses the public directory (record 2026-10-13-local-plc), so until the local PLC exists this refuses every stack.
 */
function checkServiceUrls(docker: Docker, env: Map<string, string>, isLocal: (name: string) => boolean): void {
  if ((env.get("PDS_DID_PLC_URL") ?? "") === "") refuse("PDS_DID_PLC_URL is unset, so the PDS uses the public PLC");
  for (const name of SERVICE_URLS) {
    for (const value of (env.get(name) ?? "").split(",").filter((part) => part !== "")) {
      const host = URL.parse(value.trim())?.hostname ?? "";
      const local = isLocal(host) || (/^[a-z0-9-]+$/.test(host) && stackServices(docker, host) > 0);
      if (!local) refuse(`${name} names a host outside the local stack`);
    }
  }
}

/** The dev root's PEM, read in this process from an absolute path to a regular file: never a URI, never fetched. */
function devRootPem(stack: LocalStack): string {
  const path = stack.devRootCert;
  if (!isAbsolute(path) || normalize(path) !== path) refuse("the dev root certificate path is not absolute");
  if (stack.lstat(path)?.isFile() !== true) refuse("the dev root certificate is not a regular file");
  const pem = stack.readFile(path);
  if (!PEM.test(pem)) refuse("the dev root certificate is not one PEM certificate");
  return pem;
}

/** The DNS names the dev root permits: its critical nameConstraints extension, as openssl prints it from stdin. */
function devRootNames(stack: LocalStack, pem: string): Set<string> {
  const printed = stack.run("openssl", ["x509", "-noout", "-ext", "nameConstraints"], {
    timeoutMs: COMMAND_MS,
    input: pem,
  });
  if (printed.code !== 0) refuse("the dev root certificate is unreadable");
  const lines = printed.out.split("\n").map((line) => line.trim());
  const permitted = lines.slice(lines.indexOf("Permitted:") + 1);
  const end = permitted.findIndex((line) => !line.startsWith("DNS:"));
  const names = new Set(permitted.slice(0, end === -1 ? undefined : end).map((line) => line.slice("DNS:".length)));
  if (!lines.includes("Permitted:") || names.size === 0) refuse("the dev root names no DNS names");
  if (lines[0] !== "X509v3 Name Constraints: critical") refuse("the dev root's name constraints are not critical");
  return names;
}

/** The running containers of `service` in the pinned project, found by Compose's labels. */
function stackContainers(docker: Docker, service: string): string[] {
  return ok(
    docker([
      "ps",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=com.docker.compose.project=${PROJECT}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
    ]),
    "ps",
  )
    .split("\n")
    .filter((id) => id !== "");
}
const stackServices = (docker: Docker, service: string): number => stackContainers(docker, service).length;

function oneContainer(docker: Docker, service: string): string {
  const ids = stackContainers(docker, service);
  if (ids.length !== 1) refuse(`expected exactly one running ${service} container of the ${PROJECT} project`);
  return ids[0] as string;
}

/** Only `keys` of a container's environment; every other variable is dropped as it is parsed. */
function containerEnv(docker: Docker, id: string, keys: readonly string[]): Map<string, string> {
  const pairs = JSON.parse(ok(docker(["inspect", "--format", "{{json .Config.Env}}", id]), "inspect")) as string[];
  const wanted = new Map<string, string>();
  for (const pair of pairs) {
    const name = pair.slice(0, pair.indexOf("="));
    if (keys.includes(name)) wanted.set(name, pair.slice(pair.indexOf("=") + 1));
  }
  return wanted;
}

/** The volume at the PDS's /home/node must be the one Compose labelled as unset-dev's pdsdata. */
function checkPdsVolume(docker: Docker, pds: string): void {
  const mounts = JSON.parse(ok(docker(["inspect", "--format", "{{json .Mounts}}", pds]), "inspect")) as {
    Type: string;
    Name?: string;
    Destination: string;
  }[];
  const data = mounts.find((mount) => mount.Destination === "/home/node");
  if (data?.Type !== "volume" || data.Name === undefined) {
    refuse("the PDS does not keep its data in a named volume at /home/node");
  }
  const labelled = ok(
    docker([
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${PROJECT}`,
      "--filter",
      "label=com.docker.compose.volume=pdsdata",
    ]),
    "volume",
  )
    .split("\n")
    .filter((name) => name !== "");
  if (labelled.length !== 1 || labelled[0] !== data.Name)
    refuse(`the PDS volume is not the ${PROJECT} project's pdsdata`);
}

/** The token, from the reader's stdout only; its stderr is shown only when it is one of the reader's fixed reasons. */
function readToken(stack: LocalStack, docker: Docker, did: string): string {
  const read = docker([
    "compose",
    "--project-name",
    PROJECT,
    "--file",
    stack.composeFile,
    "--env-file",
    stack.interpolationEnv,
    "--profile",
    "tools",
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "pds-token-reader",
    "/reader/read.ts",
    did,
  ]);
  if (read.code !== 0) {
    const reason = read.err.trim();
    refuse(KNOWN_READER_REASONS.has(reason) ? `the token reader failed: ${reason}` : "the token reader failed");
  }
  if (!TOKEN.test(read.out)) refuse("the token reader printed something other than one token");
  return read.out;
}

/**
 * One XRPC procedure on the local PDS, with the account's access token and a deadline (RE-1). A request that fails
 * before any answer is named by the procedure alone: the transport's own error can carry the host or address.
 */
async function post(stack: LocalStack, pds: PinnedPds, method: string, jwt: string, body?: object): Promise<void> {
  let status: number;
  try {
    status = await stack.post({
      ...pds,
      path: `/xrpc/com.atproto.server.${method}`,
      headers: {
        authorization: `Bearer ${jwt}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      timeoutMs: REQUEST_MS,
    });
  } catch {
    refuse(`the PDS did not answer ${method}`);
  }
  if (status < 200 || status > 299) refuse(`the PDS refused ${method} (HTTP ${status})`);
}

/** Every address the system resolver gives for `host` (Node v26.10.0 doc/api/dns.md, dnsPromises.lookup `all`). */
export const resolveAll = (host: string): Promise<{ address: string }[]> => lookup(host, { all: true });

/**
 * The real PinnedPost: node:https connected to `address` alone through a `lookup` that answers nothing else, the
 * certificate verified for `host` against `ca` only (the dev root, never the system store), and the status returned
 * as it is: node:https follows no redirect (Node v26.10.0 doc/api/https.md, https.request; doc/api/net.md,
 * socket.connect `lookup`; doc/api/tls.md, tls.connect `ca`, `servername`).
 */
export function httpsPost({
  host,
  address,
  port = 443,
  path,
  headers,
  body,
  ca,
  timeoutMs,
}: PinnedPost): Promise<number> {
  return new Promise((done, failed) => {
    const family = address.includes(":") ? 6 : 4;
    const sent = request(
      {
        host,
        port,
        path,
        method: "POST",
        headers,
        ca,
        servername: host,
        rejectUnauthorized: true,
        agent: false,
        lookup: (_name, options, answer) => {
          if ((options as { all?: boolean }).all === true) answer(null, [{ address, family }] as never, family);
          else answer(null, address, family);
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        response.resume();
        done(response.statusCode ?? 0);
      },
    );
    sent.on("error", failed);
    sent.end(body);
  });
}

function ok(ran: Ran, subcommand: string): string {
  if (ran.code !== 0) refuse(`docker ${subcommand} failed`);
  return ran.out;
}

function refuse(reason: string): never {
  throw new Error(reason);
}
