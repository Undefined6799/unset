// Proves the CI `secrets` job's scan scope and its one public-key exception on planted fixtures (P0.07a; ruling
// 2026-10-06 secrets-scan-scope-and-public-keys). Runs in the `secrets` job, not in Vitest, because it needs the
// gitleaks CLI. Every secret-shaped value is built here at run time and written only to a temporary directory, so
// nothing secret-shaped is ever committed.
//
// Scope cases use a throwaway repository with a `main`, a pull request branch and an unrelated branch, and run the
// two scan forms ci.yml uses: `git --log-opts=<base>..<head>` (a pull request's own commits) and `git` alone (the
// full history of every ref; gitleaks v8.30.1 sources/git.go runs `git log -p -U0 --full-history --all` when
// --log-opts is empty). Content cases run `dir` over one file each.
//
//   node scripts/ci/secrets-fixtures.ts
//
// gitleaks comes from GITLEAKS_BIN (a local binary, version 8.30.1) or else the image in GITLEAKS_IMAGE (default:
// ci.yml's). Fails closed: any gitleaks status other than "clean" or "leaks found", or an unreadable report, fails.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { withoutGitEnv } from "../guards/git-env.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const CONFIG = join(ROOT, ".github/.gitleaks.toml");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** gitleaks' status when it finds leaks; any other non-zero status is an error, never a pass. */
const LEAKS = 3;

function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let s = "";
  while (n > 0n) {
    s = BASE58[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
}

/**
 * `length` bytes derived from `label`. Fixed, not random: gitleaks' generic-api-key rule skips a secret containing
 * one of its stop words, so a random value would make a must-fail case pass now and then.
 */
function bytes(label: string, length: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0; out.length < length; i++) out.push(...createHash("sha256").update(`${label}:${i}`).digest());
  return Uint8Array.from(out.slice(0, length));
}

const pick = (label: string, alphabet: string, length: number): string =>
  Array.from(bytes(label, length), (b) => alphabet[b % alphabet.length]).join("");

/** Multicodec prefix + key bytes in base58btc multibase. */
const multibase = (prefix: number[], key: Uint8Array): string => `z${base58(Uint8Array.from([...prefix, ...key]))}`;
/** A compressed public key: 02 or 03, then 32 bytes. */
const compressed = (label: string): Uint8Array => {
  const key = bytes(label, 33);
  key[0] = 2 + ((key[0] ?? 0) % 2);
  return key;
};

/** Test keys of each kind the exception must tell apart; `label` picks a fixed value. */
const k256Public = (label: string): string => multibase([0xe7, 0x01], compressed(label)); // secp256k1-pub → zQ3s…

export const keys = {
  k256Public,
  p256Public: (label: string) => multibase([0x80, 0x24], compressed(label)), // p256-pub → zDn…
  // A zQ3s… key one character too long or too short (an extra byte would change the zQ3s prefix itself).
  k256PublicLong: (label: string) => `${k256Public(label)}${pick(label, BASE58, 1)}`,
  k256PublicShort: (label: string) => k256Public(label).slice(0, -1),
  k256Private: (label: string) => multibase([0x81, 0x26], bytes(label, 32)), // secp256k1-priv → z3vL…
  p256Private: (label: string) => multibase([0x86, 0x26], bytes(label, 32)), // p256-priv → z42t…
  plc: (label: string) => `did:plc:${pick(label, BASE32, 24)}`,
  apiKey: (label: string) => pick(label, ALNUM, 40),
};

/** The sorted rule ids of the findings; an empty list is a clean scan. */
export type Findings = string[];
/** A scan's findings, or a reason it proved nothing. */
type Outcome = Findings | string;
export type Case = { name: string; expect: Findings; run: (work: string) => Outcome };

/** Assigns `value` to a key-named variable, the shape that trips the default generic-api-key rule. */
const assigned = (value: string, name = "signingKey"): string => `export const ${name} = "${value}";\n`;

