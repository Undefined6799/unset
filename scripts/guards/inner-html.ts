// Guard: no raw HTML sink anywhere in product code, tests included (XSS; PLAN.md §2).
// Zero exemptions and no guard-allow: P2.20 renders profile markdown to React elements,
// so no file needs raw HTML. This is the single mechanism for raw HTML sinks.
import { type Finding, scanFiles, sourceFiles } from "./files.ts";

export const SCANNED_DIRS = ["apps", "interfaces", "domains", "infrastructure", "shared"] as const;
const RULE = "inner-html";

const SINKS = [
  /\bdangerouslySetInnerHTML\b/,
  /(\.|\[\s*["'`])(inner|outer)HTML(["'`]\s*\])?\s*([+|&?]{1,2})?=(?!=)/,
  /\binsertAdjacentHTML\s*\(/,
  /\bdocument\.write(ln)?\s*\(/,
  /\b(setHTMLUnsafe|parseHTMLUnsafe)\s*\(/, // The Sanitizer API's explicitly unsafe variants (Alex, 2026-10-04).
];

export function scanInnerHtml(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  source.split("\n").forEach((text, i) => {
    if (SINKS.some((sink) => sink.test(text))) findings.push({ file, line: i + 1, rule: RULE, text });
  });
  return findings;
}

export function scanAll(root: string): Finding[] {
  return scanFiles(root, sourceFiles(root, SCANNED_DIRS), RULE, scanInnerHtml);
}
