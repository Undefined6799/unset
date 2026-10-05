# Shared blocks: the mechanisms that exist exactly once

**This file lists only the security mechanisms of global invariant 2** (`00-README.md`): the pieces of code where a
second copy is itself a defect, because two copies drift and one of them ends up weaker. Nothing else belongs here.
Every other function is extracted **only after real repetition** (Alex's architecture principles 11 and 12; README
reuse rule 9): first occurrence, keep it simple; repeated for the same reason, observe; a stable common concept,
consider extracting. A step that wants to add an entry here must show that a second copy would weaken a security
property, and the addition goes through review like any other book change.

How to read an entry:
- **Owner**: the one step that builds it. Any later change to its interface is a change to that step (principle 16:
  stop for human review before changing a core boundary).
- **Signature**: as the owning step writes it (typed pseudocode). If this file and the step disagree, the step wins
  and this file is the defect.
- **Never**: what a caller must not do instead. A pull request that does one of these fails review even if its tests
  pass (README rule 10).
- **Tests**: where the owning step proves it. "Beside the source" means the step names the folder and the test
  names, not a single file name.

---

## 1. Config loader

- **Owner:** P1.02 (`shared/config/`).
- **Signature:** `defineConfig(schema): Schema<T>`; `loadConfig(schema, env = process.env): Readonly<T>`, or throws
  `ConfigError { code: "config.invalid", problems: Array<{ key; reason: "missing" | "invalid" | "unreadable" |
  "forbidden_in_env" }> }` (reasons only, never values). Field kinds `str`, `int`, `bool`, `oneOf`, `url`, `origin`,
  `list`, `secret({ minBytes })`, `secretFile({ minBytes })`; secrets have no default and no optional variant.
  `Secret.reveal()` is the only accessor; every printing path returns `"[secret]"`.
- **Never:** read `process.env` (or a secret file) anywhere else; give a secret a default or make it optional; log,
  print or return a config value; add a second schema library.
- **Tests:** beside the source: `missing_lists_all_keys`, `secret_has_no_default`, `secret_never_printed`,
  `boot_exit_code`. Cross-field rules added by later steps (for example `NETGUARD_INTERNAL_HOSTS` in prod) live in the
  same schema and are tested in the step that adds them.

## 2. RateLimiter

- **Owner:** P1.06 (`shared/http/limits/rateLimit.ts`, `policy.ts`: the mechanism and the policy type). The policy
  values are not part of this block: each interface owns its table in `interfaces/<name>/limits.ts` (P1.06p).
- **Signature:** one `RateLimiter` per process: `consume(policy: PolicyName, subject: { ip: ClientIp | null } |
  { did: string }): { ok: true } | { ok: false, retryAfterS: int }`. Two middlewares fill the two P1.04 slots:
  `rateLimitIp` (before `csrf`, the policy's `ip` and `global` entries) and `rateLimitDid` (after `session`, the `did`
  entries; a policy with a `did` entry requires `requiresSession: true`). Each process builds its
  limiter from its own interface's table (`createRateLimiter(table)`); a feature step adds its policy to that table in
  its own PR, and every route must name one (`every_route_has_policy`, P1.06p).
- **Never:** keep a second bucket map; key a bucket on a raw address or a raw DID (keys are salted HMACs held in memory
  only); write a limit key, an address or a count per person to a table or a log; treat "no DID" as "no limit".
  Per-client limiting at the network edge is Caddy's (`caddy-ratelimit`, P1.28), not a second limiter in our code;
  PDS per-IP limits are off or very high, with no bypass key and no bypass IPs (editor resolution 1, provisional).
- **Tests:** beside the source: `bucket_allows_then_denies`, `did_limit_at_route_level`, `keys_not_reversible`,
  `key_cap_overflow`, `exception_denies`.

## 3. CSRF / Origin gate

- **Owner:** P1.07 (`shared/http/csrf/gate.ts`).
- **Signature:** `csrfGate(publicOrigin: string): Middleware`, installed by `createServer` on every route whose
  method is not GET or HEAD. Decision `"allow" | "deny"`; deny → 403 `csrf.denied`, logged with a closed `reason`.
  Order: `Sec-Fetch-Site`, then exact `Origin`, then exact `Referer`; any exception denies.
- **Never:** add an exemption flag or skip the gate for a route; use Hono's `csrf` or a token scheme beside it;
  compare origins by suffix, wildcard or site; trust a same-site sender (`chat.unset.sh`, `admin.int.unset.sh`);
  change state in a GET handler.
