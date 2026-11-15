// P1.15f: audit retention and erasure (migrations 0017 and 0018) against real Postgres, connected as real roles
// (TE-2): auditor verifies; audit_owner, through a verifier login's SET ROLE, is today's only caller of the functions
// (P3.07g and P3.22 grant them to their callers); retention, web and auditor are refused.
//
// Time is moved by writing rows with past timestamps as the superuser, behind the triggers, chained with the
// database's own audit.row_hash, so the chain is valid and only the age is made up. Like chain.test.ts it runs on its
// own container: it needs auditor and a superuser. The tests run in order on one database.
import { join } from "node:path";
import { chainStart, verifyChain, verifySegments } from "@unset/infrastructure-audit";
import { type Pool, type PoolClient, withClient } from "@unset/infrastructure-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
  testPools,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const ROLES = ["retention", "auditor", "web"] as const;
type Role = (typeof ROLES)[number];
const migratorPassword = randomPassword();
const passwords = Object.fromEntries(ROLES.map((role) => [role, randomPassword()])) as Record<Role, string>;
const pools = testPools("audit-retention-test");
let postgres: PostgresContainer;
let as: Record<Role, Pool>;

const X = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const Y = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const OLD = "3 years";
const MID = "14 months";
const monthId = (age: string) => `to_char(now() - interval '${age}', 'YYYYMM')::int`;
const monthOf = (age: string) => `date_trunc('month', now() - interval '${age}')::date`;

const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const quoted = (did: string | null) => (did === null ? "NULL" : `'${did}'`);

/** One event `age` ago, written as append would (steps 5 to 7 of audit.append) but with a past time. Oldest first. */
function past(lane: "sec" | "mod", action: string, age: string, subject: string | null, actor: string | null): void {
  postgres.sql(
    "unset",
    `BEGIN; SET LOCAL session_replication_role = replica;
     WITH v AS (
       SELECT coalesce(max(c.seq), 0) + 1 AS seq,
              coalesce((SELECT l.row_hash FROM audit.chain l WHERE l.lane = '${lane}' ORDER BY l.seq DESC LIMIT 1),
                       decode(repeat('00', 32), 'hex')) AS prev,
              date_trunc('microseconds', now() - interval '${age}') AS ts,
              public.gen_random_bytes(32) AS k, '{"made":"up"}'::text AS body
         FROM audit.chain c WHERE c.lane = '${lane}'
     ), c AS (
       INSERT INTO audit.chain (lane, seq, ts, action, writer, retention_class, body_mac, prev_hash, row_hash)
       SELECT '${lane}', v.seq, v.ts, x.action, 'web', x.retention_class,
              public.hmac(convert_to(v.body, 'UTF8'), v.k, 'sha256'), v.prev,
              audit.row_hash('${lane}', v.seq, v.ts, x.action, 'web'::name, x.retention_class, v.prev,
                             public.hmac(convert_to(v.body, 'UTF8'), v.k, 'sha256'))
         FROM v, audit.actions x WHERE x.action = '${action}'
       RETURNING seq
     )
     INSERT INTO audit.event_body (lane, seq, subject, actor, k_body, body_text)
     SELECT '${lane}', c.seq, ${quoted(subject)}, ${quoted(actor)}, v.k, v.body FROM v, c;
     COMMIT;`,
  );
}

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  for (const role of ROLES) postgres.sql("postgres", `ALTER ROLE ${role} PASSWORD '${passwords[role]}'`);
  as = Object.fromEntries(ROLES.map((role) => [role, pools.open(postgres, "unset", role, passwords[role])])) as Record<
    Role,
    Pool
  >;
  // sec: 1 about Y and 2 about X three years ago, 3 by X about Y fourteen months ago; nothing newer.
  past("sec", "age_gate.blocked", OLD, Y, Y);
  past("sec", "age_gate.blocked", OLD, X, X);
  past("sec", "report.submitted", MID, Y, X);
  // mod: 1 a takedown of X three years ago, 2 a decision on X fourteen months ago, 3 a takedown of X yesterday.
  past("mod", "mod.takedown", OLD, X, Y);
  past("mod", "mod.decision", MID, X, Y);
  past("mod", "mod.takedown", "1 day", X, Y);
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

