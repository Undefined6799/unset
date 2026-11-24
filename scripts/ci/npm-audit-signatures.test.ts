import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "vitest";
import { type Attempt, auditSignatures, npmArgs, PAUSES_MS, unparsedRequestLines } from "./npm-audit-signatures.ts";

const OVERRIDE = "--@unset:registry=https://registry.npmjs.org/";
const PASS: Attempt = { status: 0, stdout: "535 packages have verified registry signatures\n", stderr: "" };
// npm's own lines from the audit job that failed on 2026-11-24 06:25Z (run 45340195607): the body was "OK\n".
const NOT_JSON_AT = "npm error code FETCH_ERROR\nnpm error errno FETCH_ERROR\nnpm error invalid json response body at ";
const NOT_JSON_REASON = " reason: Unexpected token 'O', \"OK\nnpm error \" is not valid JSON\n";
const notJson = (url: string): Attempt => ({ status: 1, stdout: "", stderr: `${NOT_JSON_AT}${url}${NOT_JSON_REASON}` });
const ADDRESS = "https://registry.npmjs.org/-/npm/v1/attestations/axe-core@4.14.0";
const UNREADABLE = notJson(ADDRESS);
// The verdict npm 11.20.0 prints for a bad signature (lib/utils/verify-signatures.js:123-151): stdout, exit 1.
const INVALID: Attempt = {
  status: 1,
  stdout:
    "1 package has an invalid registry signature:\n\naxe-core@4.14.0 (https://registry.npmjs.org/)\n\n" +
    "Someone might have tampered with this package since it was published on the registry!\n",
  stderr: "",
};

/** Plays `attempts` in order and records what the gate asked for. */
async function play(attempts: Attempt[]) {
  const runs: number[] = [];
  const pauses: number[] = [];
  const notes: string[] = [];
  const code = await auditSignatures(
    (attempt) => {
      runs.push(attempt);
      return attempts[attempt - 1] as Attempt;
    },
    async (ms) => void pauses.push(ms),
    (line) => notes.push(line),
  );
  return { code, runs, pauses, notes };
}

