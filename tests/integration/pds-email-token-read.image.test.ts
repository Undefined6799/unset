// tests/support/pds-email-token-read.ts in the container it runs in (P1.29h): the locked Node base unbuilt, as uid 1000
// with no network, over the account database's folder mounted read-only, as compose.dev.yaml's `pds-token-reader`
// runs it. A writer in this process holds the WAL database open the way the running PDS does. Architecture asked for
// the stopped-PDS path as a test (2026-10-13, on the record 2026-10-13-p129h-local-token-reader): a read-only
// connection over a read-only mount cannot create the -shm file a cleanly closed WAL database lacks, so SQLite answers
// SQLITE_CANTOPEN and the reader prints only its fixed reason.
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, test } from "vitest";
import { docker, killBefore, withCleanup } from "../support/docker.ts";
import { READER_REASONS } from "../support/pds-email-token-read.ts";

type LockEntry = { ref: string; tag: string; digest: string };
const lock = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../deployment/images/bases.lock.json"), "utf8"),
) as Record<string, LockEntry>;
const NODE = `${lock.node?.ref}:${lock.node?.tag}@${lock.node?.digest}`;
const SCRIPT = join(import.meta.dirname, "../support/pds-email-token-read.ts");

const TEST_MS = 180_000;
const DID = `did:plc:${"a".repeat(24)}`;
const TOKEN = "ABCDE-23456";

// The container's uid 1000 reads what this process wrote, as the PDS's own uid would.
const dir = mkdtempSync(join(tmpdir(), "pds-token-reader-"));
const data = join(dir, "pds");
mkdirSync(data);
chmodSync(dir, 0o755);
chmodSync(data, 0o755);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A WAL account database with one pending confirm_email token, open for writing as the running PDS holds it. */
function runningPds(): DatabaseSync {
  const writer = new DatabaseSync(join(data, "account.sqlite"));
  writer.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS email_token (purpose varchar not null, did varchar not null, token varchar not null,
      "requestedAt" varchar not null, constraint email_token_pkey primary key (purpose, did));
    INSERT OR REPLACE INTO email_token VALUES ('confirm_email', '${DID}', '${TOKEN}', '2026-10-13T00:00:00.000Z');`);
  for (const file of ["account.sqlite", "account.sqlite-wal", "account.sqlite-shm"]) chmodSync(join(data, file), 0o644);
  return writer;
}

/**
 * The reader, run as compose.dev.yaml runs it, logging driver none included (Amendment 2, B1); given a `name`, the
 * container stays until the caller has inspected and removed it.
 */
function read(name = "") {
  return docker(
    [
      "run",
      ...(name === "" ? ["--rm"] : ["--name", name]),
      "--log-driver",
      "none",
      "--network",
      "none",
      "--user",
      "1000:1000",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "-v",
      `${dir}:/data:ro`,
      "-v",
      `${SCRIPT}:/reader/read.ts:ro`,
      NODE,
      "/reader/read.ts",
      DID,
    ],
    { timeoutMs: killBefore(TEST_MS / 2) },
  );
}

describe("pds-token-reader in its container", () => {
  test("email_token_reader_prints_only_the_token", { timeout: TEST_MS }, () => {
    const writer = runningPds();
    try {
      expect(read()).toEqual({ code: 0, out: TOKEN, err: "" });
    } finally {
      writer.close();
    }
  });

  test("email_token_reader_keeps_no_log", { timeout: TEST_MS }, () => {
    // Architecture record 2026-10-13-p129h-local-token-reader, Amendment 2, B1: with driver none the attached stdout
    // still carries the token, and Docker keeps no log file and serves no logs for the finished container.
    const name = `unset-test-${randomBytes(8).toString("hex")}`;
    const call = { timeoutMs: killBefore(TEST_MS / 4) };
    const writer = runningPds();
    try {
      withCleanup(
        () => {
          expect(read(name)).toEqual({ code: 0, out: TOKEN, err: "" });
          const config = docker(["inspect", "--format", "{{.HostConfig.LogConfig.Type}}|{{.LogPath}}", name], call);
          expect(config).toEqual({ code: 0, out: "none|\n", err: "" });
          const logs = docker(["logs", name], call);
          expect(logs.out).not.toContain(TOKEN);
          expect(logs.err).not.toContain(TOKEN);
        },
        () => void docker(["rm", "-f", name], call),
      );
    } finally {
      writer.close();
    }
  });

  test("email_token_reader_refuses_a_stopped_pds", { timeout: TEST_MS }, () => {
    runningPds().close();
    expect(read()).toEqual({ code: 1, out: "", err: `${READER_REASONS.cannotOpen}\n` });
  });
});
