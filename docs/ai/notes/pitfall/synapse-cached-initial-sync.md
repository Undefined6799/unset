---
id: synapse-cached-initial-sync
type: pitfall
status: current
areas: ["[[chat]]", "[[matrix]]"]
summary: Synapse replays a device's initial /sync for 2 minutes, so the chat page reads its vault state from the server.
code: [apps/chat/matrix/recovery.ts, tests/e2e/fixtures/chat-stack.ts]
sources: [https://spec.matrix.org/v1.18/client-server-api/#get_matrixclientv3useruseridaccount_datatype]
importance: high
related: []
replaced_by: null
tags: [pitfall, chat, matrix]
checked: 2026-11-21
---
**What goes wrong.** Synapse keeps each `/sync` answer in a response cache keyed by user, timeout, `since`, filter,
`full_state` and device (synapse v1.165.0 `rest/client/sync.py:210`), for `sync_response_cache_duration`, 2 minutes by
default (`config/cache.py:211-212`). A browser that reloads within that window makes the same initial `/sync` (no
`since`, same device, same filter id from localStorage) and gets the old answer: account data as it stood before. The
newer events come in the following incremental syncs. matrix-js-sdk 43.0.0 answers `getAccountDataFromServer`,
`secretStorage.isStored` and `getSecretStorageStatus` from that sync store once the first sync is done
(`src/client.ts:2362-2373`, `src/secret-storage.ts:590-593`, `src/rust-crypto/rust-crypto.ts:885-919`).

In the live run of 2026-11-21 the chat page, reloaded right after setup, saw no vault, judged the browser half set up
(ADR 0089 decision 2) and offered "Save your recovery key" again. Going on would have written a new vault and backup
under a new key, and the key the person had saved would no longer unlock anything.

**The rule.** Anything that decides between setting up and unlocking reads the server, not the sync store:
`readFacts` GETs the vault's account data itself (`vaultOnServer`), `userHasCrossSigningKeys(userId, true)` always runs a
fresh `/keys/query` for ourselves (`rust-crypto.ts:516-526`), and a failed read stops with a fixed code, never setup.
The e2e homeserver can replay an old initial sync (`state.cachedInitialAt`); `chat_page.reload_cached_sync` covers it.

**Repair later?** Only by hand: a saved key made useless cannot be brought back; the vault holds only the newest key.
