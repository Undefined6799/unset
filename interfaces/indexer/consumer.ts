// The indexer's consumer of our PDS's stream (book P3.05s): the reader's frames, applied by the index store. The
// process wiring that starts the reader with it comes with its compose service (P3.05s, PR 3).
//
// An `#account` frame stops the stream until the account-state machine (book P3.06s) can apply it: ingest must not
// keep indexing an account the PDS has taken down or deactivated, and skipping the frame would move the cursor past
// it. Throwing makes the reader stop with `apply_failed` and redial from the same cursor (fail closed).
import type { FirehoseConsumer, RepoFrame } from "@unset/infrastructure-firehose";
import type { IndexFrame, IndexStore } from "@unset/infrastructure-postgres";

export class AccountFrameUnsupported extends Error {
  constructor() {
    super("account frames wait for the account-state machine (P3.06s)");
    this.name = "AccountFrameUnsupported";
  }
}

export function indexConsumer(store: IndexStore): FirehoseConsumer {
  return {
    cursor: store.cursor,
    apply: async (frame) => store.apply(indexFrame(frame)),
    missedEvents: store.missedEvents,
  };
}

function indexFrame(frame: RepoFrame): IndexFrame {
  switch (frame.kind) {
    case "repoCommit":
      return { kind: "repoCommit", seq: frame.seq, did: frame.did, rev: frame.rev, changes: frame.changes };
    case "identity":
      return { kind: "identity", seq: frame.seq, did: frame.did };
    case "sync":
      return { kind: "sync", seq: frame.seq, did: frame.did };
    case "account":
      throw new AccountFrameUnsupported();
  }
}
