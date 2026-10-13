// P1.29h: confirms a local test account's email through the PDS's real requestEmailConfirmation and confirmEmail,
// standing in for the inbox only. The token comes from the local stack's `pds-token-reader` service
// (tests/support/pds-email-token-read.ts), travels only from its stdout into the confirmEmail body, and is never
// logged, thrown or written down (SE-7). An admin "mark confirmed" and real SMTP on a developer machine stay refused.
//
// Local only (architecture record 2026-10-13-p129h-local-token-reader, point 4 and Amendment 1, guard (ii)): before
// anything reaches the PDS it refuses unless the Docker daemon is this machine's, the edge's PDS_HOST is one of the
// dev root's constrained names (P1.34d), PDS_HOSTNAME and every handle domain are local, the PDS sends no mail, every
// outbound key set in the PDS's environment names the local stack (an unset PDS_DID_PLC_URL is the public directory;
// Amendment 3, S2'), and the PDS's data volume is the one Compose made for `unset-dev`'s `pdsdata`, by its labels and
// not its name. P1.27l's local label joins these when it lands, and P1.33p refuses the tools profile on any public
// stack. Every reason is fixed text, never a value.
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
const RESOLVE_MS = 5_000;
const TOKEN = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;

// Every key @atproto/pds 0.5.37's dist/config/env.js reads, classified (architecture record
// 2026-10-13-p129h-local-token-reader, Amendment 3, S2', first bullet; coordinator's verify of #803 at 94ab296, B7).
// pds-email-token.image.test.ts reads env.js from the pinned PDS image and fails on any key not classified here,
// whatever its name: a key can send the PDS out just by being set.
const LOCAL_NAMES = ["PDS_HOSTNAME", "PDS_SERVICE_HANDLE_DOMAINS"];
const MAIL = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL"];
/** URLs the PDS connects to; PDS_CRAWLERS is a comma list (env.js envList). */
const OUTBOUND_URLS = [
  "PDS_DID_PLC_URL",
  "PDS_BSKY_APP_VIEW_URL",
  "PDS_BSKY_APP_VIEW_CDN_URL_PATTERN",
  "PDS_BLOBSTORE_S3_ENDPOINT",
  "PDS_CRAWLERS",
  "PDS_ENTRYWAY_URL",
  "PDS_MOD_SERVICE_URL",
  "PDS_REPORT_SERVICE_URL",
];
/** host:port addresses the PDS connects to; the nameservers are a comma list. */
const OUTBOUND_ADDRESSES = ["PDS_REDIS_SCRATCH_ADDRESS", "PDS_HANDLE_BACKUP_NAMESERVERS"];
/**
 * Keys that turn on a provider just by being set, naming no host (Codex on #803; verify at 94ab296, B1-B4):
 * - a bucket is S3: AWS's own when no endpoint is set (dist/config/config.js:51-60), `<bucket>.<endpoint host>` unless
 *   path style is on, and credentials the AWS SDK looks up itself unless a static key id is set (config.js:61-67);
 * - a KMS key id is AWS KMS, which takes no endpoint at all (dist/config/secrets.js:26-30);
 * - an hCaptcha site key calls api.hcaptcha.com (config.js:265-271; oauth-provider 0.23.1 lib/hcaptcha.js:105-111);
 * - a lexicon authority DID is resolved, and a did:web fetched from its host (config.js:279-281).
 */
