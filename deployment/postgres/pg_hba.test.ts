// P1.11y: the server's only client authentication file. The postgres image copies it in and points `hba_file` at it,
// so a data directory initialised before (staging's) reads it too, and the trust lines initdb writes into
// $PGDATA/pg_hba.conf are never read. The superuser connects over the local socket by peer only; every other role
// connects over TCP with a SCRAM password. postgres.image.test.ts proves the built server applies it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const rules = readFileSync(join(import.meta.dirname, "pg_hba.conf"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => line.split(/\s+/));

describe("pg_hba.conf", () => {
  test("pg_hba_is_exactly_peer_reject_scram", () => {
    // pg_hba.conf is read top to bottom and the first match decides (PostgreSQL 18 docs, 20.1 "The pg_hba.conf File"),
    // so the superuser's TCP rejects come before the SCRAM lines, and a local role other than postgres matches nothing.
    expect(rules).toEqual([
      ["local", "all", "postgres", "peer"],
      ["host", "all", "postgres", "0.0.0.0/0", "reject"],
      ["host", "all", "postgres", "::/0", "reject"],
      ["host", "all", "all", "0.0.0.0/0", "scram-sha-256"],
      ["host", "all", "all", "::/0", "scram-sha-256"],
    ]);
  });

  test("pg_hba_has_no_weak_method", () => {
    const weak = new Set(["trust", "password", "md5", "ident"]);
    expect(rules.filter((rule) => weak.has(rule.at(-1) ?? ""))).toEqual([]);
    // No replication rule and no hostssl or hostnossl variant: those would be separate decisions.
    expect(new Set(rules.map(([type]) => type))).toEqual(new Set(["local", "host"]));
    expect(rules.filter((rule) => rule[1] !== "all")).toEqual([]);
  });
});
