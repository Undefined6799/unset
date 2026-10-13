// P1.29h: confirms a local test account's email through the PDS's real requestEmailConfirmation and confirmEmail,
// standing in for the inbox only. The token comes from the local stack's `pds-token-reader` service
// (tests/support/pds-email-token-read.ts), travels only from its stdout into the confirmEmail body, and is never
// logged, thrown or written down (SE-7). An admin "mark confirmed" and real SMTP on a developer machine stay refused.
//
// Local only (architecture record 2026-10-13-p129h-local-token-reader, point 4 and Amendment 1, guard (ii)): before
// anything reaches the PDS it refuses unless the edge's PDS_HOST is one of the dev root's constrained names
// (P1.34d), PDS_HOSTNAME and every handle domain are local, the PDS sends no mail, and the PDS's data volume is the
// one Compose made for `unset-dev`'s `pdsdata`, by its labels and not its name. P1.27l's local label joins these when
// it lands, and P1.33p refuses the tools profile on any public stack. Every reason is fixed text, never a value.
import type { Call, Ran } from "./docker.ts";
import { READER_REASONS } from "./pds-email-token-read.ts";

/** How the wrapper reaches the local stack; tests pass stand-ins. */
export type LocalStack = {
  /** runOrKill (tests/support/docker.ts) in a real run. */
  run: (file: string, args: readonly string[], call: Call) => Ran;
  fetch: typeof fetch;
  log: (line: string) => void;
  /** The dev root's public certificate (P1.34d; `unset-dev-env/` beside the checkout). */
  devRootCert: string;
  composeFile: string;
  interpolationEnv: string;
};
export type LocalAccount = { did: string; email: string; accessJwt: string };

const PROJECT = "unset-dev";
const COMMAND_MS = 30_000;
const REQUEST_MS = 10_000;
const TOKEN = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;
const MAIL = ["PDS_EMAIL_SMTP_URL", "PDS_MODERATION_EMAIL_SMTP_URL"];
const KNOWN_READER_REASONS = new Set<string>(Object.values(READER_REASONS));

/** Runs requestEmailConfirmation, reads the token on the local stack, and sends it to confirmEmail. */
export async function confirmLocalEmail(stack: LocalStack, account: LocalAccount): Promise<void> {
  const pdsHost = checkLocalStack(stack);
  stack.log("local stack checked");
  await post(stack, pdsHost, "requestEmailConfirmation", account.accessJwt);
  const token = readToken(stack, account.did);
  await post(stack, pdsHost, "confirmEmail", account.accessJwt, { email: account.email, token });
  stack.log("email confirmed through the PDS");
}

/** The PDS's host on the edge, once every local-only check holds. */
function checkLocalStack(stack: LocalStack): string {
  const names = devRootNames(stack);
  const pds = oneContainer(stack, "pds");
  const edge = oneContainer(stack, "edge");
  const pdsEnv = containerEnv(stack, pds);
  const pdsHost = containerEnv(stack, edge).get("PDS_HOST");
  if (pdsHost === undefined || !names.has(pdsHost)) refuse("the edge's PDS_HOST is not one of the dev root's names");
  const isLocal = (name: string) => name.endsWith(".localhost") || names.has(name);
  if (!isLocal(pdsEnv.get("PDS_HOSTNAME") ?? "")) refuse("PDS_HOSTNAME is not local");
  const domains = (pdsEnv.get("PDS_SERVICE_HANDLE_DOMAINS") ?? "").split(",");
  if (!domains.every((domain) => domain.startsWith(".") && isLocal(domain.slice(1)))) {
    refuse("a handle domain is not local");
  }
  if (MAIL.some((name) => (pdsEnv.get(name) ?? "") !== "")) refuse("the PDS has a mail server set");
  checkPdsVolume(stack, pds);
  return pdsHost;
}

/** The DNS names the dev root permits: its critical nameConstraints extension, as openssl prints it. */
function devRootNames(stack: LocalStack): Set<string> {
  const printed = stack.run("openssl", ["x509", "-in", stack.devRootCert, "-noout", "-ext", "nameConstraints"], {
    timeoutMs: COMMAND_MS,
  });
  if (printed.code !== 0) refuse("the dev root certificate is missing or unreadable");
  const lines = printed.out.split("\n").map((line) => line.trim());
  const permitted = lines.slice(lines.indexOf("Permitted:") + 1);
  const end = permitted.findIndex((line) => !line.startsWith("DNS:"));
  const names = new Set(permitted.slice(0, end === -1 ? undefined : end).map((line) => line.slice("DNS:".length)));
  if (!lines.includes("Permitted:") || names.size === 0) refuse("the dev root names no DNS names");
  if (lines[0] !== "X509v3 Name Constraints: critical") refuse("the dev root's name constraints are not critical");
  return names;
}

/** The one running container of `service` in the pinned project, found by Compose's labels. */
function oneContainer(stack: LocalStack, service: string): string {
  const ids = docker(stack, [
    "ps",
    "--quiet",
    "--no-trunc",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  ])
    .split("\n")
    .filter((id) => id !== "");
  if (ids.length !== 1) refuse(`expected exactly one running ${service} container of the ${PROJECT} project`);
  return ids[0] as string;
}

function containerEnv(stack: LocalStack, id: string): Map<string, string> {
  const pairs = JSON.parse(docker(stack, ["inspect", "--format", "{{json .Config.Env}}", id])) as string[];
  return new Map(pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
}

/** The volume at the PDS's /home/node must be the one Compose labelled as unset-dev's pdsdata. */
function checkPdsVolume(stack: LocalStack, pds: string): void {
  const mounts = JSON.parse(docker(stack, ["inspect", "--format", "{{json .Mounts}}", pds])) as {
    Type: string;
    Name?: string;
    Destination: string;
  }[];
  const data = mounts.find((mount) => mount.Destination === "/home/node");
  if (data?.Type !== "volume" || data.Name === undefined) {
    refuse("the PDS does not keep its data in a named volume at /home/node");
  }
  const labelled = docker(stack, [
    "volume",
    "ls",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--filter",
    "label=com.docker.compose.volume=pdsdata",
  ])
    .split("\n")
    .filter((name) => name !== "");
  if (labelled.length !== 1 || labelled[0] !== data.Name)
    refuse(`the PDS volume is not the ${PROJECT} project's pdsdata`);
}

/** The token, from the reader's stdout only; its stderr is shown only when it is one of the reader's fixed reasons. */
function readToken(stack: LocalStack, did: string): string {
  const read = stack.run(
    "docker",
    [
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
    ],
    { timeoutMs: COMMAND_MS },
  );
  if (read.code !== 0) {
    const reason = read.err.trim();
    refuse(KNOWN_READER_REASONS.has(reason) ? `the token reader failed: ${reason}` : "the token reader failed");
  }
  if (!TOKEN.test(read.out)) refuse("the token reader printed something other than one token");
  return read.out;
}

/** One XRPC procedure on the local PDS, with the account's access token and a deadline (RE-1); never redirected. */
async function post(stack: LocalStack, host: string, method: string, jwt: string, body?: object): Promise<void> {
  const response = await stack.fetch(`https://${host}/xrpc/com.atproto.server.${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_MS),
  });
  if (!response.ok) refuse(`the PDS refused ${method} (HTTP ${response.status})`);
}

function docker(stack: LocalStack, args: string[]): string {
  const ran = stack.run("docker", args, { timeoutMs: COMMAND_MS });
  if (ran.code !== 0) refuse(`docker ${args[0]} failed`);
  return ran.out;
}

function refuse(reason: string): never {
  throw new Error(reason);
}
