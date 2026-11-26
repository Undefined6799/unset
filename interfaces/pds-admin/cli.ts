// pds-admin's operator commands (P2.09 Outputs), run on the host inside the container:
//   node cli.ts verify-log <file>   prints "ok" or the first seq whose chain does not hold (exit 1)
//   node cli.ts check-reserved      for each reserved label, whether <label>.<HANDLE_DOMAIN> resolves on our PDS
//                                   (exit 1 if any answer was neither a DID nor HandleNotFound)
import { existsSync, readFileSync } from "node:fs";
import { readLines } from "@unset/shared-admin-envelope";
import { verifyLog } from "./log.ts";
import { createPds, type PdsAnswer } from "./pds.ts";

type Reserved = { labels: string[] };

/**
 * One line per reserved label: `taken` when our PDS resolves it to a DID, `free` only on its `HandleNotFound` answer
 * (@atproto/pds 0.5.51 api/com/atproto/identity/resolveHandle.ts, for a handle in its own domains), and
 * `unknown (HTTP <status>)` for anything else, so a PDS that fails never reads as free.
 */
export async function checkReserved(pdsUrl: URL, handleDomain: string): Promise<string[]> {
  const { labels } = JSON.parse(readFileSync(new URL("./reserved-labels.json", import.meta.url), "utf8")) as Reserved;
  const pds = createPds(pdsUrl, "");
  const lines: string[] = [];
  for (const label of labels) {
    const handle = `${label}.${handleDomain}`;
    const answer = await pds.resolveHandle(handle);
    lines.push(`${handle} ${stateOf(answer)}`);
  }
  return lines;
}

function stateOf({ status, body }: PdsAnswer): string {
  const field = (key: string) => (typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined);
  if (status === 200 && typeof field("did") === "string") return "taken";
  if (status === 400 && field("error") === "HandleNotFound") return "free";
  return `unknown (HTTP ${status})`;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, file] = argv;
  if (command === "verify-log" && file !== undefined) {
    // A missing log is not an empty, valid one: an operator's wrong path must not read as "ok".
    if (!existsSync(file)) {
      process.stderr.write(`no log at ${file}\n`);
      return 1;
    }
    const bad = verifyLog(readLines(file));
    process.stdout.write(bad === null ? "ok\n" : `chain broken at seq ${bad}\n`);
    return bad === null ? 0 : 1;
  }
  const url = process.env.PDS_INTERNAL_URL;
  const domain = process.env.HANDLE_DOMAIN;
  if (command === "check-reserved" && url !== undefined && URL.canParse(url) && domain !== undefined) {
    const lines = await checkReserved(new URL(url), domain);
    for (const line of lines) process.stdout.write(`${line}\n`);
    return lines.some((line) => line.includes(" unknown ")) ? 1 : 0;
  }
  process.stderr.write("usage: cli.ts verify-log <file> | check-reserved (PDS_INTERNAL_URL, HANDLE_DOMAIN)\n");
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