function git(cwd: string, ...args: string[]): string {
  const env = { ...withoutGitEnv(), GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid" };
  Object.assign(env, { GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" });
  return execFileSync("git", ["-C", cwd, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(repo: string, file: string, text: string, message: string): string {
  writeFileSync(join(repo, file), text);
  git(repo, "add", file);
  git(repo, "commit", "-q", "--no-verify", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** gitleaks over `dir` with `args`: the rule id of each finding, or a reason it proved nothing. */
function gitleaks(dir: string, args: string[], config = CONFIG): Outcome {
  writeFileSync(join(dir, ".fixture-gitleaks.toml"), readFileSync(config));
  const common = ["--no-banner", "--redact", "--config", ".fixture-gitleaks.toml", "--exit-code", String(LEAKS)];
  const report = ["--report-format", "json", "--report-path", ".fixture-report.json"];
  const bin = process.env.GITLEAKS_BIN;
  const image =
    process.env.GITLEAKS_IMAGE || imageFromWorkflow(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8"));
  const [cmd, argv] = bin
    ? [bin, [...args, ...common, ...report]]
    : ["docker", ["run", "--rm", "-v", `${dir}:/repo`, "-w", "/repo", image ?? "", ...args, ...common, ...report]];
  if (!bin && !image) return "no GITLEAKS_BIN and no GITLEAKS_IMAGE in ci.yml";
  const scan = spawnSync(cmd, argv, { cwd: dir, encoding: "utf8", env: withoutGitEnv() });
  if (scan.status !== 0 && scan.status !== LEAKS) return `gitleaks exited ${scan.status ?? scan.error}: ${scan.stderr}`;
  let findings: unknown;
  try {
    findings = JSON.parse(readFileSync(join(dir, ".fixture-report.json"), "utf8"));
  } catch {
    return "no readable gitleaks report";
  }
  if (!Array.isArray(findings)) return "the gitleaks report is not a list";
  if (findings.length > 0 !== (scan.status === LEAKS)) return "gitleaks status and report disagree";
  return findings.map((f: { RuleID?: unknown }) => String(f.RuleID)).sort();
}

export const imageFromWorkflow = (ci: string): string | null =>
  ci.match(/^\s+GITLEAKS_IMAGE:\s*(\S+)\s*$/m)?.[1] ?? null;

/** A repository whose `main` is clean, with a pull request branch and an unrelated branch off it. */
function scopeRepo(work: string, prText: string, otherText: string): { base: string; head: string } {
  git(work, "init", "-q", "-b", "main");
  const base = commit(work, "README.md", "clean\n", "base");
  git(work, "checkout", "-q", "-b", "other");
  commit(work, "other.ts", otherText, "other branch");
  git(work, "checkout", "-q", "-b", "pr", base);
  const head = commit(work, "pr.ts", prText, "pull request");
  return { base, head };
}

const canary = (): string => `UNSET_CANARY_${pick("canary", ALNUM, 32)}`;
const prRange = (r: { base: string; head: string }): string[] => ["git", `--log-opts=${r.base}..${r.head}`, "."];

/** A `dir` scan of one file holding `text`. */
const content =
  (text: string, config?: string) =>
  (work: string): Outcome => {
    writeFileSync(join(work, "vectors.ts"), text);
    return gitleaks(work, ["dir", "."], config);
  };

/** The config without its [[allowlists]] block: proves the public vectors pass because of the exception. */
function configWithoutException(work: string): string {
  const toml = readFileSync(CONFIG, "utf8");
  const start = toml.indexOf("[[allowlists]]");
  if (start < 0) throw new Error(".github/.gitleaks.toml has no [[allowlists]] block");
  const path = join(work, "..", `${work.split("/").pop()}-no-exception.toml`);
  writeFileSync(path, toml.slice(0, start));
  return path;
}

const publicVectors = (): string =>
  [
    assigned(keys.k256Public("k256-a"), "k256Key"),
    assigned(`did:key:${keys.k256Public("k256-b")}`, "k256DidKey"),
    assigned(keys.p256Public("p256-a"), "p256Key"),
    assigned(`did:key:${keys.p256Public("p256-b")}`, "p256DidKey"),
    assigned(keys.plc("plc"), "plcToken"),
  ].join("");

export const CASES: Case[] = [
  {
    name: "pr_range_planted_secret_fails",
    expect: ["unset-canary"],
    run: (work) => gitleaks(work, prRange(scopeRepo(work, assigned(canary()), "clean\n"))),
  },
  {
    name: "other_branch_secret_not_pr_gate",
    expect: [],
    run: (work) => gitleaks(work, prRange(scopeRepo(work, "clean\n", assigned(canary())))),
  },
  {
    name: "main_full_history_finds_it",
    expect: ["unset-canary"],
    run: (work) => (scopeRepo(work, "clean\n", assigned(canary())), gitleaks(work, ["git", "."])),
  },
  { name: "public_did_key_vectors_pass", expect: [], run: (work) => content(publicVectors())(work) },
  {
    name: "public_vectors_fail_without_exception",
    expect: Array(4).fill("generic-api-key"),
    run: (work) => content(publicVectors(), configWithoutException(work))(work),
  },
  ...[keys.k256Private, keys.p256Private].flatMap((key, i) =>
    ["", "did:key:"].map(
      (prefix): Case => ({
        name: `private_multibase_still_fails ${i === 0 ? "z3vL" : "z42t"} ${prefix || "bare"}`,
        expect: ["multibase-private-key"],
        run: (work) => content(assigned(`${prefix}${key("private")}`))(work),
      }),
    ),
  ),
  {
    name: "api_key_beside_public_key_fails",
    expect: ["generic-api-key"],
    run: (work) =>
      content(`const pub = "did:key:${keys.k256Public("beside")}"; const apiKey = "${keys.apiKey("api")}";\n`)(work),
  },
  ...[keys.k256PublicLong, keys.k256PublicShort].map(
    (key, i): Case => ({
      name: `wrong_length_zq3s_fails ${i === 0 ? "long" : "short"}`,
      expect: ["generic-api-key"],
      run: (work) => content(assigned(key("wrong-length")))(work),
    }),
  ),
];

function main(): number {
  let failed = 0;
  for (const c of CASES) {
    const work = mkdtempSync(join(tmpdir(), "secrets-fixture-"));
    try {
      let got: Outcome;
      try {
        got = c.run(work);
      } catch (error) {
        got = `threw ${error instanceof Error ? error.message : String(error)}`;
      }
      const ok = typeof got !== "string" && got.join() === c.expect.join();
      if (!ok) failed++;
      const show = (f: Outcome): string => (typeof f === "string" ? f : `[${f.join(", ")}]`);
      console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: expected ${show(c.expect)}, got ${show(got)}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(`${work}-no-exception.toml`, { force: true });
    }
  }
  console.log(`secrets fixtures: ${CASES.length - failed}/${CASES.length} proven`);
  return failed === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main();
