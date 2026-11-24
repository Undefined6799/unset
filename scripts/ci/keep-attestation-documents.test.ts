import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ATTESTATION_KEYS, keepOnly } from "./keep-attestation-documents.ts";

const run = promisify(execFile);
const PACKUMENT = JSON.stringify({
  name: "pkg",
  "dist-tags": { latest: "1.0.0" },
  versions: { "1.0.0": { name: "pkg", version: "1.0.0", dist: { tarball: "http://127.0.0.1:9/pkg-1.0.0.tgz" } } },
});

// A stand-in registry on this machine. It serves one document under /keep/ and one under /drop/, both with the
// one-year lifetime registry.npmjs.org gives an attestation document, and counts how often each is asked for.
const asked: Record<string, number> = {};
const server = createServer((request, response) => {
  const path = request.url ?? "";
  asked[path] = (asked[path] ?? 0) + 1;
  response.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=31557600" });
  response.end(PACKUMENT);
});
let base = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

// Without it npm also asks the registry for its own newest version, once a day.
const QUIET = "--update-notifier=false";
const work = mkdtempSync(join(tmpdir(), "keep-attestation-documents-"));
/** The real npm, outside this repository's .npmrc, reading `pkg` from the stand-in registry into `cache`. */
async function npmView(cache: string, folder: string, ...more: string[]): Promise<{ ok: boolean; text: string }> {
  const args = ["view", "pkg", "version", `--registry=${base}/${folder}/`, `--cache=${cache}`, QUIET, ...more];
  const env = { PATH: process.env.PATH ?? "", HOME: work, npm_config_userconfig: join(work, "npmrc") };
  try {
    const { stdout } = await run("npm", args, { cwd: work, env });
    return { ok: true, text: stdout.trim() };
  } catch (error) {
    return { ok: false, text: String((error as { stderr?: unknown }).stderr) };
  }
}

describe("attestation store for the signature audit (P0.07p)", () => {
  test("attestation_store_keeps_exactly_the_public_registrys_attestation_documents", () => {
    expect(ATTESTATION_KEYS).toBe("make-fetch-happen:request-cache:https://registry.npmjs.org/-/npm/v1/attestations/");
  });

  test("attestation_store_replays_kept_documents_and_asks_again_for_everything_else", async () => {
    const cache = join(work, "replay");
    expect(await npmView(cache, "keep")).toEqual({ ok: true, text: "1.0.0" });
    expect(await npmView(cache, "drop")).toEqual({ ok: true, text: "1.0.0" });
    expect(asked).toEqual({ "/keep/pkg": 1, "/drop/pkg": 1 });

    expect(keepOnly(cache, `make-fetch-happen:request-cache:${base}/keep/`)).toEqual({ kept: 1, dropped: 1 });

    // The kept document is still in the store: npm reads it with the network off. (`npm view` is the stand-in for
    // the audit's fetch, and online it always asks again, so only the offline read shows the store.)
    expect(await npmView(cache, "keep", "--offline")).toEqual({ ok: true, text: "1.0.0" });
    expect(asked["/keep/pkg"]).toBe(1);
    // The dropped one is gone for npm, not stale: offline it is an error, online the registry is asked again.
    const offline = await npmView(cache, "drop", "--offline");
    expect(offline.ok).toBe(false);
    expect(offline.text).toContain("ENOTCACHED");
    expect(await npmView(cache, "drop")).toEqual({ ok: true, text: "1.0.0" });
    expect(asked["/drop/pkg"]).toBe(2);
  });

  test("attestation_store_drops_whatever_it_cannot_read_as_a_kept_document", async () => {
    const cache = join(work, "unreadable");
    expect(await npmView(cache, "keep")).toMatchObject({ ok: true });
    const store = join(cache, "_cacache");
    const index = join(store, "index-v5");
    const [real] = readdirSync(index, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    const kept = readFileSync(join(real?.parentPath ?? "", real?.name ?? ""), "utf8");
    // Beside the kept document's own entry: a line that is not an index entry, an entry without a key, a file with
    // no entry at all, a link, and a folder npm's store does not have.
    mkdirSync(join(index, "zz"), { recursive: true });
    writeFileSync(join(index, "zz", "empty"), "\n");
    writeFileSync(join(index, "zz", "not-an-entry"), `${kept}\nabc\tnot json`);
    writeFileSync(join(index, "zz", "no-key"), `${kept}\nabc\t${JSON.stringify({ integrity: "sha512-x", time: 1 })}`);
    symlinkSync(join(index, "zz", "no-key"), join(index, "zz", "link"));
    mkdirSync(join(store, "index-v6"));
    writeFileSync(join(store, "index-v6", "entry"), "x");

    expect(keepOnly(cache, `make-fetch-happen:request-cache:${base}/keep/`)).toEqual({ kept: 1, dropped: 4 });
    expect(existsSync(join(store, "index-v6"))).toBe(false);
    expect(readdirSync(join(index, "zz"))).toEqual([]);
    expect(await npmView(cache, "keep", "--offline")).toEqual({ ok: true, text: "1.0.0" });
  });

  test("attestation_store_that_does_not_exist_yet_is_left_alone", () => {
    const cache = join(work, "first-run");
    expect(keepOnly(cache, ATTESTATION_KEYS)).toEqual({ kept: 0, dropped: 0 });
    expect(existsSync(cache)).toBe(false);
  });
});