/** The SQLSTATE `fn` is refused with, from the error or a wrapper's cause; fails if `fn` succeeds. */
async function refused(pool: Pool, fn: (client: PoolClient) => Promise<unknown>, label: string): Promise<string> {
  try {
    await withClient(pool, null, fn);
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
  return expect.fail(`${label} was not refused`);
}

/** The owner's shape, as in chain.test.ts: a NOINHERIT login that says SET ROLE audit_owner first. */
let ownerPool: Pool | undefined;
function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (ownerPool === undefined) {
    const password = randomPassword();
    postgres.sql(
      "postgres",
      `CREATE ROLE audit_verifier LOGIN NOINHERIT PASSWORD '${password}'; ` +
        "GRANT audit_owner TO audit_verifier WITH INHERIT FALSE, SET TRUE; GRANT CONNECT ON DATABASE unset TO audit_verifier",
    );
    ownerPool = pools.open(postgres, "unset", "audit_verifier", password);
  }
  return withClient(ownerPool, null, async (client) => {
    await client.query("SET ROLE audit_owner");
    try {
      return await fn(client);
    } finally {
      await client.query("RESET ROLE");
    }
  });
}

/** The SQLSTATE the owner's call is refused with: the functions' own refusals (UA006, UA007). */
const refusedAsOwner = (fn: (client: PoolClient) => Promise<unknown>, label: string) =>
  asOwner(fn).then(
    () => expect.fail(`${label} was not refused`),
    (error: unknown) => String((error as { code?: unknown }).code),
  );
const one = async (client: PoolClient, text: string, values: unknown[] = []) =>
  Object.values((await client.query(text, values)).rows[0] ?? {})[0];
const bodies = (lane: string) => lines(`SELECT seq FROM audit.event_body WHERE lane = '${lane}' ORDER BY seq`);

