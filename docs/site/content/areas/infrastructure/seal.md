---
title: seal
weight: 5
---

Envelope encryption for values the process stores and reads back. Package `@unset/infrastructure-seal`. `infrastructure/postgres/migrations/0007_sealed_type.sql` is the column domain; opening a value is this package.

## Owns

| Module | What it holds |
| --- | --- |
| `infrastructure/seal/seal.ts` | `encrypt` and `decrypt` via `node:crypto` `createCipheriv("aes-256-gcm", ...)`. `seal` writes `s1.<kid>.<wrapIv>.<wrappedDek+tag>.<iv>.<ciphertext+tag>`. Plaintext cap `MAX_PLAINTEXT` is 1 MiB. |
| `infrastructure/seal/sealStream.ts` | `sealStream` and `unsealStream`. `CHUNK_BYTES` is exported from `index.ts`. |
| `infrastructure/seal/context.ts` | `sealContext(column, rowKey)`. `checkContext` refuses a string that is not that shape. |
| `infrastructure/seal/keyring.ts` | `Keyring`, `parseKeyring`, `sealFields`, `keyringFile`. Keys are read from `SEAL_KEYRING_FILE`. `toString`, `toJSON` and `inspect` return `[keyring]`. |
| `infrastructure/seal/sealer.ts` | `createSealer`. `seal`, `unseal`, `sealJson`, `unsealJson`, the two stream methods, `rewrap`, `countByKid`. |
| `infrastructure/seal/rewrap.ts` | `rewrap` of one value onto the active key. |
| `infrastructure/seal/error.ts` | `SealError`. |

`seal` puts the context on the data as GCM additional data (`DATA_AAD + context` in `seal.ts`). `0007_sealed_type.sql` checks the `s1.<kid>.` prefix only. The comment there says opening a value is this package, not the database.

`@unset/infrastructure-seal` does not depend on `age-encryption`. `vendor-sdk-one-adapter` still names that package as importable only from this folder.

## May import

The [`infrastructure` row](../). This package imports neither `net-guard` nor another infrastructure package.

Declared in `infrastructure/seal/package.json`: `@unset/shared-config`, workspace. Crypto calls are `node:crypto`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/seal/index.ts` |
| Composition | `createSealer` in `interfaces/http/compose.ts` |
| Rewrap | `infrastructure/postgres/rewrap-cli.ts` imports `sealFields` and calls `rewrapAll` |

No `main.ts` and no Compose service for this package. Compose service `web` mounts secret `web_seal_keyring` (`deployment/compose.dev.yaml`).

## Data

No table. Columns typed `types.sealed` are listed in `infrastructure/postgres/sealed-columns.json` and read by `infrastructure/postgres/sealedColumns.ts`. On this tree those are `app.oauth_session.sealed` (row key `did`) and `app.oauth_state.sealed` (row key `key`). `oauthStores.ts` seals with `sealedContext` from that registry.