const PROVIDER_SELECTORS = [
  "PDS_BLOBSTORE_S3_BUCKET",
  "PDS_PLC_ROTATION_KEY_KMS_KEY_ID",
  "PDS_HCAPTCHA_SITE_KEY",
  "PDS_LEXICON_AUTHORITY_DID",
];
/** How a bucket's client picks its host and its credentials; the secret access key is never read. */
const S3_FORM = ["PDS_BLOBSTORE_S3_FORCE_PATH_STYLE", "PDS_BLOBSTORE_S3_ACCESS_KEY_ID"];
/** The rest of env.js, never read here, by why none sends the PDS to a host it names. */
const NOT_OUTBOUND = [
  // Links and images the browser loads (config.js:222-252, describeServer).
  "PDS_HOME_URL",
  "PDS_LOGO_URL",
  "PDS_BACKGROUND_DARK_URL",
  "PDS_BACKGROUND_LIGHT_URL",
  "PDS_PRIVACY_POLICY_URL",
  "PDS_TERMS_OF_SERVICE_URL",
  "PDS_SUPPORT_URL",
  "PDS_PRIMARY_COLOR",
  "PDS_ERROR_COLOR",
  "PDS_INFO_COLOR",
  "PDS_SUCCESS_COLOR",
  "PDS_WARNING_COLOR",
  // Mail addresses and options: mail itself is refused, and without it the addresses stop the PDS starting
  // (config.js:131-156).
  "PDS_CONTACT_EMAIL_ADDRESS",
  "PDS_EMAIL_FROM_ADDRESS",
  "PDS_MODERATION_EMAIL_ADDRESS",
  "PDS_EMAIL_DISABLE_CONFIRMATION_LINK",
  // Places in the data volume.
  "PDS_DATA_DIRECTORY",
  "PDS_ACTOR_STORE_DIRECTORY",
  "PDS_ACCOUNT_DB_LOCATION",
  "PDS_SEQUENCER_DB_LOCATION",
  "PDS_DID_CACHE_DB_LOCATION",
  "PDS_BLOBSTORE_DISK_LOCATION",
  "PDS_BLOBSTORE_DISK_TMP_LOCATION",
  // DIDs: the PDS's own (not fetched), a did:key, and those used only with their judged URL (config.js:109-118,
  // 162-189).
  "PDS_SERVICE_DID",
  "PDS_RECOVERY_DID_KEY",
  "PDS_BSKY_APP_VIEW_DID",
  "PDS_ENTRYWAY_DID",
  "PDS_MOD_SERVICE_DID",
  "PDS_REPORT_SERVICE_DID",
  // Secrets and keys, used only with a judged or refused key above, or held by the PDS alone.
  "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX",
  "PDS_JWT_SECRET",
  "PDS_ADMIN_PASSWORD",
  "PDS_DPOP_SECRET",
  "PDS_ENTRYWAY_ADMIN_TOKEN",
  "PDS_ENTRYWAY_JWT_VERIFY_KEY_K256_PUBLIC_KEY_HEX",
  "PDS_ENTRYWAY_PLC_ROTATION_KEY",
  "PDS_REDIS_SCRATCH_PASSWORD",
  "PDS_RATE_LIMIT_BYPASS_KEY",
  "PDS_BLOBSTORE_S3_SECRET_ACCESS_KEY",
  "PDS_HCAPTCHA_SECRET_KEY",
  "PDS_HCAPTCHA_TOKEN_SALT",
  // S3 options with no host of their own; the region only signs once an endpoint is set.
  "PDS_BLOBSTORE_S3_REGION",
  "PDS_BLOBSTORE_S3_REQUEST_TIMEOUT_MS",
  "PDS_BLOBSTORE_S3_UPLOAD_TIMEOUT_MS",
  // Limits, timeouts, flags and names. The two that loosen SSRF on request-driven fetches name no destination;
  // preflight's C14 judges them.
  "PDS_PORT",
  "PDS_VERSION",
  "PDS_SERVICE_NAME",
  "PDS_DEV_MODE",
  "PDS_DISABLE_SSRF_PROTECTION",
  "PDS_INVITE_REQUIRED",
  "PDS_INVITE_INTERVAL",
  "PDS_INVITE_EPOCH",
  "PDS_ACCEPTING_REPO_IMPORTS",
  "PDS_MAX_REPO_IMPORT_SIZE",
  "PDS_REPO_BACKFILL_LIMIT_MS",
  "PDS_MAX_SUBSCRIPTION_BUFFER",
  "PDS_ENABLE_DID_DOC_WITH_SESSION",
  "PDS_OAUTH_TRUSTED_CLIENTS",
  "PDS_ACTOR_STORE_CACHE_SIZE",
  "PDS_BLOB_UPLOAD_LIMIT",
  "PDS_DID_CACHE_MAX_TTL",
  "PDS_DID_CACHE_STALE_TTL",
  "PDS_ID_RESOLVER_TIMEOUT",
  "PDS_FETCH_MAX_RESPONSE_SIZE",
  "PDS_SQLITE_DISABLE_WAL_AUTO_CHECKPOINT",
  "PDS_RATE_LIMITS_ENABLED",
  "PDS_RATE_LIMIT_BYPASS_IPS",
  "PDS_PROXY_ALLOW_HTTP2",
  "PDS_PROXY_BODY_TIMEOUT",
  "PDS_PROXY_HEADERS_TIMEOUT",
  "PDS_PROXY_MAX_RESPONSE_SIZE",
  "PDS_PROXY_MAX_RETRIES",
  "PDS_PROXY_PREFER_COMPRESSED",
];
export const CLASSIFIED_KEYS: ReadonlySet<string> = new Set([
  ...LOCAL_NAMES,
  ...MAIL,
  ...OUTBOUND_URLS,
  ...OUTBOUND_ADDRESSES,
  ...PROVIDER_SELECTORS,
  ...S3_FORM,
  ...NOT_OUTBOUND,
]);
/**
 * Variables of the PDS's process, which no env.js reads and so no drift test can see (verify at 94ab296, B5 and B6):
 * proxy-from-env, bundled with axios in @did-plc/lib 0.0.4, reads both spellings and npm's (dist/index.js:19222-19271)
 * for every PLC call; NODE_USE_ENV_PROXY routes Node's global fetch too, per Node v24.19.0 doc/api/cli.md; and
 * NODE_OPTIONS can turn that on, or load any module (--import, --require).
 */
