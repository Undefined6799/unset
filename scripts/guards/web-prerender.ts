// Guard: no page of the web process is prerendered, and no proof-only route exists (ADR 0056 decision 6). adapter-node
// serves a prerendered page before hooks.server.ts runs, so such a page would skip every per-route check. Lexical:
// any `prerender` export in a route file counts, whatever its value; there is no guard-allow.
import { type Finding, filesUnder, scanFiles } from "./files.ts";

const RULE = "web-prerender";
const ROUTES = "interfaces/web/src/routes/";
const ROUTE_FILE = /\.(?:ts|js|svelte)$/;
const PRERENDER_EXPORT = /\bexport\s+(?:const|let|var)\s+prerender\b/;
/** The proof's own routes (the proof bundle, ADR 0054 Context): an echo, a slow route, a proof/ folder. */
const PROOF_ROUTE = /^interfaces\/web\/src\/routes\/(?:echo|slow|proof)(?:\/|$)/;

export function scanWebPrerender(file: string, source: string): Finding[] {
  if (!file.startsWith(ROUTES) && file !== "interfaces/web/vite.config.ts") return [];
  const findings: Finding[] = [];
  if (PROOF_ROUTE.test(file)) findings.push({ file, line: 1, rule: RULE, text: "proof-only route" });
  source.split("\n").forEach((text, i) => {
    if (PRERENDER_EXPORT.test(text) || /\bprerender\s*:/.test(text))
      findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  const files = filesUnder(root, ["interfaces/web"], ROUTE_FILE).filter(
    (file) => file.startsWith(ROUTES) || file === "interfaces/web/vite.config.ts",
  );
  return scanFiles(root, files, RULE, scanWebPrerender);
}
