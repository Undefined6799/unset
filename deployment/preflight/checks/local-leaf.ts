// C18 under --env local: the dev leaf the local edge serves (P1.33x; record 2026-10-12-p134c-p134d-local-dev-root-ca,
// Amendments 2 and 3 and the architecture ruling of 2026-10-14 ~22:20Z). The preflight runs as the deploy user and
// cannot read the leaf secret (0400, the edge's uid), so it judges the public, certificate-only copy the same openssl
// run writes beside the env files; local:up (P1.34d) proves after start that the edge serves the same bytes.
//
// node:crypto X509Certificate, Node v26.10.0 (lib/internal/crypto/x509.js), measured on that version with an openssl
// 3.0.13 leaf: subjectAltName prints "DNS:a, DNS:b, IP Address:127.0.0.1", and a name holding a comma, quote or space
// prints as a JSON string, which the DNS pattern below refuses; validToDate is a Date; ca is basicConstraints CA:TRUE;
// checkIssued and verify(publicKey) test the issuer's name and signature.
import { X509Certificate } from "node:crypto";
import { dirname, join } from "node:path";
import { ENV_NAMES } from "../../edge/caddyfile.ts";
import { fail, type Inputs, missing, type Outcome } from "./types.ts";

/**
 * Beside the checkout, like the secrets folder: the leaf copy, and the dev root's public certificate in its own folder,
 * which P1.34d binds into pds and web (record 2026-10-14-p134d-split, "Item 5 settled").
 */
const LEAF = "unset-dev-env/local-leaf.pem";
const ROOT = "unset-dev-trust/root.pem";
/** The dev CA's own root certificate, which the trusted copy must equal (P1.33g). */
const CA_ROOT = "unset-dev-ca/root.pem";
const PEM = /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/;
const DNS = /^DNS:([a-z0-9.-]+)$/;
const DAY_MS = 86_400_000;
/** id-ce-nameConstraints, 2.5.29.30, with its tag and length. */
const NAME_CONSTRAINTS_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e]);

/**
 * Why the local leaf copy is not one certificate for exactly APP_HOST and PDS_HOST, issued by the dev root, with both in
 * their validity dates.
 */
export function localLeafProblem(inputs: Inputs, appHost: string, pdsHost: string): Outcome | null {
  const leaf = certificate(inputs, LEAF, "the local leaf copy is not one certificate");
  if (!(leaf instanceof X509Certificate)) return leaf;
  const copy = rootCopyProblem(inputs);
  if (copy !== null) return copy;
  const root = certificate(inputs, ROOT, "the dev root is not one certificate");
  if (!(root instanceof X509Certificate)) return root;
  const now = Date.now();
  if (root.validFromDate.getTime() > now) return fail("the dev root is not yet valid");
  if (root.validToDate.getTime() <= now) return fail("the dev root has expired");
  if (leaf.ca) return fail("the local leaf is a CA");
  if (!leaf.checkIssued(root) || !leaf.verify(root.publicKey))
    return fail("the local leaf is not issued by the dev root");
  const served = servedProblem(leaf, appHost, pdsHost, now);
  if (served !== null) return fail(served);
  if (!root.ca) return fail("the dev root is not a CA");
  if (!hasLocalConstraints(root, appHost, pdsHost))
    return fail("the dev root does not carry the local name constraints");
  return null;
}

/** Why the leaf does not name exactly APP_HOST and PDS_HOST, with no IP, inside its dates and 14 days from the end. */
function servedProblem(leaf: X509Certificate, appHost: string, pdsHost: string, now: number): string | null {
  const names = (leaf.subjectAltName ?? "").split(", ");
  if (names.some((name) => name.startsWith("IP Address:"))) return "the local leaf has an IP name";
  const hosts = names.map((name) => DNS.exec(name)?.[1]);
  const wanted = [appHost, pdsHost];
  if (hosts.length !== 2 || !wanted.every((host) => hosts.includes(host))) {
    return "the local leaf's names are not exactly APP_HOST and PDS_HOST";
  }
  if (leaf.validFromDate.getTime() > now) return "the local leaf is not yet valid";
  if (leaf.validToDate.getTime() - now < 14 * DAY_MS) return "the local leaf expires within 14 days";
  return null;
}

