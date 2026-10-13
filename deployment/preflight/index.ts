// The deploy preflight (P1.30; plan section 2 rule 23, sections 5.2, 5.3, 6.1): before any `compose up` on a server,
// one command checks the stack against every rule that, if broken, would leak data or cannot be fixed later.
//
//   node deployment/preflight/index.ts -- --env dev|prod|local --compose <absolute file> [--compose <absolute file>...]
//     [--interpolation-env <absolute file>]
//
// The first --compose file's directory is the project directory: every relative path resolves from it. Interpolation
// reads the one --interpolation-env file (Compose's --env-file), or else the project directory's .env, as Compose
// does; the preflight refuses to run when its environment could change what Compose reads (P1.30a). The flag is not
// called --env-file because Node reads that flag anywhere before a literal `--`, even after the script name, and
// applies the file's NODE_OPTIONS before this code runs (Node v26.10.0 src/node_dotenv.cc:21-66,
// src/node.cc:982-1003; ruling 2026-10-12-preflight-compose-inputs, Amendment 3). The `--` before our arguments stops
// that scan too.
//
// Exit 0 when every check passes, 1 when one fails, 2 when the preflight cannot run (a bad argument, an unreadable or
// malformed compose or env file). There is no flag to skip a check. A check that throws fails; the network checks (C3
// to C5, and C24) give up after 30 s and fail. Output is one `PASS|FAIL <id> <reason>` line per check and never a
// secret value: env files are read into SecretMaps, Compose is parsed here, never through `docker compose config`, and
// a reason that holds any configured value is withheld whole.
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHECKS, LOCAL_CHECKS } from "./checks/index.ts";
import { type Check, type Inputs, MISSING, type Outcome, type Run } from "./checks/types.ts";
import { ParseError } from "./compose-parse.ts";
import { CannotRun, type Deps, type Loaded, loadInputs } from "./inputs.ts";
import type { ConfiguredValues } from "./secret-map.ts";

export { CLI_OPTIONS, type Deps, loadCompose } from "./inputs.ts";
export type { Run };

export type Result = { code: 0 | 1 | 2; lines: string[] };

const NETWORK_TIMEOUT_MS = 30_000;

/** One check, failing closed: a throw is a failure, and a network check that outlasts its timeout fails. */
async function runCheck(check: Check, loaded: Loaded, timeoutMs: number): Promise<Outcome> {
  return withheldIfValued(await settle(check, loaded.inputs, timeoutMs), loaded.configured);
}

const WITHHELD = "reason withheld (it contained a configured value)";

/**
 * `outcome`, or, when its reason holds any value the run read, the same verdict with the reason withheld whole
 * (P1.30m). Replacing a value with its name leaked across maps, against a check's fixed text and through the template,
 * so nothing is printed in part, and there is no flag to see the reason. A value inside the replacement text itself
 * leaves the reason empty.
 */
function withheldIfValued(outcome: Outcome, configured: ConfiguredValues): Outcome {
  if (!configured.occurIn(outcome.reason)) return outcome;
  const reason = outcome.reason.startsWith(MISSING) ? `${MISSING}${WITHHELD}` : WITHHELD;
  return { ...outcome, reason: configured.occurIn(reason) ? "" : reason };
}

/** The check's outcome, a timeout for a network check past its deadline, or a failure for a throw. */
async function settle(check: Check, inputs: Inputs, timeoutMs: number): Promise<Outcome> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<Outcome>((done) => {
    signal.addEventListener("abort", () => done({ pass: false, reason: "timed out" }), { once: true });
  });
  try {
    const outcome = Promise.resolve(check.run(inputs, signal));
    return await (check.network ? Promise.race([outcome, timedOut]) : outcome);
  } catch {
    return { pass: false, reason: "check error" };
  }
}

export async function preflight(argv: string[], deps: Deps): Promise<Result> {
  let loaded: Loaded;
  try {
    loaded = loadInputs(argv, deps);
  } catch (error) {
    if (error instanceof CannotRun || error instanceof ParseError)
      return { code: 2, lines: [`ERROR ${error.message}`] };
    return { code: 2, lines: ["ERROR the inputs could not be read"] };
  }
  const lines: string[] = [];
  let failed = false;
  const local = loaded.inputs.env === "local";
  for (const check of [...(deps.checks ?? CHECKS), ...(local ? LOCAL_CHECKS : [])]) {
    const outcome = await runCheck(check, loaded, deps.timeoutMs ?? NETWORK_TIMEOUT_MS);
    failed ||= !outcome.pass;
    lines.push(`${verdict(outcome)} ${check.id} ${outcome.reason}`);
  }
  // A local stack's last word, pass or fail (architecture record 2026-10-12-p129-local-build-preflight, item 2).
  if (local) lines.push(LOCAL_LAST_LINE);
  return { code: failed ? 1 : 0, lines };
}

/** A line's first word: UNSIGNED only ever marks a pass (types.ts `unsigned`), so it never hides a failure. */
const verdict = (outcome: Outcome): string => (outcome.unsigned ? "UNSIGNED" : outcome.pass ? "PASS" : "FAIL");

/** The line that ends every `--env local` run: its images are the checkout's own builds, never signed artifacts. */
export const LOCAL_LAST_LINE = "LOCAL unsigned, local-only stack: never deploy it";

/** Child processes with no shell and a bounded output; a spawn error reads as a failed run. */
const run: Run = (file, args, signal) =>
  new Promise((done) => {
    execFile(file, args, { signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      done({
        code: error === null ? 0 : 1,
        stdout,
        stderr: error !== null && stderr === "" ? "run failed" : stderr,
        ...(missing ? { missing } : {}),
      });
    });
  });

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { code, lines } = await preflight(process.argv.slice(2), { root, run });
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  process.exitCode = code;
}
