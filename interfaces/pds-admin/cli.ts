// pds-admin's operator commands (P2.09 Outputs), run on the host inside the container:
//   node cli.ts verify-log <file>   prints "ok" or the first seq whose chain does not hold (exit 1)
//   node cli.ts check-reserved      for each reserved label, whether <label>.<HANDLE_DOMAIN> resolves on our PDS
import { readFileSync } from "node:fs";
import { verifyLog } from "./log.ts";
import { createPds } from "./pds.ts";
import { readLines } from "./state-file.ts";

type Reserved = { labels: string[] };

/** One line per reserved label: `<handle> taken` when it resolves on our PDS, `<handle> free` otherwise. */
export async function checkReserved(pdsUrl: URL, handleDomain: string): Promise<string[]> {
  const { labels } = JSON.parse(readFileSync(new URL("./reserved-labels.json", import.meta.url), "utf8")) as Reserved;
  const pds = createPds(pdsUrl, "");
  const lines: string[] = [];
  for (const label of labels) {
    const handle = `${label}.${handleDomain}`;
    const answer = await pds.resolveHandle(handle);
    lines.push(`${handle} ${answer.status === 200 ? "taken" : "free"}`);
  }
  return lines;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, file] = argv;
  if (command === "verify-log" && file !== undefined) {
    const bad = verifyLog(readLines(file));
    process.stdout.write(bad === null ? "ok\n" : `chain broken at seq ${bad}\n`);
    return bad === null ? 0 : 1;
  }
  const url = process.env.PDS_INTERNAL_URL;
  const domain = process.env.HANDLE_DOMAIN;
  if (command === "check-reserved" && url !== undefined && URL.canParse(url) && domain !== undefined) {
    for (const line of await checkReserved(new URL(url), domain)) process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write("usage: cli.ts verify-log <file> | check-reserved (PDS_INTERNAL_URL, HANDLE_DOMAIN)\n");
  return 2;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
