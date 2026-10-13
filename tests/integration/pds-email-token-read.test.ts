// tests/support/pds-email-token-read.ts (P1.29h): the script the local stack's `pds-token-reader` runs over the PDS's
// volume. Each case builds an account database in a temporary folder with the schema of @atproto/pds 0.5.37
// (dist/account-manager/db/migrations/001-init.js:85-95) and a token shaped as that release makes them
// (dist/api/com/atproto/server/util.js:20-23, upper-cased by dist/account-manager/helpers/email-token.js).
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, test } from "vitest";
import { openAccountDb, readConfirmToken } from "../support/pds-email-token-read.ts";

const dir = mkdtempSync(join(tmpdir(), "pds-email-token-read-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const DID = `did:plc:${"a".repeat(24)}`;
const OTHER = `did:plc:${"b".repeat(24)}`;
const TOKEN = "ABCDE-23456";
const PINNED_SCHEMA = `CREATE TABLE email_token (purpose varchar not null, did varchar not null, token varchar not null,
  "requestedAt" varchar not null, constraint email_token_pkey primary key (purpose, did),
  constraint email_token_purpose_token_unique unique (purpose, token))`;

let made = 0;
/** A WAL account database holding `rows` (purpose, did, token), still open for writing as the running PDS holds it. */
function accountDb(rows: [string, string, string][], schema = PINNED_SCHEMA): { path: string; writer: DatabaseSync } {
  const path = join(dir, `account-${made++}.sqlite`);
  const writer = new DatabaseSync(path);
  writer.exec(`PRAGMA journal_mode = WAL; ${schema}`);
  for (const row of rows) {
    writer.prepare(`INSERT INTO email_token VALUES (?, ?, ?, '2026-10-13T00:00:00.000Z')`).run(...row);
  }
  return { path, writer };
}

describe("tests/support/pds-email-token-read.ts", () => {
  test("email_token_reader_reads_one_accounts_confirm_token", () => {
    const { path, writer } = accountDb([
      ["confirm_email", DID, TOKEN],
      ["confirm_email", OTHER, "QQQQQ-RRRRR"],
      ["reset_password", DID, "ZZZZZ-YYYYY"],
    ]);
    expect(readConfirmToken(path, DID)).toBe(TOKEN);
    writer.close();
  });

  test("email_token_reader_fails_on_unknown_schema", () => {
    const widened = accountDb(
      [],
      PINNED_SCHEMA.replace('"requestedAt" varchar not null,', '"requestedAt" varchar not null, "expiresAt" varchar,'),
    );
    expect(() => readConfirmToken(widened.path, DID)).toThrow(
      new Error("email_token is not the schema of @atproto/pds 0.5.37"),
    );
    const missing = accountDb([], "CREATE TABLE other (x)");
    expect(() => readConfirmToken(missing.path, DID)).toThrow(
      new Error("email_token is not the schema of @atproto/pds 0.5.37"),
    );
    // A token in another shape means the release changed how it makes them.
    const shaped = accountDb([["confirm_email", DID, "abcde-23456"]]);
    expect(() => readConfirmToken(shaped.path, DID)).toThrow(
      new Error("the token is not in the shape of @atproto/pds 0.5.37"),
    );
    for (const db of [widened, missing, shaped]) db.writer.close();
  });

  test("email_token_reader_refuses_a_bad_did_or_a_missing_token", () => {
    const { path, writer } = accountDb([["confirm_email", DID, TOKEN]]);
    for (const did of ["", "did:plc", `${DID}'--`, `${DID} `, `x${DID}`, `did:${"a".repeat(2048)}:x`]) {
      expect(() => readConfirmToken(path, did), did).toThrow(new Error("the argument is not a DID"));
    }
    expect(() => readConfirmToken(path, OTHER)).toThrow(new Error("no confirm_email token for this account"));
    writer.close();
  });

  test("email_token_reader_read_only", () => {
    const { path, writer } = accountDb([["confirm_email", DID, TOKEN]]);
    const db = openAccountDb(path);
    expect(() => db.exec("DELETE FROM email_token")).toThrow(/attempt to write a readonly database/);
    db.close();
    expect(writer.prepare("SELECT count(*) AS n FROM email_token").get()).toEqual({ n: 1 });
    writer.close();
    // A file that is not there is never created: the reader names the stopped PDS instead.
    const absent = join(dir, "absent.sqlite");
    expect(() => openAccountDb(absent)).toThrow(
      new Error("cannot open the PDS account database read-only: the local PDS must be running"),
    );
    expect(existsSync(absent)).toBe(false);
  });
});