describe("npm audit signatures retry (P0.07p)", () => {
  test("signature_audit_passes_first_time_without_a_retry", async () => {
    expect(await play([PASS])).toEqual({ code: 0, runs: [1], pauses: [], notes: [] });
  });

  test("signature_audit_retries_an_unreadable_attestation_answer", async () => {
    const once = await play([UNREADABLE, PASS]);
    expect(once).toMatchObject({ code: 0, runs: [1, 2], pauses: [PAUSES_MS[0]] });
    expect(once.notes).toEqual([expect.stringMatching(/^::warning title=npm audit signatures::.*attempt 2 of 3/)]);
    expect(await play([UNREADABLE, UNREADABLE, PASS])).toMatchObject({ code: 0, runs: [1, 2, 3], pauses: PAUSES_MS });
  });

  test("signature_audit_stays_red_when_the_answer_never_becomes_readable", async () => {
    const stuck = await play([UNREADABLE, UNREADABLE, UNREADABLE, PASS]);
    expect(stuck).toMatchObject({ code: 1, runs: [1, 2, 3], pauses: PAUSES_MS });
  });

  test("signature_audit_never_retries_a_verdict_or_another_error", async () => {
    const elsewhere = [
      INVALID,
      { ...INVALID, stdout: INVALID.stdout.replace("an invalid", "a missing") },
      // A verdict printed beside the fetch error is still a verdict.
      { ...UNREADABLE, stdout: INVALID.stdout },
      {
        status: 1,
        stdout: "",
        stderr: "npm error code EINTEGRITYSIGNATURE\nnpm error axe-core@4.14.0 has an invalid registry signature\n",
      },
      { status: 1, stdout: "", stderr: "npm error code ECONNRESET\nnpm error network aborted\n" },
      {
        status: 1,
        stdout: "",
        stderr: `npm error code E503\nnpm error 503 Service Unavailable - GET ${ADDRESS}\n`,
      },
      // The same parse failure anywhere but the public registry's attestation documents.
      notJson("https://registry.npmjs.org/axe-core"),
      notJson("https://registry.npmjs.org/-/npm/v1/keys"),
      notJson("https://registry.npmjs.org.example/-/npm/v1/attestations/axe-core@4.14.0"),
      notJson("https://example.com/?next=https://registry.npmjs.org/-/npm/v1/attestations/axe-core@4.14.0"),
      // The parse failure without npm's FETCH_ERROR code, and npm killed by a signal.
      { ...UNREADABLE, stderr: UNREADABLE.stderr.replace("npm error code FETCH_ERROR\n", "") },
      { ...UNREADABLE, status: null },
      { status: null, stdout: "", stderr: "" },
    ];
    for (const failure of elsewhere) {
      const result = await play([failure, PASS]);
      expect(result, JSON.stringify(failure)).toMatchObject({ runs: [1], pauses: [] });
      expect(result.code, JSON.stringify(failure)).not.toBe(0);
    }
  });

  test("signature_audit_reports_the_verdict_of_the_retry", async () => {
    expect(await play([UNREADABLE, INVALID, PASS])).toMatchObject({ code: 1, runs: [1, 2], pauses: [PAUSES_MS[0]] });
    expect(await play([UNREADABLE, { status: 7, stdout: "", stderr: "" }])).toMatchObject({ code: 7, runs: [1, 2] });
  });

  test("signature_audit_retries_with_an_empty_npm_cache", () => {
    expect(npmArgs(1, [OVERRIDE], "/tmp/empty")).toEqual(["audit", "signatures", OVERRIDE]);
    expect(npmArgs(2, [OVERRIDE], "/tmp/empty")).toEqual(["audit", "signatures", OVERRIDE, "--cache=/tmp/empty"]);
  });

  test("signature_audit_shows_how_npm_logged_the_unparsed_request", () => {
    const stderr = `${UNREADABLE.stderr}npm error A complete log of this run can be found in: /logs/debug-0.log\n`;
    const log = [
      "12 http fetch GET 200 https://registry.npmjs.org/axe-core 227ms (cache miss)",
      `13 http fetch GET 200 ${ADDRESS} 83ms (cache miss)`,
      `14 verbose stack FetchError: invalid json response body at ${ADDRESS} reason: Unexpected token`,
    ].join("\n");
    const read = (path: string) => (path === "/logs/debug-0.log" ? log : "");
    expect(unparsedRequestLines(stderr, read)).toEqual([`13 http fetch GET 200 ${ADDRESS} 83ms (cache miss)`]);
    expect(unparsedRequestLines(UNREADABLE.stderr, read)).toEqual([]);
    expect(unparsedRequestLines(INVALID.stderr, read)).toEqual([]);
    const gone = unparsedRequestLines(stderr, () => {
      throw new Error("ENOENT");
    });
    expect(gone).toEqual(["npm's debug log /logs/debug-0.log could not be read"]);
  });

  // The real script with a stand-in for npm first on PATH: no registry is asked, and neither run waits.
  test("signature_audit_script_hands_npm_its_arguments_and_keeps_its_exit_code", () => {
    const bin = mkdtempSync(join(tmpdir(), "stand-in-npm-"));
    writeFileSync(join(bin, "npm"), '#!/bin/sh\necho "npm $*"\nexit "$STAND_IN_EXIT"\n', { mode: 0o755 });
    const script = join(import.meta.dirname, "npm-audit-signatures.ts");
    const run = (exit: string) =>
      spawnSync(process.execPath, [script, OVERRIDE], {
        encoding: "utf8",
        env: { PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, STAND_IN_EXIT: exit },
      });
    expect(run("0")).toMatchObject({ status: 0, stdout: `npm audit signatures ${OVERRIDE}\n`, stderr: "" });
    expect(run("1")).toMatchObject({ status: 1, stdout: `npm audit signatures ${OVERRIDE}\n`, stderr: "" });
  });
});