describe("audit retention", () => {
  test("no_raw_delete", async () => {
    for (const table of ["event_body", "chain", "segment", "redaction_log"]) {
      const code = await refused(as.retention, (c) => c.query(`DELETE FROM audit.${table}`), table);
      expect(code, table).toBe("42501");
    }
    // The setting alone opens nothing: a writer holds no DELETE, and the owner's own DELETE outside a function is
    // still refused by the trigger.
    const web = await refused(
      as.web,
      async (c) => {
        await c.query("SELECT set_config('audit.maintenance', 'segment', false)");
        try {
          await c.query("DELETE FROM audit.event_body");
        } finally {
          await c.query("RESET audit.maintenance");
        }
      },
      "web",
    );
    expect(web).toBe("42501");
    await expect(asOwner((c) => c.query("DELETE FROM audit.event_body"))).rejects.toMatchObject({ code: "UA005" });
    await expect(
      asOwner(async (c) => {
        await c.query("SELECT set_config('audit.maintenance', 'body', false)");
        try {
          await c.query("UPDATE audit.event_body SET body_text = 'x'");
        } finally {
          await c.query("RESET audit.maintenance");
        }
      }),
    ).rejects.toMatchObject({ code: "UA005" });
    expect(bodies("sec")).toEqual(["1", "2", "3"]);
  });

  test("redact_refuses_unexpired", async () => {
    // Yesterday's takedown (2 years from the event) and the decision (counted from a case close nobody supplies yet).
    for (const seq of [3, 2]) {
      const code = await refusedAsOwner((c) => c.query("SELECT audit.redact('mod', $1)", [seq]), `mod ${seq}`);
      expect(code, `mod ${seq}`).toBe("UA006");
    }
    expect(bodies("mod")).toEqual(["1", "2", "3"]);
  });

  test("functions_only_through_owner", async () => {
    // No grant yet: erase_subject's comes with P3.07g, the retention job's and the anchor's with P3.22.
    const calls = [
      `SELECT audit.erase_subject('${X}')`,
      "SELECT audit.redact('sec', 1)",
      `SELECT audit.seal_segment('sec', ${monthOf(OLD)})`,
      `SELECT audit.drop_segment('sec', ${monthId(OLD)})`,
      `SELECT audit.mark_anchored('sec', ${monthId(OLD)}, decode(repeat('00', 32), 'hex'))`,
    ];
    for (const role of ROLES)
      for (const call of calls) expect(await refused(as[role], (c) => c.query(call), `${role} ${call}`)).toBe("42501");
    expect(bodies("sec")).toEqual(["1", "2", "3"]);
  });

  test("erase_sec_by_did", async () => {
    // X is the subject of sec 2 and the actor of sec 3; sec 1 is about Y alone.
    await expect(asOwner((c) => one(c, "SELECT audit.erase_subject($1)::int", [X]))).resolves.toBe(2);
    expect(bodies("sec")).toEqual(["1"]);
    expect(lines("SELECT seq || ' ' || part || ' ' || by FROM audit.redaction_log ORDER BY seq")).toEqual([
      "2 erase audit_verifier",
      "3 erase audit_verifier",
    ]);
    expect(lines(`SELECT count(*) FROM audit.event_body WHERE lane = 'sec' AND '${X}' IN (subject, actor)`)).toEqual([
      "0",
    ]);
    // Idempotent, and the chain still verifies with the two body rows gone.
    await expect(asOwner((c) => one(c, "SELECT audit.erase_subject($1)::int", [X]))).resolves.toBe(0);
    await expect(asOwner((c) => verifyChain(c, "sec", "full"))).resolves.toEqual({ ok: true, last: 3 });
  });

  test("mod_rows_survive_target_erasure", () => {
    expect(lines(`SELECT seq FROM audit.event_body WHERE lane = 'mod' AND subject = '${X}' ORDER BY seq`)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  test("redact_expired_ok", async () => {
    await expect(asOwner((c) => one(c, "SELECT audit.redact('sec', 1)"))).resolves.toBe(true);
    expect(bodies("sec")).toEqual([]);
    expect(lines("SELECT part || ' ' || by FROM audit.redaction_log WHERE lane = 'sec' AND seq = 1")).toEqual([
      "redact audit_verifier",
    ]);
    // A second call, and a seq that never existed, remove nothing and say so.
    await expect(asOwner((c) => one(c, "SELECT audit.redact('sec', 1)"))).resolves.toBe(false);
    await expect(asOwner((c) => one(c, "SELECT audit.redact('sec', 99)"))).resolves.toBe(false);
    await expect(asOwner((c) => verifyChain(c, "sec", "full"))).resolves.toEqual({ ok: true, last: 3 });
  });

  test("seal_refuses_open_month_and_resealing", async () => {
    const open = await refusedAsOwner(
      (c) => c.query("SELECT audit.seal_segment('sec', date_trunc('month', now())::date)"),
      "open month",
    );
    expect(open).toBe("UA007");
    await expect(asOwner((c) => one(c, `SELECT audit.seal_segment('sec', ${monthOf(OLD)})`))).resolves.toBe(true);
    const again = await refusedAsOwner(
      (c) => c.query(`SELECT audit.seal_segment('sec', ${monthOf(OLD)})`),
      "sealed month",
    );
    expect(again).toBe("UA007");
    await expect(asOwner((c) => one(c, `SELECT audit.seal_segment('sec', ${monthOf(MID)})`))).resolves.toBe(true);
    // Nothing left to seal in a later finished month.
    await expect(asOwner((c) => one(c, `SELECT audit.seal_segment('sec', ${monthOf("2 months")})`))).resolves.toBe(
      false,
    );
    expect(lines("SELECT first_seq || '-' || last_seq FROM audit.segment WHERE lane = 'sec' ORDER BY id")).toEqual([
      "1-2",
      "3-3",
    ]);
    await expect(withClient(as.auditor, null, (c) => verifySegments(c, "sec"))).resolves.toEqual({ ok: true });
  });

  test("drop_requires_anchor", async () => {
    const code = await refusedAsOwner(
      (c) => c.query(`SELECT audit.drop_segment('sec', ${monthId(OLD)})`),
      "unanchored",
    );
    expect(code).toBe("UA007");
    expect(lines("SELECT count(*) FROM audit.chain WHERE lane = 'sec'")).toEqual(["3"]);
  });

  test("mark_anchored_checks_hash", async () => {
    const denied = await refused(
      as.retention,
      (c) => c.query(`SELECT audit.mark_anchored('sec', ${monthId(OLD)}, decode(repeat('00', 32), 'hex'))`),
      "retention",
    );
    expect(denied).toBe("42501");
    await expect(
      asOwner((c) => c.query(`SELECT audit.mark_anchored('sec', ${monthId(OLD)}, decode(repeat('00', 32), 'hex'))`)),
    ).rejects.toMatchObject({ code: "UA007" });
    await asOwner((c) => c.query("SELECT audit.mark_anchored(lane, id, head_hash) FROM audit.segment"));
    expect(lines("SELECT count(*) FROM audit.segment WHERE anchored_at IS NULL")).toEqual(["0"]);
  });

  test("seal_and_drop", async () => {
    const newer = await refusedAsOwner(
      (c) => c.query(`SELECT audit.drop_segment('sec', ${monthId(MID)})`),
      "newer first",
    );
    expect(newer).toBe("UA007");
    await asOwner((c) => c.query(`SELECT audit.drop_segment('sec', ${monthId(OLD)})`));
    expect(lines("SELECT seq FROM audit.chain WHERE lane = 'sec'")).toEqual(["3"]);
    // From genesis the walk now finds a gap; from the dropped segment's head it verifies.
    await expect(withClient(as.auditor, null, (c) => verifyChain(c, "sec", "links"))).resolves.toMatchObject({
      ok: false,
    });
    const verdict = withClient(as.auditor, null, async (c) =>
      verifyChain(c, "sec", "links", await chainStart(c, "sec")),
    );
    await expect(verdict).resolves.toEqual({ ok: true, last: 3 });
    await expect(withClient(as.auditor, null, (c) => verifySegments(c, "sec"))).resolves.toEqual({ ok: true });
  });

  test("drop_keeps_the_lanes_last_rows", async () => {
    // Expired and anchored, but append continues the chain from the newest row, so a lane keeps one.
    const code = await refusedAsOwner(
      (c) => c.query(`SELECT audit.drop_segment('sec', ${monthId(MID)})`),
      "chain head",
    );
    expect(code).toBe("UA007");
    expect(lines("SELECT seq FROM audit.chain WHERE lane = 'sec'")).toEqual(["3"]);
  });

  test("drop_refuses_case_close_class", async () => {
    await asOwner((c) => c.query(`SELECT audit.seal_segment('mod', ${monthOf(OLD)})`));
    await asOwner((c) => c.query(`SELECT audit.seal_segment('mod', ${monthOf(MID)})`));
    await asOwner((c) =>
      c.query("SELECT audit.mark_anchored(lane, id, head_hash) FROM audit.segment WHERE lane = 'mod'"),
    );
    await asOwner((c) => c.query(`SELECT audit.drop_segment('mod', ${monthId(OLD)})`));
    const code = await refusedAsOwner(
      (c) => c.query(`SELECT audit.drop_segment('mod', ${monthId(MID)})`),
      "case_close",
    );
    expect(code).toBe("UA006");
    expect(bodies("mod")).toEqual(["2", "3"]);
    expect(lines("SELECT part FROM audit.redaction_log WHERE lane = 'mod' AND seq = 1")).toEqual(["drop"]);
  });

  test("segment_tamper_detected", async () => {
    postgres.sql(
      "unset",
      `UPDATE audit.segment SET head_hash = decode(repeat('00', 32), 'hex') WHERE lane = 'mod' AND id = ${monthId(MID)}`,
    );
    await expect(withClient(as.auditor, null, (c) => verifySegments(c, "mod"))).resolves.toMatchObject({ ok: false });
  });
});
