# PDS font delivery (P2.24e)

## Threats

An overly broad response matcher could loosen native script, style or captcha policy. A joined duplicate CSP
must never be mistaken for one policy. A request-controlled host or a general environment interpolation could
turn a font permission into an external source or bypass hostname validation. A broad static root or matcher
could disclose configuration, licences or other files, or bypass the existing limiter and XRPC/blob guards.

The reader accepts only the proved response/static forms, and C18 shares its PDS site checks. The original
comma-free policy is captured whole; deferred replacement adds exactly two configured HTTPS font URLs only
on native HTML GET/HEAD account/authorization responses with status 200 or 400–599. Unsupported policies,
missing/repeated/empty fields, other MIME/status/method/route combinations pass through unchanged. This
recognizes only P2.24d's five policy families; recognition alone is not release admission for a new native flow.

`pds-fonts.caddy` matches the two exact original URIs after existing guards. Other font-prefix requests receive
404. The fixed public root mirrors those paths without rewrites. Reusable filenames use revalidation, never
immutable caching. `pds-upstream.caddy` shares the unchanged generic proxy options; the local app uses `upstream`.

## Packaging and provenance

`shared/ui/fonts/` remains authoritative. `pds-fonts.json` records exact edge copies and SHA256 digests of both
WOFF2 files and their existing OFL notices; edge tests bind fonts to `shared/ui/sheet/source.json` as well.
Copy updates from the recorded sources byte for byte. The Docker context remains `deployment/edge`; only
`pds-public/_unset/fonts/`, `pds-licenses/` and the manifest are added under `/etc/caddy`. The licences and manifest
are outside the public root. No download, build step, mount or additional service is used for fonts.

`pds-fonts.test.ts` tests parser denial, complete-policy bounds and byte provenance. `caddyfile.image.test.ts`
compares exact adapted response/static JSON and verifies font/licence digests, ownership, modes and file kind
in the final image. The native browser proof must use the complete final configuration, configured hostname-only
origin and actual files; unit tests alone cannot prove effective CSP/font rendering. Diagnostic binaries remain
separate from the production image/CI toolchain and its release/security gates (ADR 0027 section 5).

Sources: Caddy 2.11.7 `modules/caddyhttp/reverseproxy/{reverseproxy.go,copyresponse.go,caddyfile.go}`,
`modules/caddyhttp/headers/caddyfile.go`, `modules/caddyhttp/fileserver/{caddyfile.go,staticfiles.go}` and
`modules/caddyhttp/celmatcher.go` at <https://github.com/caddyserver/caddy/tree/v2.11.7>.
