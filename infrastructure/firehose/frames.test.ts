// P3.05s (frames.ts): the structural check on each decoded frame body.
import { describe, expect, test } from "vitest";
import { parseMessage } from "./frames.ts";

const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const type = (name: string) => `com.atproto.sync.subscribeRepos#${name}`;
const commit = (overrides: Record<string, unknown> = {}) => ({
  $type: type("commit"),
  seq: 7,
  repo: DID,
  rev: "3l",
  time: "t",
  commit: {},
  blocks: new Uint8Array(),
  ops: [{ action: "create", path: "sh.unset.profile/self", cid: {} }],
  ...overrides,
});

describe("parseMessage", () => {
  test("frames.commit_keeps_the_body_for_verification", () => {
    const body = commit();
    expect(parseMessage(body)).toEqual({ kind: "commit", body });
  });

  test("frames.refuses_shapes_the_parser_cannot_use", () => {
    expect(parseMessage(undefined)).toBeNull();
    expect(parseMessage({ seq: 1, did: DID })).toBeNull(); // no $type
    expect(parseMessage({ ...commit(), $type: type("handle") })).toBeNull(); // not in the lexicon we read
    expect(parseMessage(commit({ seq: -1 }))).toBeNull();
    expect(parseMessage(commit({ seq: 1.5 }))).toBeNull();
    expect(parseMessage(commit({ repo: "alice.example" }))).toBeNull();
    expect(parseMessage(commit({ blocks: "car" }))).toBeNull();
    expect(parseMessage(commit({ ops: [{ action: "move", path: "a/b", cid: null }] }))).toBeNull();
    expect(parseMessage(commit({ ops: Array.from({ length: 201 }, () => commit().ops[0]) }))).toBeNull();
    expect(parseMessage({ $type: type("info") })).toBeNull();
    expect(parseMessage({ $type: type("sync"), seq: 1, did: DID })).toBeNull(); // no rev
  });

  test("frames.account_status_is_kept_or_marked_unknown", () => {
    const account = (status?: unknown) => ({
      $type: type("account"),
      seq: 3,
      did: DID,
      time: "t",
      active: false,
      ...(status === undefined ? {} : { status }),
    });
    const statusOf = (status?: unknown) => {
      const message = parseMessage(account(status));
      return message?.kind === "frame" && message.frame.kind === "account" ? message.frame.status : "refused";
    };
    expect(statusOf()).toBeNull();
    expect(statusOf("takendown")).toBe("takendown");
    expect(statusOf("throttled")).toBe("throttled");
    expect(statusOf("brand-new")).toBe("unknown");
    expect(statusOf(4)).toBe("refused");
  });

  test("frames.identity_carries_no_handle", () => {
    const message = parseMessage({ $type: type("identity"), seq: 4, did: DID, time: "t", handle: "evil.example" });
    expect(message).toEqual({ kind: "frame", frame: { kind: "identity", seq: 4, did: DID } });
  });
});