/**
 * Why the root pds and web trust is not the dev CA's own root certificate, or null (P1.33g; record
 * 2026-10-12-p134c-p134d-local-dev-root-ca, "Architecture confirmation", conditions 2 and 3). A private key anywhere in
 * it refuses first. Equal text is equal bytes here: the copy must also pass PEM's ASCII-only pattern, and no non-ASCII
 * byte decodes to ASCII.
 */
function rootCopyProblem(inputs: Inputs): Outcome | null {
  const copy = readBeside(inputs, ROOT);
  if (typeof copy !== "string") return copy;
  if (copy.includes("PRIVATE KEY")) return fail("the dev root copy holds a private key");
  const original = readBeside(inputs, CA_ROOT);
  if (typeof original !== "string") return original;
  if (copy !== original) return fail(`the dev root copy is not the dev CA's root: ${ROOT} and ${CA_ROOT}`);
  return null;
}

/** A file beside the checkout as text, or why not: absent is input missing, and only a regular file is read (S2). */
function readBeside({ root, readRegular }: Inputs, path: string): string | Outcome {
  const text = readRegular(join(dirname(root), path));
  if (text === null) return missing(path);
  if (text === "not a regular file") return fail(`${path} is not a regular file`);
  return text;
}

/** APP_HOST is a hostname and exactly the host web's PUBLIC_ORIGIN names (Amendment 3); reasons are fixed words. */
export function appHostProblem(inputs: Inputs, appHost: string | undefined): Outcome | null {
  if (appHost === undefined || appHost === "") return fail("APP_HOST is missing");
  // An all-digit last label is an IPv4 address the hostname pattern also admits (verify-869 S1).
  if (!ENV_NAMES.APP_HOST.test(appHost) || /\.\d+$/.test(appHost)) return fail("APP_HOST is not a hostname");
  const origin = inputs.serviceEnv.get("web")?.use("PUBLIC_ORIGIN", (value) => value);
  if (origin === undefined || !URL.canParse(origin)) return fail("web's PUBLIC_ORIGIN is not a URL");
  if (new URL(origin).hostname !== appHost) return fail("APP_HOST is not the host of web's PUBLIC_ORIGIN");
  return null;
}

/** The one PEM certificate at `path` beside the checkout, or why not, with `invalid` when it is not one certificate. */
function certificate(inputs: Inputs, path: string, invalid: string): X509Certificate | Outcome {
  const text = readBeside(inputs, path);
  if (typeof text !== "string") return text;
  if (!PEM.test(text)) return fail(invalid);
  try {
    return new X509Certificate(text);
  } catch {
    return fail(invalid);
  }
}

/**
 * Whether the root carries the runbook's critical name constraints exactly (item 2 and Amendment 2 of the record): the
 * two local hosts permitted, in either order, and every IPv4 and IPv6 address excluded. node:crypto exposes no name
 * constraints (Node v26.10.0, measured: neither X509Certificate nor toLegacyObject() has them), so the extension's
 * DER encoding (RFC 5280
 * section 4.2.1.10: id-ce 30, GeneralSubtrees of dNSName [2] and iPAddress [7] address plus mask) is built and found in
 * the certificate's bytes.
 */
function hasLocalConstraints(root: X509Certificate, appHost: string, pdsHost: string): boolean {
  return [
    [appHost, pdsHost],
    [pdsHost, appHost],
  ].some((hosts) => root.raw.includes(nameConstraints(hosts)));
}

function nameConstraints(hosts: string[]): Buffer {
  const permitted = der(0xa0, ...hosts.map((host) => der(0x30, der(0x82, Buffer.from(host, "ascii")))));
  const excluded = der(0xa1, der(0x30, der(0x87, Buffer.alloc(8))), der(0x30, der(0x87, Buffer.alloc(32))));
  const critical = der(0x01, Buffer.from([0xff]));
  return der(0x30, NAME_CONSTRAINTS_OID, critical, der(0x04, der(0x30, permitted, excluded)));
}

/** One DER tag-length-value; lengths up to 65535, far beyond two host names. */
function der(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
  return Buffer.concat([Buffer.from([tag, ...length]), body]);
}