const PROXY_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "npm_config_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
  "NODE_USE_ENV_PROXY",
];
/** The only NODE_OPTIONS accepted: the heap size the dev PDS sets (deployment/compose.dev.yaml). */
const HEAP_SIZE_ONLY = /^--max-old-space-size=[1-9][0-9]*$/;

// The only import line of the pinned env.js, and its four helpers (@atproto/common 0.8.5 dist/env.js).
const HELPERS_IMPORT = "import { envBool, envInt, envList, envStr } from '@atproto/common';";
/**
 * The drift check on the pinned env.js (Amendment 3, S2'): every key it reads that is not classified, plus every
 * classified key it no longer reads. It refuses a file that could reach the environment any other way than one of
 * the four helpers called with a literal name (verify at 94ab296, S1): no `process`, no import but the helpers', each
 * helper named only in that import and in a read, and no key-shaped name outside a read.
 */
export function outboundDrift(envJs: string): string[] {
  const count = (pattern: RegExp) => [...envJs.matchAll(pattern)].length;
  const keys = [...envJs.matchAll(/\benv(?:Str|Int|Bool|List)\('([A-Z][A-Z0-9_]*)'\)/g)].map(
    (match) => match[1] as string,
  );
  const imports = envJs.split("\n").filter((line) => /\b(?:import|require)\b/.test(line));
  const parsed =
    keys.length > 0 &&
    count(/\bprocess\b/g) === 0 &&
    imports.length === 1 &&
    imports[0] === HELPERS_IMPORT &&
    count(/\benv(?:Str|Int|Bool|List)\b/g) === keys.length + 4 &&
    count(/\benv[A-Za-z]*\s*\(/g) === keys.length &&
    count(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g) === keys.length;
  if (!parsed) return ["env.js reads a key in a form this check does not parse"];
  const read = new Set(keys);
  return [
    ...[...read].filter((key) => !CLASSIFIED_KEYS.has(key)).map((key) => `${key} unclassified`),
    ...[...CLASSIFIED_KEYS].filter((key) => !read.has(key)).map((key) => `${key} no longer read`),
  ];
}

/** The only PDS variables read; Docker prints these and no other, so its secrets never reach this process. */
const PDS_KEYS = [
  ...LOCAL_NAMES,
  ...MAIL,
  ...OUTBOUND_URLS,
  ...OUTBOUND_ADDRESSES,
  ...PROVIDER_SELECTORS,
  ...S3_FORM,
  ...PROXY_KEYS,
  "NODE_OPTIONS",
];
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
const loopback = (address: string): boolean => LOOPBACK_V4.test(address) || address === "::1";

/** `work`, or a rejection once `ms` have passed (RE-1): the system resolver takes no deadline of its own. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, failed) => {
    timer = setTimeout(() => failed(new Error("deadline")), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

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
    answers = await within(stack.resolve(host), RESOLVE_MS);
  } catch {
    refuse("the edge's PDS_HOST does not resolve");
  }
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
  checkProcess(pdsEnv);
  checkProviders(pdsEnv);
  checkOutbound(docker, pdsEnv, isLocal);
  checkPdsVolume(docker, pds);
  return { host: pdsHost, ca };
}

/** No proxy, and NODE_OPTIONS at most the heap size: the PDS's process connects only where its keys say. */
function checkProcess(env: Map<string, string>): void {
  for (const name of PROXY_KEYS) {
    if ((env.get(name) ?? "") !== "") refuse(`${name} is set, so the PDS sends requests through a proxy`);
  }
  const options = env.get("NODE_OPTIONS") ?? "";
  if (options !== "" && !HEAP_SIZE_ONLY.test(options)) refuse("NODE_OPTIONS is not only a heap size");
}

/**
 * No provider that names no host of its own: no KMS, hCaptcha or lexicon authority, and a bucket only on a judged
 * endpoint, path style (envBool's "true" or "1", @atproto/common 0.8.5 dist/env.js:12-19) and a static key id, so
 * the AWS SDK's own credential lookup never runs (config.js:61-67).
 */
function checkProviders(env: Map<string, string>): void {
  const set = (name: string): boolean => (env.get(name) ?? "") !== "";
  if (set("PDS_PLC_ROTATION_KEY_KMS_KEY_ID")) refuse("PDS_PLC_ROTATION_KEY_KMS_KEY_ID is set, so the PDS uses AWS KMS");
  if (set("PDS_HCAPTCHA_SITE_KEY")) refuse("PDS_HCAPTCHA_SITE_KEY is set, so the PDS calls hCaptcha");
  if (set("PDS_LEXICON_AUTHORITY_DID")) {
    refuse("PDS_LEXICON_AUTHORITY_DID is set, so the PDS resolves lexicons through that DID");
  }
  if (!set("PDS_BLOBSTORE_S3_BUCKET")) return;
  if (!set("PDS_BLOBSTORE_S3_ENDPOINT")) {
    refuse("PDS_BLOBSTORE_S3_BUCKET is set without PDS_BLOBSTORE_S3_ENDPOINT, so the PDS uses AWS S3");
  }
  if (!["true", "1"].includes(env.get("PDS_BLOBSTORE_S3_FORCE_PATH_STYLE") ?? "")) {
    refuse("PDS_BLOBSTORE_S3_FORCE_PATH_STYLE is not true, so the S3 host is the bucket's subdomain");
  }
  if (!set("PDS_BLOBSTORE_S3_ACCESS_KEY_ID")) {
    refuse("PDS_BLOBSTORE_S3_ACCESS_KEY_ID is unset, so the AWS SDK looks up credentials itself");
  }
}

/**
 * Every outbound key that is set names the local stack: a loopback address, a local name, or one of the stack's own
 * services by its Compose label (a single-label host such as the local PLC's). An unset key sends nothing, except
 * PDS_DID_PLC_URL, whose default is the public directory (record 2026-10-13-local-plc), so until the local PLC exists
 * this refuses every stack.
 */
function checkOutbound(docker: Docker, env: Map<string, string>, isLocal: (name: string) => boolean): void {
  if ((env.get("PDS_DID_PLC_URL") ?? "") === "") refuse("PDS_DID_PLC_URL is unset, so the PDS uses the public PLC");
  const onStack = (host: string): boolean =>
    loopback(host.replace(/^\[(.*)\]$/, "$1")) ||
    isLocal(host) ||
    (/^[a-z0-9-]+$/.test(host) && stackServices(docker, host) > 0);
  const judge = (name: string, asUrl: (value: string) => string) => {
    for (const value of (env.get(name) ?? "").split(",").filter((part) => part !== "")) {
      if (!onStack(URL.parse(asUrl(value.trim()))?.hostname ?? ""))
        refuse(`${name} names a host outside the local stack`);
    }
  };
  for (const name of OUTBOUND_URLS) judge(name, (value) => value);
  for (const name of OUTBOUND_ADDRESSES) judge(name, (value) => `tcp://${value}`);
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

/** Only `keys` of a container's environment: Docker prints those and nothing else, so no other value reaches here. */
function containerEnv(docker: Docker, id: string, keys: readonly string[]): Map<string, string> {
  const printed = ok(docker(["inspect", "--format", envFormat(keys), id]), "inspect");
  const wanted = new Map<string, string>();
  for (const line of printed.split("\n").filter((line) => line !== "")) {
    const pair = JSON.parse(line) as string;
    // A name set twice is refused: which value the process sees is the runtime's choice (runc keeps the last).
    if (wanted.has(pair.slice(0, pair.indexOf("=")))) refuse("a container variable is set twice");
    wanted.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
  }
  return wanted;
}

/**
 * A `docker inspect` template printing each of `keys` set in the container's environment as one JSON string per line
 * (Docker CLI 29.8.2 templates/templates.go:18-20, `split` and `json`; Go text/template `eq` with several arguments,
 * pkg.go.dev/text/template "Functions"). Measured on Docker 29.8.2: a value holding "=" prints whole, an empty value
 * prints, an unset key prints nothing.
 */
export const envFormat = (keys: readonly string[]): string =>
  `{{range .Config.Env}}{{if eq (index (split . "=") 0) ${keys.map((key) => JSON.stringify(key)).join(" ")}}}` +
  "{{json .}}{{println}}{{end}}{{end}}";

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
        // Answered on the next tick: a connect that fails at once (an IPv6 pin on a host without IPv6) must fail after
        // request() has returned and its error handler is attached, or the error goes unhandled and ends the process.
        lookup: (_name, options, answer) =>
          process.nextTick(() => {
            if ((options as { all?: boolean }).all === true) answer(null, [{ address, family }] as never, family);
            else answer(null, address, family);
          }),
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
