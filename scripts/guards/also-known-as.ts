// Guard: only the identity files that may interpret a DID document's handle claim name `alsoKnownAs` (P2.01q; plan §2
// rule 1; architecture ruling 2026-10-06). A self-asserted `alsoKnownAs` must never be trusted as the handle: P2.01
// passes it on raw, verifyHandle (P2.02) is the only reader, and the OAuth client re-reads it inside its own adapter.
// Lexical on purpose, any case, so an identifier, a string key, a bracket access or a comment all count; reword a
// comment that is not one of these files. No guard-allow: the allowlist below is the only exception.
import { type Finding, PRODUCT_DIRS, scanFiles, sourceFiles } from "./files.ts";

export const SCANNED_DIRS = PRODUCT_DIRS;
const RULE = "also-known-as";
const NAME = /alsoknownas/i;

/** The files allowed to name it, each with its own test beside it. */
export const ALSO_KNOWN_AS_FILES: readonly string[] = [
  // P2.01: parses the document and passes the claim on raw, never interpreting it.
  "domains/identity/did-doc.ts",
  "domains/identity/did-doc.test.ts",
  "domains/identity/resolve-did.ts",
  "domains/identity/resolve-did.test.ts",
  // P2.02: the one reader, which checks the claimed handle resolves back to the DID.
  "domains/identity/verify-handle.ts",
  "domains/identity/verify-handle.test.ts",
  // P2.04: the OAuth client's resolvers hand it the raw document, and the library re-reads the claim itself (the
  // book's one accepted exception). Listed ahead of the file so that product PR never edits this check path.
  "infrastructure/pds/oauth/identity-resolvers.ts",
  "infrastructure/pds/oauth/identity-resolvers.test.ts",
];

export function scanAlsoKnownAs(file: string, source: string): Finding[] {
  if (ALSO_KNOWN_AS_FILES.includes(file)) return [];
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (NAME.test(text)) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

/** The files the guard reads; the repository test checks there are some, so an empty scan cannot pass. */
export const scannedFiles = (root: string): string[] => sourceFiles(root, SCANNED_DIRS);

export function scanAll(root: string): Finding[] {
  return scanFiles(root, scannedFiles(root), RULE, scanAlsoKnownAs);
}