- **Tests:** `shared/http/csrf/gate.test.ts` (the decision table) and `coverage.test.ts` (every non-GET
  route in `routeTable()` has the gate; no GET handler writes).

## 4. CSP builder and security headers

- **Owner:** P1.08 (`shared/http/csp/`).
- **Signature:** `buildCsp(group: RouteGroup, cfg): string`; `securityHeaders(group, cfg): Record<string, string>`;
  `POLICIES: Record<RouteGroup, Directives>` built from the closed `Source` union, which cannot express
  `'unsafe-inline'`, `'unsafe-eval'`, `'strict-dynamic'`, `*`, `https:`, `data:` or a nonce. `form-action 'self'`
  everywhere; a cross-origin continuation goes through a same-origin interstitial (P2.05).
- **Never:** set `Content-Security-Policy` (or another security header) by hand in a handler (it is overwritten and
  logged `csp.handler_override`); add a source string outside the `Source` type; loosen `form-action`.
- **Tests:** beside the source with `__snapshots__/`: `snapshot_per_group`, `no_unsafe_tokens`,
  `form_action_self_everywhere`, `profile_has_no_script_src`, `handler_cannot_override`.

## 5. Island props serialiser

- **Owner:** P1.10 (`shared/ui/islands/props.ts`, client `shared/ui/src/islands/readProps.ts`).
- **Signature:** `serializeProps(value: JsonValue, opts?: { maxBytes?: number }): string` (default 15 360 bytes;
  throws `SerializeError { code: "islands.props_invalid" | "islands.props_too_large" }`);
  `renderPropsTag(id, value): { id, json }`; client `readProps(id): JsonValue` (throws `PropsMissing`).
- **Never:** write `JSON.stringify` output into a `<script>` element or an HTML attribute; hand-escape props; pass
  props through a data attribute or a global.
- **Tests:** beside the source: `props_known_answer`, `escapes_html_breakers`, `no_literal_separators_in_source`, the
  fast-check round-trip fuzz.

## 6. Seal (`seal` / `unseal`, `sealStream` / `unsealStream`) and `sealTo` / `sealToStream`

- **Owner:** P1.14 (`infrastructure/seal/`) for `seal` and `sealStream`; P1.14a (`infrastructure/seal/sealTo.ts`)
  for `sealTo` and `sealToStream`.
