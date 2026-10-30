---
id: seal
type: area
status: current
areas: ["[[seal]]"]
summary: "Hub for infrastructure/seal: s1 and s1c envelopes, bound context, keyring file, active kid, rewrap."
code: [infrastructure/seal/index.ts, infrastructure/seal/seal.ts, infrastructure/seal/sealStream.ts, infrastructure/seal/context.ts, infrastructure/seal/keyring.ts, infrastructure/seal/rewrap.ts, infrastructure/postgres/rewrapAll.ts, infrastructure/postgres/rewrap-cli.ts, shared/config/load.ts]
sources: []
importance: normal
related: ["[[postgres]]", "[[pds]]"]
replaced_by: null
tags: [area, seal]
checked: 2026-10-30
---
# seal

**What it owns.** Envelope encryption for values the app stores and reads back (P1.14).
`infrastructure/seal/index.ts` exports `sealContext`, `SealError`, `Keyring`, `parseKeyring`,
`sealFields` and `createSealer`. `rewrap` is a method on that sealer, not a separate index export.

**Envelope.** AES-256-GCM (`infrastructure/seal/seal.ts`).
- `s1`: `s1.<kid>.<wrapIv>.<wrappedDek+tag>.<iv>.<ciphertext+tag>`. Each value gets a fresh
  32-byte data key, wrapped by the active key-encryption key. Plaintext over 1 MiB is
  `seal.too_large`.
- `s1c` (`infrastructure/seal/sealStream.ts`): a header line
  `s1c.<kid>.<wrapIv>.<wrappedDek+tag>.<prefix>`, then 64 KiB chunks. This is the path for
  objects too large for `seal`.

**Bound context.** Only `sealContext` builds one: `<schema>.<table>.<column>|<rowKey>`
(`infrastructure/seal/context.ts`). It is GCM additional data (`unset.seal.data.v1|` on `s1`,
`unset.seal.chunk.v1|` on a chunk), so a value opened for another column or row key fails.
A stored column gets its context from `sealedContext` in `infrastructure/postgres/sealedColumns.ts`
([[postgres]]). That helper is not exported from the postgres index.

**Keyring file and active kid.** `sealFields.SEAL_KEYRING` is a `secretFile`
(`infrastructure/seal/keyring.ts`). The loader reads `SEAL_KEYRING_FILE` and refuses a plain
`SEAL_KEYRING` environment value (`shared/config/load.ts`). The file is JSON
`{ "active": "<kid>", "keys": { "<kid>": "<base64 of 32 bytes>" } }`: one to four keys, every
kid matching `[a-z0-9]{1,16}`, `active` one of those kids, and no other field. A file that does
not parse refuses boot. `wrapDek` uses `Keyring.active`. Printing a keyring yields `[keyring]`.

**Rewrap.** `rewrap` (`infrastructure/seal/rewrap.ts`) takes an `s1` value (six dot-parts) or an
`s1c` header without its newline (five). It unwraps the data key and, unless that kid is already
`Keyring.active`, wraps it again under the active key. The data parts are left as stored.
`rewrapAll` (`infrastructure/postgres/rewrapAll.ts`) does this for every registered `types.sealed`
column that has no `form`, and a kid missing from the keyring throws `seal.unknown_kid` and stops
the run. `unset-rewrap` (`infrastructure/postgres/rewrap-cli.ts`) runs `rewrapAll`; `--check <kid>`
exits 0 only when no stored value still names that kid.

**Dev keyring.** `docs/human/runbooks/dev-stack-secrets.md` describes `web_seal_keyring` for the
web process (the OAuth state and token sets): one 32-byte key. The runbook's example sets
`active` to `k1`, and rotates with `unset-rewrap` rather than removing a key a stored value still
names.

**Links.** [[postgres]], [[pds]].
