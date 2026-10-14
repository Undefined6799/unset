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
const PEM = /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/;
const DNS = /^DNS:([a-z0-9.-]+)$/;
const DAY_MS = 86_400_000;

/** Why the local leaf copy is not one certificate for exactly APP_HOST and PDS_HOST, issued by the dev root. */
export function localLeafProblem(inputs: Inputs, appHost: string, pdsHost: string): Outcome | null {
  const leaf = certificate(inputs, LEAF);
  if (leaf === null) return missing(LEAF);
  if (leaf === "invalid") return fail("the local leaf copy is not one certificate");
  const root = certificate(inputs, ROOT);
  if (root === null) return missing(ROOT);
  if (root === "invalid") return fail("the dev root is not one certificate");
  if (leaf.ca) return fail("the local leaf is a CA");
  if (!leaf.checkIssued(root) || !leaf.verify(root.publicKey))
    return fail("the local leaf is not issued by the dev root");
  const names = (leaf.subjectAltName ?? "").split(", ");
  if (names.some((name) => name.startsWith("IP Address:"))) return fail("the local leaf has an IP name");
  const hosts = names.map((name) => DNS.exec(name)?.[1]);
  const wanted = [appHost, pdsHost];
  if (hosts.length !== 2 || !wanted.every((host) => hosts.includes(host))) {
    return fail("the local leaf's names are not exactly APP_HOST and PDS_HOST");
  }
  if (leaf.validToDate.getTime() - Date.now() < 14 * DAY_MS) return fail("the local leaf expires within 14 days");
  return null;
}

/** APP_HOST is a hostname and exactly the host web's PUBLIC_ORIGIN names (Amendment 3); reasons are fixed words. */
export function appHostProblem(inputs: Inputs, appHost: string | undefined): Outcome | null {
  if (appHost === undefined || appHost === "") return fail("APP_HOST is missing");
  if (!ENV_NAMES.APP_HOST.test(appHost)) return fail("APP_HOST is not a hostname");
  const origin = inputs.serviceEnv.get("web")?.use("PUBLIC_ORIGIN", (value) => value);
  if (origin === undefined || !URL.canParse(origin)) return fail("web's PUBLIC_ORIGIN is not a URL");
  if (new URL(origin).hostname !== appHost) return fail("APP_HOST is not the host of web's PUBLIC_ORIGIN");
  return null;
}

function certificate({ root, readText }: Inputs, path: string): X509Certificate | "invalid" | null {
  const text = readText(join(dirname(root), path));
  if (text === null) return null;
  if (!PEM.test(text)) return "invalid";
  try {
    return new X509Certificate(text);
  } catch {
    return "invalid";
  }
}
