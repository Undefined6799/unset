// P2.10 (infrastructure/postgres/inviteStore.ts, migration 0032): a member's invites against real Postgres, connected
// as `web` (TE-2). A submission is one row; a code is sealed to its row; every read and write is scoped to the caller.
import { relative } from "node:path";
import { type Did, type InviteId, parseSubmissionId, type SubmissionId } from "@unset/domains-identity";
import { createInviteStore, createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "invite-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => web.end());

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 9).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const sealer = createSealer(keyring);

let dids = 0;
const nextDid = (): Did => {
  dids += 1;
  // base32 digits only (a-z, 2-7), as the did:plc syntax allows.
  const tail = dids.toString(32).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "a");
  return `did:plc:${tail.padStart(24, "i")}` as Did;
};
const submission = (): SubmissionId => parseSubmissionId(crypto.randomUUID()) as SubmissionId;

function setup() {
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => {
    logged.push({ event, fields });
  };
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  return { store: createInviteStore({ pool: web, sealer, log }), logged };
}

const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query<T>(text, values)).rows);

async function issued(store: ReturnType<typeof setup>["store"], did: Did, code: string): Promise<InviteId> {
  const claim = await store.claim(did, submission());
  if (claim.kind !== "claimed") throw new Error("expected a new row");
  await store.store(did, claim.id, code);
  return claim.id;
}

describe("invite store", () => {
  test("invite.issue_ok: the code is sealed at rest and listed back for its member", async () => {
    const { store } = setup();
    const did = nextDid();
    const id = await issued(store, did, "pds-test-abcde-fghij");
    const [row] = await sql<{ sealed_code: string; state: string }>(
      "SELECT sealed_code, state FROM app.invite WHERE id = $1",
      [id],
    );
    expect(row?.state).toBe("issued");
    expect(row?.sealed_code).not.toContain("abcde");
    expect(await store.list(did)).toEqual([{ id, code: "pds-test-abcde-fghij", createdAt: expect.any(Date) }]);
  });

  test("invite.double_submit: the same submission is one row, and says whether it was issued", async () => {
    const { store } = setup();
    const did = nextDid();
    const same = submission();
    const first = await store.claim(did, same);
    expect(first.kind).toBe("claimed");
    expect(await store.claim(did, same)).toEqual({ kind: "pending" });
    if (first.kind === "claimed") await store.store(did, first.id, "pds-code-1");
    expect(await store.claim(did, same)).toEqual({ kind: "issued" });
    expect(await sql("SELECT id FROM app.invite WHERE inviter_did = $1", [did])).toHaveLength(1);
  });

  test("invite.refused_frees_the_form: drop removes the pending row, so the form can be sent again", async () => {
    const { store } = setup();
    const did = nextDid();
    const same = submission();
    const claim = await store.claim(did, same);
    if (claim.kind !== "claimed") throw new Error("expected a new row");
    await store.drop(did, claim.id);
    expect((await store.claim(did, same)).kind).toBe("claimed");
  });

  test("invite.list_scoped: a member sees only their own issued invites, newest first, last 30 days, at most 20", async () => {
    const { store } = setup();
    const alice = nextDid();
    const bob = nextDid();
    // An invite of 31 days ago, written as web writes one (web may set created_at only when it inserts).
    const old = crypto.randomUUID() as InviteId;
    await sql(
      "INSERT INTO app.invite (id, inviter_did, submission_id, state, created_at) " +
        "VALUES ($1, $2, $3, 'pending', now() - interval '31 days')",
      [old, alice, submission()],
    );
    await store.store(alice, old, "pds-old");
    const ids: InviteId[] = [];
    for (let n = 0; n < 21; n += 1) ids.push(await issued(store, alice, `pds-a-${n}`));
    await issued(store, bob, "pds-bob");
    await store.claim(alice, submission()); // pending: holds no code, never listed
    const listed = await store.list(alice);
    expect(listed).toHaveLength(20);
    expect(listed[0]?.code).toBe("pds-a-20");
    expect(listed.map((item) => item.id)).not.toContain(old);
    expect(listed.map((item) => item.code)).not.toContain("pds-bob");
  });

  test("invite.hide_own_only: a member hides their own row and never another member's", async () => {
    const { store } = setup();
    const alice = nextDid();
    const bob = nextDid();
    const mine = await issued(store, alice, "pds-mine");
    const theirs = await issued(store, bob, "pds-theirs");
    expect(await store.hide(alice, theirs)).toBe(false);
    expect(await store.hide(alice, mine)).toBe(true);
    expect(await store.list(alice)).toEqual([]);
    expect((await store.list(bob)).map((item) => item.code)).toEqual(["pds-theirs"]);
  });

  test("invite.store_scoped: a code is never stored onto another member's row", async () => {
    const { store } = setup();
    const alice = nextDid();
    const bob = nextDid();
    const claim = await store.claim(bob, submission());
    if (claim.kind !== "claimed") throw new Error("expected a new row");
    await expect(store.store(alice, claim.id, "pds-stolen")).rejects.toThrow();
    await store.drop(alice, claim.id);
    expect(await sql("SELECT state FROM app.invite WHERE id = $1", [claim.id])).toEqual([{ state: "pending" }]);
  });

  test("invite.unseal_failed: a code moved to another row is listed as unavailable", async () => {
    const { store, logged } = setup();
    const did = nextDid();
    const a = await issued(store, did, "pds-a");
    const b = await issued(store, did, "pds-b");
    await sql("UPDATE app.invite SET sealed_code = (SELECT sealed_code FROM app.invite WHERE id = $2) WHERE id = $1", [
      a,
      b,
    ]);
    const listed = await store.list(did);
    expect(listed.find((item) => item.id === a)?.code).toBeNull();
    expect(listed.find((item) => item.id === b)?.code).toBe("pds-b");
    expect(logged).toEqual([{ event: "invite.unseal_failed", fields: {} }]);
  });
});
