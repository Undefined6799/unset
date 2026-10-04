// Guard: all caller-influenced outbound traffic goes through infrastructure/net-guard.
// The prototype grew four copies of private-IP classification and an SSRF via
// redirects + DNS rebinding before this was centralised (PLAN.md §2 rule 13).
// Lexical, so it cannot see an aliased global (`const f = fetch`), `fetch.call`, a specifier split over lines or
// a computed import(); dependency-cruiser's net-guard-leaf and vendor-sdk-one-adapter rules and review cover those.
import { allowed, type Finding, isTestFile, PRODUCT_DIRS, scanFiles, sourceFiles, specifiersOn } from "./files.ts";

export const SCANNED_DIRS = PRODUCT_DIRS;
const RULE = "egress";
const EXEMPT_PREFIX = "infrastructure/net-guard/";

/** pds-admin calls the one internal origin PDS_INTERNAL_URL from this file only (P2.09, phase-2 E10). */
export const EGRESS_FILE_EXEMPTIONS: readonly string[] = ["interfaces/pds-admin/pds.mjs"];

// fetch( whose first argument is not a plain string literal on the same line (template literals count as dynamic).
// A method such as cache.fetch( is not the global; globalThis.fetch( and friends are.
const DYNAMIC_FETCH = /(?:(?<![.\w$])|\b(?:globalThis|window|self)\.)fetch\s*\(\s*(?!["'][^"'`]*["']\s*[,)])/;
// Raw network clients that bypass the guard entirely.
const RAW_CLIENT = /^(node:)?(https?|http2|net|tls|dgram)$|^(undici|axios|got|node-fetch|ws)(\/.*)?$/;
// WebSocket and EventSource are globals in Node 26.
const RAW_SOCKET = /\bnew\s+(WebSocket|EventSource)\s*\(/;

function exempt(file: string): boolean {
  return file.startsWith(EXEMPT_PREFIX) || isTestFile(file) || EGRESS_FILE_EXEMPTIONS.includes(file);
}

function flagged(text: string): boolean {
  return DYNAMIC_FETCH.test(text) || RAW_SOCKET.test(text) || specifiersOn(text).some((s) => RAW_CLIENT.test(s));
}

export function scanEgress(file: string, source: string): Finding[] {
  if (exempt(file)) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (flagged(text) && !allowed(text, RULE)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanEgress);
}
