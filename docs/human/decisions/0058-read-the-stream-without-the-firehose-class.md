# 0058 — Read our PDS's stream with `@atproto/sync`'s parsers, not its `Firehose` class

Status: Accepted by Alex, 2026-11-17 22:51:02Z, against 7ddf33d (his line "Accept ADR 0058 at 7ddf33d", typed in the
project chat after the coordinator had reviewed that head). The only changes since that head are this status
paragraph, the index rows and the ADR 0001 acceptance line. It supersedes one phrase of ADR 0052 decision 1, and
nothing else in it: "with `@atproto/sync`'s `Firehose` (no runner: events are handled one at a time, in order)". The
rest of that decision stands: a new process, `interfaces/indexer`, reads our PDS's `subscribeRepos` at its internal
URL, and its stream packages are pinned exactly and imported only in `infrastructure/firehose/`.

## Context
ADR 0052 decision 4 says a handler failure never advances the cursor: the reader stops, backs off and reconnects from
the stored cursor. Building the reader (book P3.05s) against the source of `@atproto/sync` 0.4.24
(`node_modules/@atproto/sync/dist/firehose/index.js`) showed that its `Firehose` class cannot do that.

- **A failed handler is reported, then skipped.** Without a runner, `processEvt` (line 140) calls `handleEvent` for
  each write and catches a throw with `this.opts.onError(new FirehoseHandlerError(err, write))` (line 147), then goes
  on to the next write and the next frame. The runner path does the same (line 84).
- **A failed parse is reported, then skipped.** `parseEvt` (line 104) catches any error in parsing or verifying a
  frame, including a failed DID lookup for the signing key, with `this.opts.onError(new FirehoseParseError(err, evt))`
  and returns `[]` (lines 136 and 137). The frame never reaches the handler.
- **A frame that fails validation is reported, then skipped.** `validate` calls `onError(new FirehoseValidationError(...))`
  and returns undefined (line 64). `Subscription` yields nothing for it.

In each case the next frame reaches our handler, and its transaction writes a cursor past the frame that failed. An
`onError` that stops the class cannot stop it in time, because `processEvt` has already moved on to the next write.

- **An unproven op is dropped without an error.** `parseCommitAuthenticated` keeps only the ops that `verifyProofs`
  proves against the signed tree (line 185, `verifiedOps = ops.filter(...)`). `verifyProofs` in `@atproto/repo` 0.11.5
  puts the rest in `unverified` (`dist/sync/consumer.js`, lines 99 and 107) and does not throw. A create or update
  whose CID or block is missing is skipped as well (lines 227 and 230). A dropped delete would leave a removed record
  on a public profile.

The same file is identical in 0.4.26, the version ADR 0052 read (compared with `diff`). 0.4.26 is not pinned, because
`.npmrc`'s `min-release-age=7` refuses it until 2026-11-20.

## Decision
1. The reader in `infrastructure/firehose/` does not use the `Firehose` class. It uses two documented exports:
   - `parseCommitAuthenticated` from `@atproto/sync`, which checks the commit signature and its proofs;
   - `Subscription` from `@atproto/xrpc-server`, for the socket.

   `Subscription` reconnects a dropped socket itself and reads the cursor on every dial. It dials only when we pull
   the next frame, so the cursor it reads is the one the last applied frame wrote.
2. Any failure stops the stream, and the reader dials again from the consumer's cursor after a capped back-off. That
   covers a frame we cannot read, an error frame, a commit that does not verify, and a consumer that throws. Nothing
   is skipped in-process (ADR 0052 decision 4).
3. The reader compares the writes the parser proved with the ops the commit claims. A commit with fewer proven writes
   than ops fails the frame.
4. **Pinned exactly:**
   - `@atproto/sync` 0.4.24.
   - `@atproto/xrpc-server` 0.13.10, now a direct runtime dependency (it was already in `@atproto/sync`'s closure).
   - `@atproto/repo` 0.11.5, `@atproto/crypto` 0.5.7 and `ws` 8.22.2 for the tests' stand-in PDS.

   dependency-cruiser's `vendor-sdk-one-adapter` keeps all five in `infrastructure/firehose/`.
5. The only `IdResolver` method the parser calls is `did.resolveAtprotoKey`, and the reader passes it a callback. The
   composition root wires that callback to the identity resolver on `net-guard` (ADR 0052 decision 2). An identity
   frame carries only the DID, and `verifyHandle` decides the handle.

## Alternatives
- **Keep the `Firehose` class and stop it from `onError`.** The frame after the failed one can still reach the
  handler before the stop takes effect. The class also still drops unproven ops.
- **A custom runner that buffers each frame.** `trackEvent` is not awaited by the class (line 77), so frames pile up
  with no back-pressure, and parse failures still skip.
- **Our own socket and frame decoder.** This duplicates `Subscription`'s reconnects, heartbeats and back-pressure for
  no gain.

## Consequences
- **No silent skip.** A frame is never skipped without our knowing. A bad frame from our own PDS stops indexing until
  someone acts, which fails closed. The process PR logs each stop and exposes it on health.
- **Express is loaded.** `@atproto/xrpc-server`'s only export is its root, which loads express. The reader opens no
  listening socket, and a test proves it (`reader.opens_no_listening_socket`).
- **About 160 lines of our own.** The reader is `reader.ts` and `frames.ts` instead of a library class, and its tests
  use real signed commits.

## Compliance
`infrastructure/firehose/reader.test.ts`:
- `reader.refuses_a_commit_signed_with_another_key`
- `reader.refuses_a_commit_with_an_unproven_op`
- `reader.handler_failure_replays_from_cursor`
- `reader.unreadable_frame_stops_before_the_next`
- `reader.opens_no_listening_socket`

The `vendor-sdk-one-adapter` fixtures in `scripts/lint/depcruise.test.ts` cover the dependency rule.
