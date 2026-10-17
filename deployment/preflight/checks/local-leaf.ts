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
import { certificateExtensions, DerError, der, type Extension } from "./der.ts";
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

/**
 * Why the local leaf copy is not one certificate for exactly APP_HOST and PDS_HOST, issued by the dev root, with both in
 * their validity dates.
 */
export function localLeafProblem(inputs: Inputs, appHost: string, pdsHost: string): Outcome | null {
  const leafCopy = certificate(inputs, LEAF, "the local leaf copy is not one certificate");
  if ("reason" in leafCopy) return leafCopy;
  const copy = rootCopyProblem(inputs);
  if (copy !== null) return copy;
  const rootCopy = certificate(inputs, ROOT, "the dev root is not one certificate");
  if ("reason" in rootCopy) return rootCopy;
  // Malformed before anything relies on OpenSSL's reading of it: OpenSSL accepts a long-form length and re-encodes it.
  const extensions = rootExtensions(rootCopy.der);
  if (!Array.isArray(extensions)) return fail(extensions);
  const [leaf, root] = [leafCopy.x509, rootCopy.x509];
  const now = Date.now();
  if (root.validFromDate.getTime() > now) return fail("the dev root is not yet valid");
  if (root.validToDate.getTime() <= now) return fail("the dev root has expired");
  if (leaf.ca) return fail("the local leaf is a CA");
  if (!leaf.checkIssued(root) || !leaf.verify(root.publicKey))
    return fail("the local leaf is not issued by the dev root");
  const served = servedProblem(leaf, appHost, pdsHost, now);
  if (served !== null) return fail(served);
  if (!root.ca) return fail("the dev root is not a CA");
  const limits = rootLimitsProblem(extensions, appHost, pdsHost);
  return limits === null ? null : fail(limits);
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

/**
 * APP_HOST is a hostname, a proper name under .localhost (the names the dev root may vouch for), not PDS_HOST, and
 * exactly the host web's PUBLIC_ORIGIN names (Amendment 3; P1.35p, architecture 04:03Z). Reasons are fixed words.
 */
export function appHostProblem(
  inputs: Inputs,
  appHost: string | undefined,
  pdsHost: string | undefined,
): Outcome | null {
  if (appHost === undefined || appHost === "") return fail("APP_HOST is missing");
  // An all-digit last label is an IPv4 address the hostname pattern also admits (verify-869 S1).
  if (!ENV_NAMES.APP_HOST.test(appHost) || /\.\d+$/.test(appHost)) return fail("APP_HOST is not a hostname");
  // By whole labels, so app.notlocalhost is not under it (SE-7a); the pattern above already needs a label before it.
  if (!appHost.endsWith(".localhost")) return fail("APP_HOST is not a name under .localhost");
  if (appHost === pdsHost) return fail("APP_HOST is PDS_HOST");
  const origin = inputs.serviceEnv.get("web")?.use("PUBLIC_ORIGIN", (value) => value);
  if (origin === undefined || !URL.canParse(origin)) return fail("web's PUBLIC_ORIGIN is not a URL");
  if (new URL(origin).hostname !== appHost) return fail("APP_HOST is not the host of web's PUBLIC_ORIGIN");
  return null;
}

/**
 * The one PEM certificate at `path` beside the checkout, as node:crypto reads it and as its own bytes, or why not, with
 * `invalid` when it is not one certificate. The bytes are the PEM's, never `raw`, which OpenSSL re-encodes; base64 that
 * does not encode back to the same text is refused, so the bytes walked are the bytes OpenSSL parsed.
 */
function certificate(inputs: Inputs, path: string, invalid: string): { x509: X509Certificate; der: Buffer } | Outcome {
  const text = readBeside(inputs, path);
  if (typeof text !== "string") return text;
  if (!PEM.test(text)) return fail(invalid);
  const body = text.replace(/-----[A-Z ]+-----|\n/g, "");
  const bytes = Buffer.from(body, "base64");
  if (bytes.toString("base64") !== body) return fail(invalid);
  try {
    return { x509: new X509Certificate(text), der: bytes };
  } catch {
    return fail(invalid);
  }
}

/** The root's extensions, or why its encoding is refused: not DER anywhere, or one extension given twice (S1). */
function rootExtensions(root: Buffer): Extension[] | string {
  let extensions: Extension[];
  try {
    extensions = certificateExtensions(root);
  } catch (error) {
    if (error instanceof DerError) return "the dev root is not DER";
    throw error;
  }
  const oids = new Set(extensions.map((extension) => extension.oid));
  return oids.size === extensions.length ? extensions : "the dev root repeats an extension";
}

/** id-ce 19, 15 and 30 (RFC 5280 sections 4.2.1.9, 4.2.1.3, 4.2.1.10), as the OID's content octets in hex. */
const BASIC_CONSTRAINTS = "551d13";
const KEY_USAGE = "551d0f";
const NAME_CONSTRAINTS = "551d1e";
/** BasicConstraints { cA TRUE, pathLenConstraint 0 }: the root signs leaves and no other CA (N3). */
const CA_FOR_LEAVES = der(0x30, der(0x01, Buffer.from([0xff])), der(0x02, Buffer.from([0])));
/** KeyUsage with exactly keyCertSign (bit 5) and cRLSign (bit 6): 0x06, its last bit unused (X.690 11.2.2). */
const SIGNS_ONLY = der(0x03, Buffer.from([0x01, 0x06]));

/**
 * Why the root's own limits are not the runbook's, each extension critical and byte for byte (N3, S1; item 2 and
 * Amendment 2 of the record): a CA for leaves only, signing only certificates and CRLs, and exactly one name
 * constraints extension permitting the two local hosts, in either order, and excluding every IPv4 and IPv6 address.
 */
function rootLimitsProblem(extensions: Extension[], appHost: string, pdsHost: string): string | null {
  const exact = (oid: string, value: Buffer) =>
    extensions.some((extension) => extension.oid === oid && extension.critical && extension.value.equals(value));
  if (!exact(BASIC_CONSTRAINTS, CA_FOR_LEAVES)) {
    return "the dev root's basic constraints are not critical CA:TRUE, pathlen:0";
  }
  if (!exact(KEY_USAGE, SIGNS_ONLY)) return "the dev root's key usage is not critical keyCertSign and cRLSign";
  const hosts = [
    [appHost, pdsHost],
    [pdsHost, appHost],
  ];
  if (!hosts.some((order) => exact(NAME_CONSTRAINTS, nameConstraints(order)))) {
    return "the dev root does not carry the local name constraints";
  }
  return null;
}

/** NameConstraints: the hosts as dNSName [2] subtrees permitted [0]; 0.0.0.0/0 and ::/0 as iPAddress [7] excluded [1]. */
function nameConstraints(hosts: string[]): Buffer {
  const permitted = der(0xa0, ...hosts.map((host) => der(0x30, der(0x82, Buffer.from(host, "ascii")))));
  const excluded = der(0xa1, der(0x30, der(0x87, Buffer.alloc(8))), der(0x30, der(0x87, Buffer.alloc(32))));
  return der(0x30, permitted, excluded);
}
