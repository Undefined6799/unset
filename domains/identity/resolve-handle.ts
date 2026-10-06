// Handle → DID (P2.01), by the two methods of https://atproto.com/specs/handle ("Handle Resolution"), read from
// github.com/bluesky-social/atproto-website at 7937e9c: a `_atproto` TXT record, preferred, then the HTTPS
// well-known path. The result is not trusted on its own: verifyHandle (P2.02) checks that the DID claims the handle.
// Fail closed: when either method could not tell, the answer is `unavailable`, never "no such handle".
import type { HttpOutcome, IdentityNetwork, TxtOutcome } from "./contract.ts";
import { type Did, type Handle, parseDid } from "./syntax.ts";

export type HandleResolution =
  | { readonly status: "found"; readonly did: Did; readonly via: "dns" | "https" }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" };

type MethodResult = { readonly kind: "found"; readonly did: Did } | { readonly kind: "none" | "unavailable" };

const TXT_PREFIX = "did=";
const DNS_PREFIX = "_atproto.";
/** DNS names stop at 253 characters; a longer `_atproto.` name can only use the HTTPS method (spec, "DNS TXT Method"). */
const MAX_DNS_NAME = 253;
const MAX_WELL_KNOWN_BYTES = 1024;
const ASCII_SPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;

/** One distinct `did=` DID: found. None: none. Two different ones: none, and HTTPS decides (spec: must not pick). */
function fromTxt(outcome: TxtOutcome): MethodResult {
  if (outcome.kind === "no_record") return { kind: "none" };
  if (outcome.kind === "unavailable") return { kind: "unavailable" };
  const dids = new Set<Did>();
  for (const record of outcome.records) {
    const did = record.startsWith(TXT_PREFIX) ? parseDid(record.slice(TXT_PREFIX.length)) : null;
    if (did !== null) dids.add(did);
  }
  const [only] = dids;
  return dids.size === 1 && only !== undefined ? { kind: "found", did: only } : { kind: "none" };
}

function fromWellKnown(outcome: HttpOutcome): MethodResult {
  if (outcome.kind === "unavailable") return { kind: "unavailable" };
  if (outcome.kind !== "response") return { kind: "none" }; // no such host, or refused (private, redirect, too large)
  const { status } = outcome;
  if (status === 429 || status >= 500) return { kind: "unavailable" };
  if (status !== 200) return { kind: "none" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(outcome.body);
  } catch {
    return { kind: "none" };
  }
  const did = parseDid(text.replace(ASCII_SPACE, ""));
  return did === null ? { kind: "none" } : { kind: "found", did };
}

export async function resolveHandle(network: IdentityNetwork, handle: Handle): Promise<HandleResolution> {
  const name = `${DNS_PREFIX}${handle}`;
  const dns: MethodResult = name.length > MAX_DNS_NAME ? { kind: "none" } : fromTxt(await network.txt(name));
  if (dns.kind === "found") return { status: "found", did: dns.did, via: "dns" };
  const url = new URL(`https://${handle}/.well-known/atproto-did`);
  const https = fromWellKnown(
    await network.get(url, { target: "public", maxBytes: MAX_WELL_KNOWN_BYTES, accept: "text/plain" }),
  );
  if (https.kind === "found") return { status: "found", did: https.did, via: "https" };
  if (dns.kind === "unavailable" || https.kind === "unavailable") return { status: "unavailable" };
  return { status: "not_found" };
}
