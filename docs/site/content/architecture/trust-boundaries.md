---
title: Trust boundaries
weight: 4
---

Four boundaries. The rule text is [SE-6](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) in `docs/human/engineering/engineering-rules.md`. The machine-read path list is the last section of [`.github/CODEOWNERS`](https://github.com/Undefined6799/unset/blob/main/.github/CODEOWNERS).

## Edge

Under dev the edge publishes nothing. Newt is the only other member of `newt_edge`, at a fixed address (`deployment/compose.dev.yaml`, `deployment/networks.dev.json`). The two sites are `deployment/edge/dev/app.caddy` (upstream `web:8080`) and `deployment/edge/dev/pds.caddy` (upstream `pds:3000`). Both bind `10.250.37.3` and use the dev leaf ([ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md)). The local stack publishes `127.0.0.1:80` and `127.0.0.1:443` instead, and has no Newt.

The PDS's HTTP port is on the `edge` network, which only the edge shares. `web` is not on it.

On the PDS host, `deployment/edge/snippets/pds-fonts.caddy` answers `/_unset/` inside the route, before the upstream (`sites/pds.caddy`, `dev/pds.caddy`). A `.woff2` file whose name is letters, digits and dashes is served from the image. Every other path under that prefix is 404. The edge answers that prefix itself. The lines are on [edge](../../areas/deployment/edge/).

`deployment/edge/` does not import `deployment/preflight/` (`edge-not-preflight` in `scripts/lint/.dependency-cruiser.cjs`). The edge is trusted base; the preflight is product.

## One process per container

Each Compose service is one process, with its own user, read-only root and dropped capabilities (`deployment/compose.dev.yaml`). `web` is `interfaces/http`, the only interface folder in the tree.

Database roles match that split. `web` is the only roster role the dev stack logs in as. Grants are per role in `infrastructure/postgres/grant-matrix.json`; migration 0003 grants schema `USAGE` and no table privileges. Later migrations grant column lists on the tables they create.

## Egress

Caller-influenced outbound HTTP is scanned by `scripts/guards/egress.ts`. A dynamic `fetch`, a raw `http`/`https`/`net`/`tls` client, `undici`, or `new WebSocket` / `new EventSource` fails outside `infrastructure/net-guard/` and test files. `EGRESS_FILE_EXEMPTIONS` in that file is `interfaces/pds-admin/pds.mjs`.

`infrastructure/net-guard/src/request.ts`: a caller-influenced request names a policy, connects only to addresses `resolveVetted` accepted, and a 301, 302, 303, 307 or 308 is refused rather than followed. `undici` is imported only in this folder (`vendor-sdk-one-adapter`).

Ways out of the stack, from `deployment/networks.dev.json`: `web_egress` (web only), `pds_egress` (the PDS only), `newt_egress` (Newt only). `db` and `app` are internal. `NETGUARD_INTERNAL_HOSTS` by environment is on [Processes](../processes/): local sets our PDS, dev and staging must leave it absent, and prod requires a non-empty list (`shared/config/netGuard.ts`). [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) (decided (0001 log), acceptance pending) names our PDS as the one internal-host entry. [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) drops that exception on staging. The two do not conflict.

## Trusted base

A pull request that touches a trusted-base path touches only trusted-base files, their tests and docs. A pull request that touches a `# checks:` path touches no product path (`apps/`, `interfaces/`, `domains/`, `infrastructure/`, `shared/`, `deployment/`). The check is `trusted_base_isolated` (SE-6). This docs change is not a trusted-base change.

Paths the section names that are in the tree:

| Path | What it is |
| --- | --- |
| `shared/http/` | CSRF gate, session slot, CSP builder, server kit |
| `infrastructure/session/` | browser session store |
| `interfaces/http/session-cookie.ts` | `__Host-sid` |
| `domains/identity/verify-handle.ts` | two-way handle check |
| `infrastructure/net-guard/` | egress |
| `shared/islands/` | island props serialiser |
| `shared/ui/safe-href.ts` | link allowlist |
| `infrastructure/seal/` | seal |
| `infrastructure/postgres/roles.json`, `roles.ts` | roster and password sync |
| `infrastructure/postgres/migrations/`, `grant-matrix.json`, `erasure-registry.json` | named on the `# parsed:` line |
| `deployment/postgres/init/`, `init-local/` | cluster bootstrap |
| `infrastructure/audit/` | audit append |
| `shared/lexicons/` | lexicons and the permission set |
| `deployment/edge/` | edge |
| `deployment/sigstore/` | `trusted_root.json` ([ADR 0033](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0033-image-signing-keyless.md)) |
