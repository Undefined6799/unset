// P3.06s (account-jobs.ts): a confirmation pass asks our PDS about each due job and hands the store its answer; an
// unavailable PDS backs the job off and changes nothing, and one failure never stops the pass.
import type { RepoStatus, RepoStatusReader } from "@unset/infrastructure-firehose";
import type { AccountJob, AccountStore, ConfirmedStatus } from "@unset/infrastructure-postgres";
import { describe, expect, test } from "vitest";
import { confirmPass } from "./account-jobs.ts";

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "did:plc:cccccccccccccccccccccccc";

function fakeStore(due: AccountJob[]) {
  const confirmed: [string, ConfirmedStatus][] = [];
  const failed: string[] = [];
  const asked: string[] = [];
  const store: Pick<AccountStore, "dueJobs" | "confirmed" | "failed"> = {
    dueJobs: async (kind) => {
      asked.push(kind);
      return due.filter((job) => job.kind === kind);
    },
    confirmed: async (job, answer) => {
      if (job.did === C) throw new Error("database hiccup");
      confirmed.push([job.did, answer]);
    },
    failed: async (job) => {
      failed.push(job.did);
    },
  };
  return { store, confirmed, failed, asked };
}

describe("confirmPass", () => {
  test("indexer.confirmations_reach_the_store_and_unavailable_backs_off", async () => {
    const fake = fakeStore([
      { did: A, kind: "confirm_status", attempts: 0, claim: "c" },
      { did: B, kind: "confirm_deletion", attempts: 0, claim: "c" },
      { did: C, kind: "confirm_status", attempts: 0, claim: "c" },
    ]);
    const answers: Record<string, RepoStatus> = {
      [A]: { kind: "active" },
      [B]: { kind: "unavailable" },
      [C]: { kind: "not_found" },
    };
    const readStatus: RepoStatusReader = async (did) => answers[did] ?? { kind: "unavailable" };
    const pass = await confirmPass({ store: fake.store, readStatus, timeoutMs: 1000 });
    expect(fake.asked).toEqual(["confirm_status", "confirm_deletion"]);
    expect(fake.confirmed).toEqual([[A, { kind: "active" }]]);
    expect(fake.failed).toEqual([B]);
    expect(pass).toEqual({ confirmed: 1, unavailable: 1, failed: 1 });
  });
});
