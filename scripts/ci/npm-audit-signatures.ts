// `npm audit signatures` with a bounded retry for one registry fault (P0.07p; threat "a flaky supply-chain gate
// teaches everyone to re-run it until it is green"). Three audit jobs failed on 2026-11-24 (03:27Z, 03:55Z,
// 06:25Z) because registry.npmjs.org answered /-/npm/v1/attestations/axe-core@4.14.0 with a success status and the
// body "OK" in place of the attestation document. npm 11.20.0 does not retry that: make-fetch-happen 15.0.6
// (lib/remote.js:87-113) retries network errors and 408, 420, 429 and 5xx only, and pacote 21.5.1
// (lib/registry.js:233-239) parses whatever a status below 400 carries, as pacote 22.0.1 still does.
//
// The retry runs the whole command again, so a pass is always one complete `npm audit signatures` run that exited 0
// by itself. It happens only when npm exited non-zero, printed no verdict (its stdout is empty) and reported exactly
// that parse failure for an attestation document of the public registry. A bad or missing signature, a failed
// attestation, any other error and any other address fail the job at once, as before.
//
// A retry uses an empty npm cache: the real document is served with `cache-control: public, max-age=31557600`, and
// with those headers make-fetch-happen replays a stored "OK" without asking the registry again (measured against a
// local server). The first attempt is the command exactly as it ran before this script.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * The wait before each retry; its length is the number of retries. The third attempt starts a little over two
 * minutes after the first: on 2026-11-24 the job that failed at 03:55:51Z was followed by one that passed at
 * 03:57:48Z. How long a bad spell can last is not known.
 */
export const PAUSES_MS: readonly number[] = [30_000, 90_000];

export type Attempt = { status: number | null; stdout: string; stderr: string };

const FETCH_ERROR = /^npm error code FETCH_ERROR$/m;
const ATTESTATION_NOT_JSON =
  /^npm error invalid json response body at https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/attestations\/\S+ reason: /m;

/** True only when npm verified nothing because the registry's attestation answer was not JSON. */
function attestationAnswerUnreadable(attempt: Attempt): boolean {
  if (attempt.status === 0 || attempt.status === null) return false;
  if (attempt.stdout.trim() !== "") return false;
  return FETCH_ERROR.test(attempt.stderr) && ATTESTATION_NOT_JSON.test(attempt.stderr);
}

/** The npm arguments of attempt `attempt` (from 1): `passed` as given, and from the second on an empty cache. */
export function npmArgs(attempt: number, passed: readonly string[], emptyCache: string): string[] {
  return ["audit", "signatures", ...passed, ...(attempt === 1 ? [] : [`--cache=${emptyCache}`])];
}

/** Runs the audit, again only after the one registry fault, and returns the exit code of the last run. */
export async function auditSignatures(
  run: (attempt: number) => Attempt,
  pause: (ms: number) => Promise<unknown>,
  note: (line: string) => void,
): Promise<number> {
  const attempts = PAUSES_MS.length + 1;
  for (let attempt = 1; ; attempt++) {
    const result = run(attempt);
    if (result.status === 0) return 0;
    const wait = PAUSES_MS[attempt - 1];
    if (wait === undefined || !attestationAnswerUnreadable(result)) return result.status ?? 1;
    note(
      `::warning title=npm audit signatures::the registry answered an attestation request with something that is ` +
        `not JSON, so nothing was verified; attempt ${attempt + 1} of ${attempts} in ${wait / 1000} s`,
    );
    await pause(wait);
  }
}

/**
 * What npm's debug log says about the request it could not parse: the status and whether the answer came from the
 * local cache (`http fetch GET 200 <address> 83ms (cache miss)`). The job log has neither, and the file is lost
 * with the runner.
 */
export function unparsedRequestLines(stderr: string, read: (path: string) => string): string[] {
  const address = /^npm error invalid json response body at (\S+) reason: /m.exec(stderr)?.[1];
  const log = /^npm error A complete log of this run can be found in: (.+)$/m.exec(stderr)?.[1];
  if (address === undefined || log === undefined) return [];
  try {
    return read(log)
      .split("\n")
      .filter((line) => line.includes(` http `) && line.includes(` ${address} `));
  } catch {
    return [`npm's debug log ${log} could not be read`];
  }
}

/** One real run: npm's own output goes to the job log unchanged. */
function runNpm(attempt: number, passed: readonly string[]): Attempt {
  const emptyCache = attempt === 1 ? "" : mkdtempSync(join(tmpdir(), "npm-audit-signatures-"));
  const root = join(import.meta.dirname, "..", "..");
  const args = npmArgs(attempt, passed, emptyCache);
  const { status, stdout, stderr, error } = spawnSync("npm", args, { cwd: root, encoding: "utf8", maxBuffer: 2 ** 26 });
  process.stdout.write(stdout ?? "");
  process.stderr.write(stderr ?? "");
  if (error !== undefined) console.error(`npm audit signatures: npm did not run: ${error.message}`);
  for (const line of unparsedRequestLines(stderr ?? "", (path) => readFileSync(path, "utf8")))
    console.error(`npm audit signatures: ${line}`);
  return { status: error === undefined ? status : null, stdout: stdout ?? "", stderr: stderr ?? "" };
}

if (import.meta.main) {
  const passed = process.argv.slice(2);
  process.exitCode = await auditSignatures((attempt) => runNpm(attempt, passed), sleep, console.log);
}