- **Signature:**
  - `sealContext(column: SealedColumnId, rowKey: string): SealContext` (branded; columns listed in
    `infrastructure/postgres/sealed-columns.json`; an entry with `form: "sealStream" | "sealToStream" | "sealTo"` registers a
    column that names a sealed object or holds an `a1.` record, e.g. `app.legal_hold.media_key`).
  - `seal(plaintext: Uint8Array, context: SealContext): string`; `unseal(sealed: string, context: SealContext):
    Uint8Array`; `sealJson` / `unsealJson`; `rewrap(sealed): string`. Errors `SealError { code: "seal.format" |
    "seal.unknown_kid" | "seal.auth_failed" | "seal.too_large" }`. Max plaintext 1 MiB.
  - `sealStream(source: ReadableStream<Uint8Array>, context: SealContext, maxBytes: int): ReadableStream<Uint8Array>`
    and `unsealStream(sealed, context, maxBytes)`: the one chunked envelope (format `s1c`, 64 KiB STREAM chunks), for
    data over 1 MiB (P6.14a's chat evidence).
  - `sealTo(recipients: "legal_hold", plaintext: Uint8Array, context: SealContext): Promise<string>` (age X25519 to
    `LEGAL_HOLD_RECIPIENTS`, key K2 of P0.12); errors `SealToError { code: "seal_to.too_large" |
    "seal_to.no_recipients" }`. **There is no decrypt function**: owners open records offline
    (`docs/human/runbooks/open-sealed.md`).
  - `sealToStream(recipients: "legal_hold", source: ReadableStream<Uint8Array>, context: SealContext, maxBytes: int):
    ReadableStream<Uint8Array>`: the public-key counterpart of `sealStream` (age's own STREAM payload), for held media
    of any size (P4.07, P5.07b, P6.14a); one object per held upload, no chunking of our own.
- **Never:** call `createCipheriv` (or any cipher) for stored data outside `infrastructure/seal/`; pass a free
  string as a context; write a second chunking scheme over `seal` or `sealTo`; import `age-encryption` outside `sealTo.ts` (dependency-cruiser rule `age-only-in-sealto`);
  write any code that decrypts a `sealTo` envelope on a server.
- **Tests:** P1.14 beside the source plus `tests/integration/postgres/sealed-columns.test.ts` (`roundtrip`, `context_bound`,
  `tamper_each_part`, `unknown_kid`, `stream_roundtrip`, `stream_truncated`); P1.14a beside `sealTo.ts` (`sealto_roundtrip_offline`, `envelope_shape`,
  `plugin_recipient_refused`, `sealtostream_large_object`, `no_decrypt_in_servers`).

## 7. `appendAudit`

- **Owner:** P1.15 (`infrastructure/audit/append.ts`; SQL `audit.append(...)`, `SECURITY DEFINER`).
- **Signature:** `appendAudit(tx, { action, outcome, actorDid?, actorKey?, target?, reason?, case?, jti?,
  requestId?, receipt?, pii? }): Promise<{ lane, seq }>`. The lane comes from the action, never from the caller;
  `action` is in the closed `audit.actions` list (new actions arrive by migration); `outcome` ∈ `attempted |
  succeeded | failed | denied | unknown`; `actorDid` is a human actor's DID, asserted by the writing process; `pii`
  is only `{ tailnet_ip }` and only for the `admin` writer.
- **Never:** `INSERT` into `audit.*` directly (the grants refuse it); add an audit lane or a second log of moderation
  events; record user sign-ins, sign-outs, failed logins or sessions (aggregate counters only; editor resolution 5);
  put an email, an IP, a token or free text in `reason`, `jti` or `target`.
- **Tests:** beside the source: `writer_denied`, `unknown_action`, `no_direct_insert`, `append_only`,
  `pii_only_admin`, `chain_links`, `row_hash_known_answer`, `typed_append_rejects_free_text`.

## 8. Egress guard (`guardedFetch` / `guardedRequest`)

- **Owner:** P1.18 (address table and resolver), P1.18a (requests and policies), P1.18b (proxy mode). Package
  `infrastructure/net-guard`.
- **Signature:**
  - `guardedRequest(policy, { url, method: "GET" | "POST", headers?, body?, timeoutMs ≤ 30 000, maxBytes ≤ 64 MiB,
    accept?, signal? }): Promise<{ status, headers, body: Uint8Array }>`. `signal` is the caller's request deadline
    (P1.04 `ctx.deadline`); `guardedFetch` honours `init.signal` the same way.
  - `guardedFetch(policy, defaults): typeof fetch`, built on `undici.request`, for libraries that take a custom fetch.
  - `Policy` = `{ kind: "fixed", hosts }` | `{ kind: "public", internalHosts }`, optionally `via: { proxy }` (P1.18b).
    One `public` policy (`atproto`) serves every user PDS and authorization server; our own PDS is its internal-host
    exception (`NETGUARD_INTERNAL_HOSTS`). Errors `NetGuardError.code` `egress.*`.
  - Helpers: `classifyAddress(ip)`, `isInternalName(host)`, `RANGES` (the one table of non-public ranges; the proxy's
    deny list is generated from it).
- **Never:** call `fetch` with a non-constant URL, or import `node:http(s)`, `http2`, `net`, `tls`, `dgram`, `undici`,
  `axios`, `got`, `node-fetch` or `ws` outside `infrastructure/net-guard` (P0.06 `egress` guard; the only listed file
  exemption is `interfaces/pds-admin/pds.mjs`, P2.09; plus `shared/http` importing exactly
  `{ BlockList, isIPv4, isIPv6 }` from `node:net` for address matching, which opens no sockets (P1.05, line-level
  `guard-allow egress`)); classify private or reserved addresses anywhere but `infrastructure/net-guard`; follow a
  redirect; let a non-TypeScript process reach the internet except through the generated egress proxy.
- **Tests:** P1.18 beside the source (the prototype's 23 tests ported); P1.18a `public_with_internal_exception`,
  `internal_host_required_in_prod`, `pinned_connection`, `no_redirects`, `gzip_bomb_request`; P1.18b
  `proxy_deny_ranges_match_classify`, `generated_config_fresh`, `proxy_logs_no_client_address`; and the P0.06 guard
  `scripts/guards/repo.test.ts`.

## 9. Lexicon validator

- **Owner:** P1.31 (`shared/lexicons/src/validate.ts`).
- **Signature:** `validateRecord(nsid, value, mode: "write" | "read") → { ok: true, value } | { ok: false, errors }`
  (strict on write: unknown fields refused for our own records; accepted on read). The same package owns
  `scopeString()` and `scopeStringFallback()`.
- **Never:** write a record to a repo without `validateRecord` in `write` mode; hand-check record fields; use a second
  validator (or `@atproto/lex` directly) outside `shared/lexicons`; change a published schema except through the
  breaking-check.
- **Tests:** unit tests beside the validator in `shared/lexicons/`: `every_schema_parses_strict`, `validate_write_rejects_unknown_field`,
  `limits_enforced`, `breaking_check_detects_removed_field`.

## 10. `verifyHandle`

- **Owner:** P2.02 (`domains/identity/verify-handle.ts`), over P2.01's resolvers.
- **Signature:** `verifyHandle(did: Did, opts?: { consistency?: "fresh" | "cached" }) → HandleVerdict`, where
  `HandleVerdict = { status: "verified", handle, checkedAt } | { status: "invalid", checkedAt } |
  { status: "unavailable" }`; never throws. Also `invalidateHandle(did)` and `displayHandle(verdict)` (the handle,
  or `handle.invalid`).
- **Never:** read `alsoKnownAs` / `rawAlsoKnownAs` anywhere else; show a handle taken from an event, a token or a
  cache without this check; accept a handle that does not resolve back to the same DID.
- **Tests:** `domains/identity/verify-handle.test.ts`; the static guard
  `identity/also-known-as.guard.test.ts` (P2.01).

## 11. `eraseDid`, with the DID-column registry and `EXPORT_POLICY`

- **Owner:** P3.07 (`eraseDid`); P1.13 (the registry and `didColumns()`); P4.26 (`EXPORT_POLICY`, which walks the
  same registry).
- **Signature:**
  - `core.erase_did(did types.did, why text) RETURNS jsonb` (`SECURITY DEFINER`, owned by `migrator`, EXECUTE to
    `indexer` only; hand-written, one statement per registry row) — the function the book calls `eraseDid`. It
    erases everything except rows and objects under an open legal hold, and then reports the outcome
    `partially_erased_legal_hold`; the rest is finished when the hold closes. It never refuses the whole erasure
    (editor resolution 3; the hold predicate is the SQL function `core.is_held`, in the forms `core.is_held(did)` and
    `core.is_held(subject_kind, subject_ref)`, declared by P3.07 with its body written by P4.07).
  - Registry `infrastructure/postgres/erasure-registry.json`: `{ "<schema>.<table>.<column>": { strategy: "delete_row" |
    "set_null" | "retain" | "audit_redact" | "retain_legal_hold", class?, reason? } }`; every `types.did` column is
    found from `pg_catalog`. `didColumns() → [{ schema, table, column }]` is that catalog query (P1.13 step 1).
  - `EXPORT_POLICY: Record<schema.table, { mode: "include" } | { mode: "redact", columns, when?, replaceWith?,
    reason } | { mode: "exclude", reason }>`; `dsar.export(did)` walks `didColumns()` and aborts on a table without a
    policy.
- **Never:** delete or anonymise a person's rows with ad-hoc SQL; add a DID column without the `types.did` domain and
  a registry row; grant EXECUTE on `core.erase_did` to `admin` or `web` (moderators use `mod.erase_foreign_did`);
  export a table that has no `EXPORT_POLICY` entry.
- **Tests:** `tests/integration/postgres/did-columns.test.ts` (P1.13: `registry_complete`, `detects_missing_row`); P3.07
  `erase-covers-every-did-column`, `erase-idempotent`, `audit-chain-valid-after-erase` and the legal-hold case;
  P4.26 `export_policy_covers_registry`.
- **Grants on a registry table (column-list ruling, plan §5.2 at `9c54e52`; SE-6; editor pass 2026-10-04 evening):**
  a table with any row in `erasure-registry.json` (personal data) is granted to every role **by column list** in its
  creating migration (`GRANT SELECT (a, b), UPDATE (b) ON app.t TO web`) with a column-level `grant-matrix.json` entry;
  never `wholeTable`, never a table-wide `GRANT` (except `DELETE`, which Postgres has only table-wide, recorded as
  `rowPrivileges` in the matrix entry), and no default privilege reaches it (P1.12 has no `ON TABLES` defaults). A table with no registry row may be granted whole-table with `wholeTable: true`. A later step that adds
  a column a role must read or write on a registry table carries an explicit column grant for it; that grant rides
  with the step only because the column is new in the same PR (P0.09c rule 3c); a column grant on an existing
  column is a `<id>g` trusted-base step. This applies to `app`, `idx`, `mod`, `adm` and every other schema, and to
  grants-only `g` steps (e.g. P4.16g, P5.02g list columns). Tests: P1.12 `personal_data_by_column_list`,
  `no_default_privilege_reaches_personal_data`.

## 12. `profileHref`

- **Owner:** P3.12 (`domains/identity/profile-href.ts`). No step in Phases 1–2 links to a profile, so it is defined
  once, there.
- **Signature:** `profileHref(actor: { did: Did; verdict: HandleVerdict }, opts?: { rkey?: string }) → SafeHref`:
  `/@<verified handle>` or `/@<did>`, plus `/p/<rkey>` for a post; the handle comes only from `verifyHandle` (entry
  10) and the result through `safeHref` (P1.24). `canonicalActorPath` is its internal helper.
- **Never:** build a `/@…` link by hand or from an unverified handle; export `canonicalActorPath` for links.
- **Tests:** P3.12 `profile-href` and its static guard.

---

## Not in this file (and why)

Requests from the phase files to catalogue other helpers here are declined under rule 9, because a second copy of
them is a readability issue, not a security hole: `shared/admin-envelope` (`canonicalize`, `loadRoster`),
`checkAttestation`, `mediaUrl`, `canonicalActorPath`, `app.end_sessions_for_did`, `confirmRepoStatus`, `reconcile`,
`core.is_erased` (phase-3 Notes); `alert.send`, `ops.report`, `permissionSetCheck`, `release.json`, `core.is_held`
(phase-5 Notes; it is named in section 11 as the hold predicate). Each stays documented in its own step; terms a reader needs are in `03-glossary.md`.

Invariant 2 also names `createRoom` and `profileHref`. `createRoom` is owned by P6.10 (one wrapper, with its own
single-file guard), and phase-6 Notes add no entry here. `profileHref` is entry 12 (owner P3.12, lead sweep).
`safeHref` / `SafeHref` are owned by P1.24 and used by P2.20 and every other link builder; they are not an entry of
their own, but no step may rebuild them.

## Editor pass (2026-10-03)

- Lead sweep: section 6 names `sealStream` / `unsealStream` (P1.14, format `s1c`) and `sealToStream` (P1.14a), and the
  `form` entries of `sealed-columns.json` (lead decision 1); section 11 and the list above name the hold predicate
  `core.is_held` with its two forms instead of `isHeld` (lead decision 2); new entry 12 `profileHref`, owner P3.12, and
  the `safeHref` owner P1.24 (coordinator items 8 and 9).

### Editor pass (2026-10-04, decision 34)

- Paths rewritten to the decision-34 layout from `layout-map.md` by script (`apply.py`); prototype citations, external
  repositories (atproto, Synapse docs, Element) and Notes written before 2026-10-04 keep their old paths as history.
- Owners' paths follow the layout map; lexicon validator tests sit beside the validator. `shared/admin-envelope` (declined here) is the zero-dependency allowlist entry (O-1 resolved).

### Editor pass (2026-10-04 05:10Z refinement, decision 34)

- Layout open points resolved by the architecture thread (guideline §1 refined 05:10Z; `layout-map.md`): admin envelope is the allowlist entry; server-kit owners' paths → `shared/http/`; docs paths per O-10.

### Editor pass (2026-10-04, findings)

- Section 8: `guardedRequest` takes an optional `signal` (the P1.04 request deadline), and `guardedFetch` honours
  `init.signal` (findings F-08; triage in `reviews/step-book-findings-triage.md`).

### Editor pass (2026-10-04, SE-6 follow-up ruling)

- Section 2 (`RateLimiter`): the policy values leave `shared/http/limits/policies.ts` for each interface's `limits.ts`
  (P1.06p); the block keeps the mechanism and `policy.ts`. Architecture thread ruling on the SE-6 follow-ups; plan
  folded at `6275827`.

### Editor pass (2026-10-04 evening)

- Section 11 gains the column-list grant rule for registry tables (plan §5.2 at `9c54e52`; SE-6; P1.12 tests). Every
  step that creates a table with a registry row follows it; Phases 3–6 cite this section where their text is
  hypothesis.
