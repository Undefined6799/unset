import { describe, expect, test } from "vitest";
import {
  type InviteClaim,
  type InviteId,
  type InviteIssue,
  type InvitePorts,
  issueMemberInvite,
  joinCode,
  parseSubmissionId,
  type SubmissionId,
} from "./invites.ts";
import type { Did } from "./syntax.ts";

const ALICE = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa" as Did;
const SUBMISSION = parseSubmissionId("0b5f3c1e-8f6a-4d2b-9c7e-1a2b3c4d5e6f") as SubmissionId;

/** In-memory ports that record what the rule asked for, in order. */
function ports(claim: InviteClaim, issue: InviteIssue | Error, store: "ok" | Error = "ok") {
  const calls: string[] = [];
  const p: InvitePorts = {
    claim: async (did, submission) => {
      calls.push(`claim ${did} ${submission}`);
      return claim;
    },
    issue: async (did) => {
      calls.push(`issue ${did}`);
      if (issue instanceof Error) throw issue;
      return issue;
    },
    store: async (did, id, code) => {
      calls.push(`store ${did} ${id} ${code}`);
      if (store instanceof Error) throw store;
    },
    drop: async (did, id) => {
      calls.push(`drop ${did} ${id}`);
    },
    denied: async (did) => {
      calls.push(`denied ${did}`);
    },
  };
  return { p, calls };
}

const claimed: InviteClaim = { kind: "claimed", id: "row-1" as InviteId };
const ok: InviteIssue = { kind: "ok", code: "pds-abc-123", remaining: 4, availableAt: null };

describe("issueMemberInvite", () => {
  test("invite.issue_ok: claims the submission, asks once, stores the code on that row", async () => {
    const { p, calls } = ports(claimed, ok);
    expect(await issueMemberInvite(p, ALICE, SUBMISSION)).toEqual({ kind: "issued", remaining: 4 });
    expect(calls).toEqual([`claim ${ALICE} ${SUBMISSION}`, `issue ${ALICE}`, `store ${ALICE} row-1 pds-abc-123`]);
  });

  test("invite.double_submit: an existing row decides, with no second request", async () => {
    for (const [claim, expected] of [
      [{ kind: "issued" }, { kind: "issued", remaining: null }],
      [{ kind: "pending" }, { kind: "refused", code: "invite.in_progress" }],
    ] as const) {
      const { p, calls } = ports(claim, ok);
      expect(await issueMemberInvite(p, ALICE, SUBMISSION)).toEqual(expected);
      expect(calls).toEqual([`claim ${ALICE} ${SUBMISSION}`]);
    }
  });

  test.each([
    [{ kind: "quota", availableAt: "2026-11-20T00:00:00.000Z" }, "invite.quota"],
    [{ kind: "closed" }, "invite.closed"],
    [{ kind: "unavailable" }, "invite.unavailable"],
  ] as const)("invite.refused_frees_the_form: %o drops the pending row", async (issue, code) => {
    const { p, calls } = ports(claimed, issue);
    const outcome = await issueMemberInvite(p, ALICE, SUBMISSION);
    expect(outcome).toMatchObject({ kind: "refused", code });
    expect(calls.at(-1)).toBe(`drop ${ALICE} row-1`);
    expect(calls.some((call) => call.startsWith("denied"))).toBe(false);
  });

  test("invite.quota keeps when the next one is available", async () => {
    const { p } = ports(claimed, { kind: "quota", availableAt: "2026-11-20T00:00:00.000Z" });
    expect(await issueMemberInvite(p, ALICE, SUBMISSION)).toEqual({
      kind: "refused",
      code: "invite.quota",
      availableAt: "2026-11-20T00:00:00.000Z",
    });
  });

  test("invite.denied_audited: a refusal by pds-admin drops the row and records the denial", async () => {
    const { p, calls } = ports(claimed, { kind: "denied" });
    expect(await issueMemberInvite(p, ALICE, SUBMISSION)).toEqual({ kind: "refused", code: "invite.denied" });
    expect(calls.slice(-2)).toEqual([`drop ${ALICE} row-1`, `denied ${ALICE}`]);
  });

  test("invite.store_failed: a code that cannot be stored is reported, not shown", async () => {
    const { p } = ports(claimed, ok, new Error("db down"));
    expect(await issueMemberInvite(p, ALICE, SUBMISSION)).toEqual({ kind: "store_failed" });
  });
});

describe("issueMemberInvite when the request throws", () => {
  test("invite.issue_throws: an unexpected failure drops the pending row and is rethrown, never swallowed", async () => {
    const failure = new TypeError("bug in the issuer");
    const { p, calls } = ports(claimed, failure);
    await expect(issueMemberInvite(p, ALICE, SUBMISSION)).rejects.toBe(failure);
    // Without the drop, the row stays pending and the same form answers "in progress" for good (review N4).
    expect(calls).toEqual([`claim ${ALICE} ${SUBMISSION}`, `issue ${ALICE}`, `drop ${ALICE} row-1`]);
  });
});

describe("parseSubmissionId", () => {
  test("takes a v4 UUID in lowercase only", () => {
    expect(parseSubmissionId("0b5f3c1e-8f6a-4d2b-9c7e-1a2b3c4d5e6f")).toBe("0b5f3c1e-8f6a-4d2b-9c7e-1a2b3c4d5e6f");
    for (const bad of ["", "x", "0B5F3C1E-8F6A-4D2B-9C7E-1A2B3C4D5E6F", "0b5f3c1e-8f6a-1d2b-9c7e-1a2b3c4d5e6f", null]) {
      expect(parseSubmissionId(bad)).toBeNull();
    }
  });
});

describe("joinCode", () => {
  test("join.code_malformed: only a short code of letters, digits and dashes is shown", () => {
    expect(joinCode("staging-unset-ac-abcde-fghij")).toBe("staging-unset-ac-abcde-fghij");
    for (const bad of [null, "", "<script>", "a b", "a".repeat(65), "códe"]) expect(joinCode(bad)).toBeNull();
  });
});
