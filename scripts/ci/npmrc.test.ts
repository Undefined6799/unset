// P0.05d: the root .npmrc is pinned, because npm ci reads it before any check runs (ruling 2026-10-07
// npmrc-pin-and-uses-ref). A changed or added setting (ignore-scripts off, another registry, a token) is a visible
// check-path diff that edits this test.
// npm 11 (docs.npmjs.com, "npmrc" and "config"): one `key=value` per line, `#` and `;` start comments, `${VAR}` is
// replaced from the environment, and registry credentials are written as `//host/:_authToken=…`.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const NPMRC = readFileSync(join(ROOT, ".npmrc"), "utf8");

/** The root .npmrc's settings, exactly as on main (P0-A5, plan §6.1). */
const PINNED: Record<string, string> = {
  "engine-strict": "true",
  "save-exact": "true",
  fund: "false",
  "audit-level": "high",
  "min-release-age": "7",
  "ignore-scripts": "true",
  "@unset:registry": "https://127.0.0.1:9/",
};

/** One setting line: its key, value, and what is wrong with the line itself. */
function lineProblems(line: string, where: string): { key: string; value: string; problems: string[] } {
  const eq = line.indexOf("=");
  const key = (eq === -1 ? line : line.slice(0, eq)).trim();
  const value = eq === -1 ? "" : line.slice(eq + 1).trim();
  const problems: string[] = [];
  // A credential is keyed by `//host/`, so `//` is refused in keys; the one pinned value that contains it (the
  // @unset registry URL) is matched exactly by npmrcProblems.
  if (key.includes("//")) problems.push(`${where}: a registry-scoped key`);
  if (/_auth/i.test(line)) problems.push(`${where}: a credential`);
  if (line.includes("${")) problems.push(`${where}: an environment interpolation`);
  return { key, value, problems };
}

/** What keeps .npmrc from holding exactly the pinned settings, one line each; none means it does. */
function npmrcProblems(text: string): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const { key, value, problems: own } = lineProblems(line, `line ${i + 1}`);
    problems.push(...own);
    if (seen.has(key)) problems.push(`line ${i + 1}: ${key} set twice`);
    seen.set(key, value);
  }
  for (const key of seen.keys()) if (!(key in PINNED)) problems.push(`unknown setting ${key}`);
  for (const [key, value] of Object.entries(PINNED)) {
    if (!seen.has(key)) problems.push(`missing ${key}=${value}`);
    else if (seen.get(key) !== value) problems.push(`${key} is ${seen.get(key)}, pinned ${value}`);
  }
  return problems;
}

/** Every tracked .npmrc outside node_modules. */
const npmrcFiles = (files: string[]): string[] =>
  files.filter((file) => /(^|\/)\.npmrc$/.test(file) && !file.split("/").includes("node_modules"));

describe(".npmrc", () => {
  test("npmrc_is_pinned", () => {
    expect(npmrcProblems(NPMRC)).toEqual([]);
    const without = (key: string) => NPMRC.replace(new RegExp(`^${key}=.*\\n`, "m"), "");
    expect(npmrcProblems(without("ignore-scripts"))).toEqual(["missing ignore-scripts=true"]);
    expect(npmrcProblems(NPMRC.replace("ignore-scripts=true", "ignore-scripts=false"))).toEqual([
      "ignore-scripts is false, pinned true",
    ]);
    expect(npmrcProblems(`${NPMRC}registry=https://registry.example/\n`)).toEqual(["unknown setting registry"]);
    expect(npmrcProblems(`${NPMRC}fund=false\n`)).toEqual([`line ${NPMRC.split("\n").length}: fund set twice`]);
    const token = `${NPMRC}//registry.example/:_authToken=x\n`;
    const at = `line ${NPMRC.split("\n").length}`;
    expect(npmrcProblems(token)).toEqual([
      `${at}: a registry-scoped key`,
      `${at}: a credential`,
      "unknown setting //registry.example/:_authToken",
    ]);
    // `_auth` and `_authToken` are refused anywhere on a line, in a key or a value.
    const last = `line ${NPMRC.split("\n").length}`;
    expect(npmrcProblems(`${NPMRC}_auth=x\n`)).toEqual([`${last}: a credential`, "unknown setting _auth"]);
    expect(npmrcProblems(`${NPMRC}_authToken=x\n`)).toEqual([`${last}: a credential`, "unknown setting _authToken"]);
    const valueAt = `line ${NPMRC.split("\n").findIndex((l) => l.startsWith("fund")) + 1}`;
    expect(npmrcProblems(NPMRC.replace("fund=false", "fund=_auth"))).toEqual([
      `${valueAt}: a credential`,
      "fund is _auth, pinned false",
    ]);
    expect(npmrcProblems(NPMRC.replace("fund=false", "fund=x_authToken"))).toEqual([
      `${valueAt}: a credential`,
      "fund is x_authToken, pinned false",
    ]);
    const interpolated = ["$", "{AGE}"].join("");
    expect(npmrcProblems(NPMRC.replace("min-release-age=7", `min-release-age=${interpolated}`))).toEqual([
      `line ${NPMRC.split("\n").findIndex((l) => l.startsWith("min-release-age")) + 1}: an environment interpolation`,
      `min-release-age is ${interpolated}, pinned 7`,
    ]);
    expect(npmrcProblems(NPMRC.replace("https://127.0.0.1:9/", "https://registry.npmjs.org/"))).toEqual([
      "@unset:registry is https://registry.npmjs.org/, pinned https://127.0.0.1:9/",
    ]);
  });

  // Only the root .npmrc is pinned, so no other may exist to be read in its place.
  test("no_nested_npmrc", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0");
    expect(npmrcFiles(files)).toEqual([".npmrc"]);
    const planted = [".npmrc", "apps/web/.npmrc", "node_modules/pkg/.npmrc", "docs/npmrc.md"];
    expect(npmrcFiles(planted)).toEqual([".npmrc", "apps/web/.npmrc"]);
  });
});
