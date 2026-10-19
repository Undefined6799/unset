// P1.29h: reads one account's pending confirm_email token from the local PDS's account database, so slice 1's email
// gate runs the PDS's real requestEmailConfirmation and confirmEmail and simulates only the inbox. The local stack's
// `pds-token-reader` service runs this file alone (docker-node's entrypoint prepends `node` to a script path), as uid
// 1000 with no network, over the PDS volume mounted read-only (architecture record
// 2026-10-13-p129h-local-token-reader). It imports Node built-ins only, since nothing else is mounted beside it.
//
// It prints the token and nothing else, with no newline, and exits 1 with a fixed reason otherwise: the token never
// reaches stderr, a log or a file (SE-7). tests/support/pds-email-token.ts pipes the output into confirmEmail.
//
// The schema is @atproto/pds 0.5.37's (dist/account-manager/db/migrations/001-init.js:85-95); the database is
// `account.sqlite` under PDS_DATA_DIRECTORY (dist/config/config.js:37), here /data. The PDS keeps it in WAL mode
// (dist/db/db.js:32-33, ensureWal), and a read-only connection over a read-only mount opens only while the PDS
// holds it open: a stopped PDS leaves no -shm file, and SQLite then answers SQLITE_CANTOPEN (14), measured on the node
// lock base. Never `immutable=1`, which could read stale pages while the PDS writes (the record, point 2).
import { DatabaseSync } from "node:sqlite";

const PINNED = "@atproto/pds 0.5.37";
const ACCOUNT_DB = "/data/account.sqlite";
const COLUMNS = ["purpose", "did", "token", "requestedAt"];
// DID syntax, at most 2 KiB (atproto.com/specs/did, "DID Syntax"); the value is still bound as a parameter.
const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const DID_MAX = 2048;
// Five and five base32 characters, upper-cased (dist/api/com/atproto/server/util.js:20-23 and
// dist/account-manager/helpers/email-token.js, createEmailToken).
const TOKEN = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;

/** Every reason the reader prints, fixed text holding no value read or passed in. */
export const READER_REASONS = {
  usage: "usage: read.ts <did>",
  notDid: "the argument is not a DID",
  cannotOpen: "cannot open the PDS account database read-only: the local PDS must be running",
  notDatabase: "the PDS account database is not a SQLite database",
  unreadable: "the PDS account database could not be read",
  schema: `email_token is not the schema of ${PINNED}`,
  noToken: "no confirm_email token for this account",
  shape: `the token is not in the shape of ${PINNED}`,
} as const;

/** A refusal whose message is one of READER_REASONS, safe to print. */
export class ReaderRefusal extends Error {}

/** SQLite's primary result codes the open step names apart (sqlite.org/rescode.html); any other is `unreadable`. */
const OPEN_REASONS: Record<number, string> = { 14: READER_REASONS.cannotOpen, 26: READER_REASONS.notDatabase };

/** The account database, opened read-only; a missing file or a stopped PDS is refused, never created. */
export function openAccountDb(path: string): DatabaseSync {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    // SQLite opens the WAL index lazily, so a stopped PDS shows only at the first read (measured in
    // pds-email-token-read.image.test.ts): read the schema here so it is refused with the reason, not as a failure.
    db.prepare("SELECT count(*) FROM sqlite_schema").get();
    return db;
  } catch (error) {
    db?.close();
    // node:sqlite puts the extended result code in `errcode`; its low byte is the primary code.
    const code = ((error as { errcode?: unknown }).errcode as number | undefined) ?? -1;
    throw new ReaderRefusal(OPEN_REASONS[code & 0xff] ?? READER_REASONS.unreadable);
  }
}

/** The pending confirm_email token of the account `did`, read with one parameterised SELECT. */
export function readConfirmToken(path: string, did: string): string {
  if (did.length > DID_MAX || !DID.test(did)) throw new ReaderRefusal(READER_REASONS.notDid);
  const db = openAccountDb(path);
  try {
    const columns = db
      .prepare("SELECT name FROM pragma_table_info('email_token') ORDER BY cid")
      .all()
      .map((row) => row.name);
    if (columns.join() !== COLUMNS.join()) throw new ReaderRefusal(READER_REASONS.schema);
    const row = db.prepare("SELECT token FROM email_token WHERE purpose = 'confirm_email' AND did = ?").get(did);
    if (row === undefined) throw new ReaderRefusal(READER_REASONS.noToken);
    if (typeof row.token !== "string" || !TOKEN.test(row.token)) {
      throw new ReaderRefusal(READER_REASONS.shape);
    }
    return row.token;
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  try {
    const [did, ...rest] = process.argv.slice(2);
    if (did === undefined || rest.length > 0) throw new ReaderRefusal(READER_REASONS.usage);
    process.stdout.write(readConfirmToken(ACCOUNT_DB, did));
  } catch (error) {
    // Only a fixed reason is printed; anything else may carry a value read from the database.
    process.stderr.write(`${error instanceof ReaderRefusal ? error.message : "the reader failed"}\n`);
    process.exitCode = 1;
  }
}
