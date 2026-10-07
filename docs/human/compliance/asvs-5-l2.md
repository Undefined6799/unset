# OWASP ASVS 5.0 Level 2

Plan §6.1 (decision 19) sets OWASP ASVS 5.0 Level 2 as a hard requirement. This page has one row for every Level 1
and Level 2 requirement in the pinned list, saying how far we meet it and what proves it. Level 2 includes Level 1. A
`[SEC]` step's PR updates its rows (engineering rule SE-1). `scripts/docs/compliance.test.ts` keeps the table honest:
- every L1 and L2 id appears exactly once;
- every `test:` evidence names a test that exists;
- every `lint:` evidence names a rule that is enabled.

The launch gate (L.03) runs the same test with `STRICT=1`, which also fails on any `open` or `partial` row.

- Pinned list: [`asvs-5.0.csv`](asvs-5.0.csv), ASVS version 5.0.0
- Source: https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv
- sha256: `98c8fe911b9edb403af8ee05d3ce8201ecac2659e313b053890a62847cdcf680`

Changing the pinned list takes a PR that replaces the file, its hash and the rows together.

**Status:**
- `covered`: the control is in place for everything built so far, and at least one evidence item is not `step:`.
- `partial`: part of it is in place, and the evidence says which part.
- `open`: not built yet. The step column names the step that builds it, where the book already says.
- `n/a`: does not apply. The evidence column gives the reason, and a row reopens when its reason stops holding.

**Evidence** is a comma-separated list. Each item takes one of these forms:

| Form | Meaning |
|---|---|
| `test:<file>#<name>` | a named test in that file |
| `lint:<rule>` | a Semgrep rule id in `scripts/lint/semgrep/`, or a Biome rule or plugin set in `biome.json` |
| `guard:<script>` | `scripts/guards/<script>.ts` |
| `doc:<path>` | a file in the repository |
| `step:<id>` | the step planned to provide it (the only form allowed on an `open` row) |

Requirement texts are shortened. The pinned list holds the full wording.

**Scope:** this table covers our own code and configuration. Some requirements are met by upstream software we run
rather than code we write: the PDS's password, account and OAuth authorization-server rows (V6.2, V6.4, V10.4, V10.6
and V10.7). Those rows stay `open` with no step until the PDS deployment steps decide how they are evidenced.

## V1 Encoding and Sanitization

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V1.1.1 | Input is decoded or unescaped into a canonical form only once, it is only decoded when … | open |  | — |
| V1.1.2 | The application performs output encoding and escaping either as a final step before being … | open |  | — |
| V1.2.1 | Output encoding for an HTTP response, HTML document, or XML document is relevant for the … | covered | `test:apps/web/render.test.tsx#island_props_xss_escaped`, `test:apps/web/render.test.tsx#document_no_inline_script_or_style`, `guard:inner-html` | P2.20 |
| V1.2.2 | When dynamically building URLs, untrusted data is encoded according to its context (e.g. … | partial | `test:shared/http/returnPath.fuzz.test.ts#fuzz_same_origin`, `step:P2.20` | P2.20 |
| V1.2.3 | Output encoding or escaping is used when dynamically building JavaScript content … | covered | `test:shared/ui/islands/props.test.ts#escapes_html_breakers`, `test:shared/ui/islands/props.fuzz.test.ts#fuzz_no_breakers`, `test:shared/ui/islands/props.fuzz.test.ts#props_breaker_examples_fail` | — |
| V1.2.4 | Data selection or database queries (e.g., SQL, HQL, NoSQL, Cypher) use parameterized … | open |  | — |
| V1.2.5 | The application protects against OS command injection and that operating system calls use … | open |  | — |
| V1.2.6 | The application protects against LDAP injection vulnerabilities, or that specific … | n/a | n/a: no LDAP anywhere in the system | — |
| V1.2.7 | The application is protected against XPath injection attacks by using query … | n/a | n/a: no XPath or XML query anywhere in the system | — |
| V1.2.8 | LaTeX processors are configured securely (such as not using the "--shell-escape" flag) … | n/a | n/a: no LaTeX processor | — |
| V1.2.9 | The application escapes special characters in regular expressions (typically using a … | open |  | — |
| V1.3.1 | All untrusted HTML input from WYSIWYG editors or similar is sanitized using a well-known … | open |  | — |
| V1.3.2 | The application avoids the use of eval() or other dynamic code execution features such as … | partial | `lint:computed-import`, `test:shared/http/csp/policies.test.ts#no_unsafe_tokens` | — |
| V1.3.3 | Data being passed to a potentially dangerous context is sanitized beforehand to enforce … | open |  | — |
| V1.3.4 | User-supplied Scalable Vector Graphics (SVG) scriptable content is validated or sanitized … | open |  | — |
| V1.3.5 | The application sanitizes or disables user-supplied scriptable or expression template … | open | `step:P2.20` | P2.20 |
| V1.3.6 | The application protects against Server-side Request Forgery (SSRF) attacks, by … | covered | `guard:egress`, `test:infrastructure/net-guard/src/request.test.ts#internal_names_refused_on_public_policy`, `test:infrastructure/net-guard/src/resolve.test.ts#mixed_answers_refused`, `test:infrastructure/net-guard/src/request.test.ts#pinned_connection` | — |
| V1.3.7 | The application protects against template injection attacks by not allowing templates to … | n/a | n/a: no template engine; pages are React components compiled at build time and never built from input | — |
| V1.3.8 | The application appropriately sanitizes untrusted input before use in Java Naming and … | n/a | n/a: no Java runtime; the server is TypeScript on Node.js | — |
| V1.3.9 | The application sanitizes content before it is sent to memcache to prevent injection … | n/a | n/a: no memcache or other cache server (decision 34: no Redis or queue until a need exists) | — |
| V1.3.10 | Format strings which might resolve in an unexpected or malicious way when used are … | open |  | — |
| V1.3.11 | The application sanitizes user input before passing to mail systems to protect against … | open | `step:P2.11` | P2.11 |
| V1.4.1 | The application uses memory-safe string, safer memory copy and pointer arithmetic to … | n/a | n/a: memory-safe runtime (Node.js); no native addon of ours, pg-native refused (ADR 0014) | — |
| V1.4.2 | Sign, range, and input validation techniques are used to prevent integer overflows | n/a | n/a: memory-safe runtime (Node.js); no native addon of ours, pg-native refused (ADR 0014) | — |
| V1.4.3 | Dynamically allocated memory and resources are released, and that references or pointers … | n/a | n/a: memory-safe runtime (Node.js); no native addon of ours, pg-native refused (ADR 0014) | — |
| V1.5.1 | The application configures XML parsers to use a restrictive configuration and that unsafe … | open |  | — |
| V1.5.2 | Deserialization of untrusted data enforces safe input handling, such as using an … | partial | `test:shared/ui/src/islands/readProps.test.ts#read_props_survives_dom_clobbering`, `test:shared/ui/islands/props.review.test.ts#accessors_are_refused_and_never_read_twice` | — |

## V2 Validation and Business Logic

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V2.1.1 | The application's documentation defines input validation rules for how to check the … | open |  | — |
| V2.1.2 | The application's documentation defines how to validate the logical and contextual … | open |  | — |
| V2.1.3 | Expectations for business logic limits and validations are documented, including both … | open |  | — |
| V2.2.1 | Input is validated to enforce business or functional expectations for that input | open |  | — |
| V2.2.2 | The application is designed to enforce input validation at a trusted service layer | partial | `test:shared/config/schema.test.ts#kinds_parse_strictly`, `test:domains/identity/syntax.test.ts#normalises_and_rejects` | — |
| V2.2.3 | The application ensures that combinations of related data items are reasonable according … | open |  | — |
| V2.3.1 | The application will only process business logic flows for the same user in the expected … | open |  | — |
| V2.3.2 | Business logic limits are implemented per the application's documentation to avoid … | open |  | — |
| V2.3.3 | Transactions are being used at the business logic level such that either a business logic … | partial | `test:tests/integration/postgres/pool.test.ts#tx_commit_and_rollback`, `test:tests/integration/postgres/migrate.test.ts#failing_migration_rolls_back` | — |
| V2.3.4 | Business logic level locking mechanisms are used to ensure that limited quantity … | partial | `test:tests/integration/postgres/single-use.test.ts#concurrent_consume`, `step:P1.17` | P1.17 |
| V2.4.1 | Anti-automation controls are in place to protect against excessive calls to application … | covered | `test:shared/http/limits/rateLimit.test.ts#bucket_allows_then_denies`, `test:shared/http/limits/rateLimit.test.ts#global_ceiling`, `test:shared/http/server.test.ts#rate_limit_required_and_known`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_rate_limit_auth_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_session_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_oauth_token_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_signup_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_reset_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_sync_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_blob_read_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_blob_upload_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_firehose_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_identity_zone`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_global_zone`, `test:deployment/edge/edge.test.ts#every_pds_route_has_a_zone` | — |

## V3 Web Frontend Security

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V3.2.1 | Security controls are in place to prevent browsers from rendering content or … | covered | `test:shared/http/csp/headers.test.ts#headers_on_every_response`, `test:interfaces/http/routes/assets.test.ts#content_type_fixed_with_nosniff` | — |
| V3.2.2 | Content intended to be displayed as text, rather than rendered as HTML, is handled using … | partial | `test:apps/web/render.test.tsx#island_props_xss_escaped`, `guard:inner-html` | P2.20 |
| V3.3.1 | Cookies have the 'Secure' attribute set, and if the '__Host-' prefix is not used for the … | covered | `test:interfaces/http/prefs/theme.test.ts#theme_cookie_attributes`, `test:interfaces/http/prefs/theme.test.ts#theme_cookie_is_host_only`, `guard:cookie-domain` | P2.03 |
| V3.3.2 | Each cookie's 'SameSite' attribute value is set according to the purpose of the cookie … | partial | `test:interfaces/http/prefs/theme.test.ts#theme_cookie_attributes`, `step:P2.03` | P2.03 |
| V3.3.3 | Cookies have the '__Host-' prefix for the cookie name unless they are explicitly designed … | covered | `test:interfaces/http/prefs/theme.test.ts#theme_cookie_is_host_only`, `guard:cookie-domain` | P2.03 |
| V3.3.4 | If the value of a cookie is not meant to be accessible to client-side scripts (such as a … | partial | `test:interfaces/http/prefs/theme.test.ts#theme_cookie_attributes`, `step:P2.03` | P2.03 |
| V3.4.1 | A Strict-Transport-Security header field is included on all responses to enforce an HTTP … | covered | `test:shared/http/csp/headers.test.ts#headers_on_every_response`, `test:shared/http/csp/headers.test.ts#handler_cannot_override` | — |
| V3.4.2 | The Cross-Origin Resource Sharing (CORS) Access-Control-Allow-Origin header field is a … | open |  | — |
| V3.4.3 | HTTP responses include a Content-Security-Policy response header field which defines … | covered | `test:shared/http/csp/policies.test.ts#snapshot_per_group`, `test:shared/http/csp/policies.test.ts#no_unsafe_tokens`, `test:shared/http/csp/headers.test.ts#error_pages_use_group_csp` | — |
| V3.4.4 | All HTTP responses contain an 'X-Content-Type-Options: nosniff' header field | covered | `test:shared/http/csp/headers.test.ts#headers_on_every_response`, `test:shared/http/csp/headers.test.ts#headers_failure_uses_static_set` | — |
| V3.4.5 | The application sets a referrer policy to prevent leakage of technically sensitive data … | covered | `test:shared/http/csp/headers.test.ts#headers_on_every_response`, `test:shared/http/csp/policies.test.ts#media_group` | — |
| V3.4.6 | The web application uses the frame-ancestors directive of the Content-Security-Policy … | partial | `test:shared/http/csp/policies.test.ts#snapshot_per_group`, `test:shared/http/csp/policies.test.ts#media_group` | — |
| V3.5.1 | Verify that, if the application does not rely on the CORS preflight mechanism to prevent … | covered | `test:shared/http/csrf/coverage.test.ts#every_post_route_gated`, `test:shared/http/csrf/gate.test.ts#sfs_cross_site_denies`, `test:shared/http/csrf/gate.test.ts#exception_denies` | — |
| V3.5.2 | Verify that, if the application relies on the CORS preflight mechanism to prevent … | open |  | — |
| V3.5.3 | HTTP requests to sensitive functionality use appropriate HTTP methods such as POST, PUT … | covered | `test:shared/http/csrf/coverage.test.ts#get_cannot_mutate`, `test:interfaces/http/routes/prefs.test.ts#prefs_get_405` | — |
| V3.5.4 | Separate applications are hosted on different hostnames to leverage the restrictions … | covered | `test:shared/http/config.test.ts#media_same_site_refused`, `test:shared/http/csp/policies.test.ts#media_group` | — |
| V3.5.5 | Messages received by the postMessage interface are discarded if the origin of the message … | n/a | n/a: no postMessage listener; islands talk to the server over HTTP only (guideline §1) | — |
| V3.7.1 | The application only uses client-side technologies which are still supported and … | open |  | — |
| V3.7.2 | The application will only automatically redirect the user to a different hostname or … | covered | `test:shared/http/returnPath.fuzz.test.ts#fuzz_same_origin`, `test:interfaces/http/routes/prefs.test.ts#prefs_return_path_rejects_offsite` | — |

## V4 API and Web Service

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V4.1.1 | Every HTTP response with a message body contains a Content-Type header field that matches … | partial | `test:interfaces/http/routes/assets.test.ts#content_type_fixed_with_nosniff` | — |
| V4.1.2 | Only user-facing endpoints (intended for manual web-browser access) automatically … | open |  | — |
| V4.1.3 | Any HTTP header field used by the application and set by an intermediary layer, such as a … | covered | `test:shared/http/trustedProxy.test.ts#header_ignored_from_untrusted_peer`, `test:shared/http/trustedProxy.test.ts#other_headers_ignored` | — |
| V4.2.1 | All application components (including load balancers, firewalls, and application servers) … | partial | `test:shared/http/server.test.ts#body_conflicting_headers_400`, `step:P1.28` | P1.28 |
| V4.3.1 | A query allowlist, depth limiting, amount limiting, or query cost analysis is used to … | n/a | n/a: no GraphQL; the read API is XRPC over HTTP | — |
| V4.3.2 | GraphQL introspection queries are disabled in the production environment unless the … | n/a | n/a: no GraphQL; the read API is XRPC over HTTP | — |
| V4.4.1 | WebSocket over TLS (WSS) is used for all WebSocket connections | open |  | — |
| V4.4.2 | Verify that, during the initial HTTP WebSocket handshake, the Origin header field is … | open |  | — |
| V4.4.3 | Verify that, if the application's standard session management cannot be used, dedicated … | open |  | — |
| V4.4.4 | Dedicated WebSocket session management tokens are initially obtained or validated through … | open |  | — |

## V5 File Handling

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V5.1.1 | The documentation defines the permitted file types, expected file extensions, and maximum … | open |  | — |
| V5.2.1 | The application will only accept files of a size which it can process without causing a … | partial | `test:shared/http/server.test.ts#body_413_streamed`, `step:P2.17` | P2.17 |
| V5.2.2 | When the application accepts a file, either on its own or within an archive such as a zip … | open |  | — |
| V5.2.3 | The application checks compressed files (e.g., zip, gz, docx, odt) against maximum … | open |  | — |
| V5.3.1 | Files uploaded or generated by untrusted input and stored in a public folder, are not … | open |  | — |
| V5.3.2 | When the application creates file paths for file operations, instead of user-submitted … | partial | `test:interfaces/http/routes/assets.test.ts#traversal_refused`, `test:interfaces/http/routes/assets.test.ts#unlisted_file_404` | P2.17 |
| V5.4.1 | The application validates or ignores user-submitted filenames, including in a JSON … | open |  | — |
| V5.4.2 | File names served (e.g., in HTTP response header fields or email attachments) are encoded … | open |  | — |
| V5.4.3 | Files obtained from untrusted sources are scanned by antivirus scanners to prevent … | open |  | — |

## V6 Authentication

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V6.1.1 | Application documentation defines how controls such as rate limiting, anti-automation … | open |  | — |
| V6.1.2 | A list of context-specific words is documented in order to prevent their use in passwords | open |  | — |
| V6.1.3 | Verify that, if the application includes multiple authentication pathways, these are all … | open |  | — |
| V6.2.1 | User set passwords are at least 8 characters in length although a minimum of 15 … | open |  | — |
| V6.2.2 | Users can change their password | open |  | — |
| V6.2.3 | Password change functionality requires the user's current and new password | open |  | — |
| V6.2.4 | Passwords submitted during account registration or password change are checked against an … | open |  | — |
| V6.2.5 | Passwords of any composition can be used, without rules limiting the type of characters … | open |  | — |
| V6.2.6 | Password input fields use type=password to mask the entry | open |  | — |
| V6.2.7 | "paste" functionality, browser password helpers, and external password managers are … | open |  | — |
| V6.2.8 | The application verifies the user's password exactly as received from the user, without … | open |  | — |
| V6.2.9 | Passwords of at least 64 characters are permitted | open |  | — |
| V6.2.10 | A user's password stays valid until it is discovered to be compromised or the user … | open |  | — |
| V6.2.11 | The documented list of context specific words is used to prevent easy to guess passwords … | open |  | — |
| V6.2.12 | Passwords submitted during account registration or password changes are checked against a … | open |  | — |
| V6.3.1 | Controls to prevent attacks such as credential stuffing and password brute force are … | partial | `test:shared/http/limits/rateLimit.test.ts#did_and_ip_both_apply`, `step:P2.05` | P2.05 |
| V6.3.2 | Default user accounts (e.g., "root", "admin", or "sa") are not present in the application … | open |  | — |
| V6.3.3 | Either a multi-factor authentication mechanism or a combination of single-factor … | open |  | — |
| V6.3.4 | Verify that, if the application includes multiple authentication pathways, there are no … | open |  | — |
| V6.4.1 | System generated initial passwords or activation codes are securely randomly generated … | open |  | — |
| V6.4.2 | Password hints or knowledge-based authentication (so-called "secret questions") are not … | open |  | — |
| V6.4.3 | A secure process for resetting a forgotten password is implemented, that does not bypass … | open |  | — |
| V6.4.4 | If a multi-factor authentication factor is lost, evidence of identity proofing is … | open |  | — |
| V6.5.1 | Lookup secrets, out-of-band authentication requests or codes, and time-based one-time … | partial | `test:tests/integration/postgres/single-use.test.ts#consume_twice`, `test:tests/integration/postgres/single-use.test.ts#concurrent_consume` | P2.11 |
| V6.5.2 | Verify that, when being stored in the application's backend, lookup secrets with less … | open |  | — |
| V6.5.3 | Lookup secrets, out-of-band authentication code, and time-based one-time password seeds … | open |  | — |
| V6.5.4 | Lookup secrets and out-of-band authentication codes have a minimum of 20 bits of entropy … | open |  | — |
| V6.5.5 | Out-of-band authentication requests, codes, or tokens, as well as time-based one-time … | partial | `test:tests/integration/postgres/single-use.test.ts#ttl_cap`, `test:tests/integration/postgres/single-use.test.ts#expired` | P2.11 |
| V6.6.1 | Authentication mechanisms using the Public Switched Telephone Network (PSTN) to deliver … | n/a | n/a: no phone or SMS codes | — |
| V6.6.2 | Out-of-band authentication requests, codes, or tokens are bound to the original … | partial | `test:tests/integration/postgres/single-use.test.ts#bind_mismatch_keeps_token`, `test:tests/integration/postgres/single-use.test.ts#purpose_mismatch` | P2.11 |
| V6.6.3 | A code based out-of-band authentication mechanism is protected against brute force … | open |  | — |
| V6.8.1 | Verify that, if the application supports multiple identity providers (IdPs), the user's … | partial | `test:domains/identity/verify-handle.test.ts#bidirectional_ok`, `test:domains/identity/verify-handle.test.ts#reverse_mismatch`, `step:P2.06` | P2.06 |
| V6.8.2 | The presence and integrity of digital signatures on authentication assertions (for … | open |  | — |
| V6.8.3 | SAML assertions are uniquely processed and used only once within the validity period to … | n/a | n/a: no SAML | — |
| V6.8.4 | Verify that, if an application uses a separate Identity Provider (IdP) and expects … | open |  | — |

## V7 Session Management

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V7.1.1 | The user's session inactivity timeout and absolute maximum session lifetime are … | open |  | — |
| V7.1.2 | The documentation defines how many concurrent (parallel) sessions are allowed for one … | open |  | — |
| V7.1.3 | All systems that create and manage user sessions as part of a federated identity … | open |  | — |
| V7.2.1 | The application performs all session token verification using a trusted, backend service | open |  | — |
| V7.2.2 | The application uses either self-contained or reference tokens that are dynamically … | open |  | — |
| V7.2.3 | If reference tokens are used to represent user sessions, they are unique and generated … | open | `step:P2.03` | P2.03 |
| V7.2.4 | The application generates a new session token on user authentication, including … | open | `step:P2.06` | P2.06 |
| V7.3.1 | There is an inactivity timeout such that re-authentication is enforced according to risk … | open |  | — |
| V7.3.2 | There is an absolute maximum session lifetime such that re-authentication is enforced … | open |  | — |
| V7.4.1 | When session termination is triggered (such as logout or expiration), the application … | open | `step:P2.08` | P2.08 |
| V7.4.2 | The application terminates all active sessions when a user account is disabled or deleted … | open |  | — |
| V7.4.3 | The application gives the option to terminate all other active sessions after a … | open | `step:P2.08` | P2.08 |
| V7.4.4 | All pages that require authentication have easy and visible access to logout functionality | open | `step:P2.13` | P2.13 |
| V7.4.5 | Application administrators are able to terminate active sessions for an individual user … | open |  | — |
| V7.5.1 | The application requires full re-authentication before allowing modifications to … | open |  | — |
| V7.5.2 | Users are able to view and (having authenticated again with at least one factor) … | open | `step:P2.08` | P2.08 |
| V7.6.1 | Session lifetime and termination between Relying Parties (RPs) and Identity Providers … | open |  | — |
| V7.6.2 | Creation of a session requires either the user's consent or an explicit action … | open | `step:P2.05` | P2.05 |

## V8 Authorization

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V8.1.1 | Authorization documentation defines rules for restricting function-level and … | open |  | — |
| V8.1.2 | Authorization documentation defines rules for field-level access restrictions (both read … | open |  | — |
| V8.2.1 | The application ensures that function-level access is restricted to consumers with … | partial | `test:shared/http/server.test.ts#route_must_declare_session`, `test:shared/http/server.test.ts#session_route_without_session_denies` | P2.03 |
| V8.2.2 | The application ensures that data-specific access is restricted to consumers with … | open |  | — |
| V8.2.3 | The application ensures that field-level access is restricted to consumers with explicit … | open |  | — |
| V8.3.1 | The application enforces authorization rules at a trusted service layer and doesn't rely … | partial | `test:shared/http/server.test.ts#session_route_without_session_denies`, `test:shared/http/csrf/coverage.test.ts#every_post_route_gated` | P2.03 |
| V8.4.1 | Multi-tenant applications use cross-tenant controls to ensure consumer operations will … | open |  | — |

## V9 Self-contained Tokens

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V9.1.1 | Self-contained tokens are validated using their digital signature or MAC to protect … | open |  | — |
| V9.1.2 | Only algorithms on an allowlist can be used to create and verify self-contained tokens … | open |  | — |
| V9.1.3 | Key material that is used to validate self-contained tokens is from trusted … | open |  | — |
| V9.2.1 | Verify that, if a validity time span is present in the token data, the token and its … | open |  | — |
| V9.2.2 | The service receiving a token validates the token to be the correct type and is meant for … | open |  | — |
| V9.2.3 | The service only accepts tokens which are intended for use with that service (audience) | open |  | — |
| V9.2.4 | Verify that, if a token issuer uses the same private key for issuing tokens to different … | open |  | — |

## V10 OAuth and OIDC

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V10.1.1 | Tokens are only sent to components that strictly need them | open | `step:P2.04` | P2.04 |
| V10.1.2 | The client only accepts values from the authorization server (such as the authorization … | open | `step:P2.06` | P2.06 |
| V10.2.1 | Verify that, if the code flow is used, the OAuth client has protection against … | open | `step:P2.04` | P2.04 |
| V10.2.2 | Verify that, if the OAuth client can interact with more than one authorization server, it … | open | `step:P2.06` | P2.06 |
| V10.3.1 | The resource server only accepts access tokens that are intended for use with that … | open |  | — |
| V10.3.2 | The resource server enforces authorization decisions based on claims from the access … | open |  | — |
| V10.3.3 | If an access control decision requires identifying a unique user from an access token … | open |  | — |
| V10.3.4 | Verify that, if the resource server requires specific authentication strength, methods … | open |  | — |
| V10.4.1 | The authorization server validates redirect URIs based on a client-specific allowlist of … | open |  | — |
| V10.4.2 | Verify that, if the authorization server returns the authorization code in the … | open |  | — |
| V10.4.3 | The authorization code is short-lived | open |  | — |
| V10.4.4 | For a given client, the authorization server only allows the usage of grants that this … | open |  | — |
| V10.4.5 | The authorization server mitigates refresh token replay attacks for public clients … | open |  | — |
| V10.4.6 | Verify that, if the code grant is used, the authorization server mitigates authorization … | open |  | — |
| V10.4.7 | If the authorization server supports unauthenticated dynamic client registration, it … | open |  | — |
| V10.4.8 | Refresh tokens have an absolute expiration, including if sliding refresh token expiration … | open |  | — |
| V10.4.9 | Refresh tokens and reference access tokens can be revoked by an authorized user using the … | open |  | — |
| V10.4.10 | Confidential client is authenticated for client-to-authorized server backchannel requests … | open |  | — |
| V10.4.11 | The authorization server configuration only assigns the required scopes to the OAuth … | open |  | — |
| V10.5.1 | The client (as the relying party) mitigates ID Token replay attacks | open | `step:P2.06` | P2.06 |
| V10.5.2 | The client uniquely identifies the user from ID Token claims, usually the 'sub' claim … | partial | `test:domains/identity/verify-handle.test.ts#bidirectional_ok`, `step:P2.06` | P2.06 |
| V10.5.3 | The client rejects attempts by a malicious authorization server to impersonate another … | open | `step:P2.04` | P2.04 |
| V10.5.4 | The client validates that the ID Token is intended to be used for that client (audience) … | open | `step:P2.06` | P2.06 |
| V10.5.5 | Verify that, when using OIDC back-channel logout, the relying party mitigates denial of … | n/a | n/a: no OIDC back-channel logout; atproto OAuth has none | — |
| V10.6.1 | The OpenID Provider only allows values 'code', 'ciba', 'id_token', or 'id_token code' for … | open |  | — |
| V10.6.2 | The OpenID Provider mitigates denial of service through forced logout | open |  | — |
| V10.7.1 | The authorization server ensures that the user consents to each authorization request | open |  | — |
| V10.7.2 | When the authorization server prompts for user consent, it presents sufficient and clear … | open |  | — |
| V10.7.3 | The user can review, modify, and revoke consents which the user has granted through the … | open |  | — |

## V11 Cryptography

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V11.1.1 | There is a documented policy for management of cryptographic keys and a cryptographic key … | open | `step:P5.06` | P5.06 |
| V11.1.2 | A cryptographic inventory is performed, maintained, regularly updated, and includes all … | open | `step:P5.06` | P5.06 |
| V11.2.1 | Industry-validated implementations (including libraries and hardware-accelerated … | open | `step:P1.14` | P1.14 |
| V11.2.2 | The application is designed with crypto agility such that random number, authenticated … | open |  | — |
| V11.2.3 | All cryptographic primitives utilize a minimum of 128-bits of security based on the … | open |  | — |
| V11.3.1 | Insecure block modes (e.g., ECB) and weak padding schemes (e.g., PKCS#1 v1.5) are not used | open |  | — |
| V11.3.2 | Only approved ciphers and modes such as AES with GCM are used | open | `step:P1.14` | P1.14 |
| V11.3.3 | Encrypted data is protected against unauthorized modification preferably by using an … | open | `step:P1.14` | P1.14 |
| V11.4.1 | Only approved hash functions are used for general cryptographic use cases, including … | open |  | — |
| V11.4.2 | Passwords are stored using an approved, computationally intensive, key derivation … | partial | `test:infrastructure/postgres/roles.test.ts#scram_verifier_matches_vector`, `test:tests/integration/postgres/migrate.test.ts#scram_only` | — |
| V11.4.3 | Hash functions used in digital signatures, as part of data authentication or data … | open |  | — |
| V11.4.4 | The application uses approved key derivation functions with key stretching parameters … | open |  | — |
| V11.5.1 | All random numbers and strings which are intended to be non-guessable must be generated … | partial | `test:infrastructure/postgres/roles.test.ts#verifier_salt_is_random`, `test:tests/integration/postgres/single-use.test.ts#issue_retries_one_collision` | P1.14 |
| V11.6.1 | Only approved cryptographic algorithms and modes of operation are used for key generation … | open |  | — |

## V12 Secure Communication

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V12.1.1 | Only the latest recommended versions of the TLS protocol are enabled, such as TLS 1.2 and … | open | `step:P1.28` | P1.28 |
| V12.1.2 | Only recommended cipher suites are enabled, with the strongest cipher suites set as … | open | `step:P1.28` | P1.28 |
| V12.1.3 | The application validates that mTLS client certificates are trusted before using the … | open |  | — |
| V12.2.1 | TLS is used for all connectivity between a client and external facing, HTTP-based … | partial | `test:infrastructure/net-guard/src/request.test.ts#scheme_and_port`, `step:P1.28` | P1.28 |
| V12.2.2 | External facing services use publicly trusted TLS certificates | partial | `test:deployment/edge/edge.test.ts#edge_tls_issuer_letsencrypt`, `step:P1.34` | P1.34 |
| V12.3.1 | An encrypted protocol such as TLS is used for all inbound and outbound connections to and … | partial | `test:infrastructure/postgres/config.test.ts#sslmode_disable_refused_for_dotted_or_ip_host`, `test:infrastructure/pds/identity-network.test.ts#public_is_https_without_userinfo` | P1.28 |
| V12.3.2 | TLS clients validate certificates received before communicating with a TLS server | covered | `test:infrastructure/net-guard/src/review.limits.test.ts#untrusted_certificate_is_tls`, `test:infrastructure/postgres/config.test.ts#sslrootcert_passed_as_ca` | — |
| V12.3.3 | TLS or another appropriate transport encryption mechanism used for all connectivity … | partial | `test:shared/http/config.test.ts#plain_http_only_in_dev`, `test:infrastructure/postgres/config.test.ts#migrate_config_plain_tcp_only_inside_compose` | P1.28 |
| V12.3.4 | TLS connections between internal services use trusted certificates | open |  | — |

## V13 Configuration

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V13.1.1 | All communication needs for the application are documented | open |  | — |
| V13.2.1 | Communications between backend application components that don't support the … | open |  | — |
| V13.2.2 | Communications between backend application components, including local or operating … | covered | `test:tests/integration/postgres/grants.test.ts#matrix_matches`, `test:tests/integration/postgres/grants.test.ts#no_ddl_for_services`, `test:tests/integration/setup/pg.setup.test.ts#test_files_never_superuser` | — |
| V13.2.3 | If a credential has to be used for service authentication, the credential being used by … | partial | `test:shared/config/schema.test.ts#secret_has_no_default`, `test:tests/integration/postgres/grants.test.ts#no_password_no_login` | — |
| V13.2.4 | An allowlist is used to define the external resources or systems with which the … | covered | `guard:egress`, `test:infrastructure/net-guard/src/request.test.ts#fixed_policy`, `test:infrastructure/net-guard/src/fetch.test.ts#no_model_provider_policy` | P1.18b |
| V13.2.5 | The web or application server is configured with an allowlist of resources or systems to … | partial | `guard:egress`, `test:infrastructure/net-guard/src/request.test.ts#fixed_policy`, `step:P1.18b` | P1.18b |
| V13.3.1 | A secrets management solution, such as a key vault, is used to securely create, store … | partial | `test:shared/config/load.test.ts#secret_in_env_forbidden_in_prod`, `test:shared/config/load.test.ts#secret_file_read`, `step:P5.06` | P5.06 |
| V13.3.2 | Access to secret assets adheres to the principle of least privilege | partial | `test:shared/config/load.test.ts#secret_file_world_writable_is_unreadable`, `test:deployment/preflight/preflight.test.ts#c9_secret_file_fails`, `step:P5.06` | P5.06 |
| V13.4.1 | The application is deployed either without any source control metadata, including the … | open | `step:P1.27` | P1.27 |
| V13.4.2 | Debug modes are disabled for all components in production environments to prevent … | covered | `test:shared/log/logger.test.ts#logger_no_stack_message_in_prod`, `test:shared/http/server.test.ts#error_hides_exception`, `test:shared/http/config.test.ts#dev_origin_refused_in_prod`, `test:deployment/preflight/preflight.test.ts#c12_log_enabled_fails`, `test:deployment/preflight/preflight.test.ts#c14_dev_mode_fails` | — |
| V13.4.3 | Web servers do not expose directory listings to clients unless explicitly intended | covered | `test:interfaces/http/routes/assets.test.ts#unlisted_file_404`, `test:interfaces/http/routes/assets.test.ts#traversal_refused` | — |
| V13.4.4 | Using the HTTP TRACE method is not supported in production environments, to avoid … | partial | `test:shared/http/server.test.ts#method_put_405`, `test:shared/http/server.test.ts#method_mismatch_405` | — |
| V13.4.5 | Documentation (such as for internal APIs) and monitoring endpoints are not exposed unless … | partial | `test:shared/http/server.test.ts#health_reads_no_request_input`, `test:interfaces/http/routes.manifest.test.ts#route_manifest_matches`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_admin_api_off`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_logs_no_client_address` | — |

## V14 Data Protection

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V14.1.1 | All sensitive data created and processed by the application has been identified and … | partial | `test:tests/integration/postgres/grants.test.ts#personal_data_by_column_list`, `test:tests/integration/postgres/did-columns.test.ts#registry_complete`, `test:tests/integration/postgres/sealed-columns.test.ts#sealed_columns_registry` | P1.14d |
| V14.1.2 | All sensitive data protection levels have a documented set of protection requirements | open |  | — |
| V14.2.1 | Sensitive data is only sent to the server in the HTTP message body or header fields, and … | open |  | — |
| V14.2.2 | The application prevents sensitive data from being cached in server components, such as … | open |  | — |
| V14.2.3 | Defined sensitive data is not sent to untrusted parties (e.g., user trackers) to prevent … | open |  | — |
| V14.2.4 | Controls around sensitive data related to encryption, integrity verification, retention … | partial | `test:tests/integration/postgres/grants.test.ts#personal_data_by_column_list`, `doc:docs/human/db/erasure.md` | P5.09 |
| V14.3.1 | Authenticated data is cleared from client storage, such as the browser DOM, after the … | open |  | — |
| V14.3.2 | The application sets sufficient anti-caching HTTP response header fields (i.e. … | open |  | — |
| V14.3.3 | Data stored in browser storage (such as localStorage, sessionStorage, IndexedDB, or … | partial | `test:interfaces/http/prefs/theme.test.ts#parse_theme_allowlist_only`, `step:P2.03` | P2.03 |

## V15 Secure Coding and Architecture

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V15.1.1 | Application documentation defines risk based remediation time frames for 3rd party … | open |  | — |
| V15.1.2 | An inventory catalog, such as software bill of materials (SBOM), is maintained of all … | partial | `doc:.github/workflows/ci.yml`, `step:P1.27` | P1.27 |
| V15.1.3 | The application documentation identifies functionality which is time-consuming or … | open |  | — |
| V15.2.1 | The application only contains components which have not breached the documented update … | open |  | — |
| V15.2.2 | The application has implemented defenses against loss of availability due to … | open |  | — |
| V15.2.3 | The production environment only includes functionality that is required for the … | partial | `test:interfaces/http/main.test.ts#prod_entry_imports_no_app_source`, `test:apps/web/render.test.tsx#island_props_too_large_prod` | P1.27 |
| V15.3.1 | The application only returns the required subset of fields from a data object | open | `step:P2.20` | P2.20 |
| V15.3.2 | Where the application backend makes calls to external URLs, it is configured to not … | covered | `test:infrastructure/net-guard/src/request.test.ts#no_redirects`, `test:infrastructure/net-guard/src/fetch.test.ts#no_redirects` | — |
| V15.3.3 | The application has countermeasures to protect against mass assignment attacks by … | open |  | — |
| V15.3.4 | All proxying and middleware components transfer the user's original IP address correctly … | covered | `test:shared/http/trustedProxy.test.ts#header_rightmost`, `test:shared/http/trustedProxy.test.ts#header_ignored_from_untrusted_peer`, `test:shared/http/server.test.ts#trusted_proxy_on_every_route_but_health` | P1.28 |
| V15.3.5 | The application explicitly ensures that variables are of the correct type and performs … | partial | `lint:noExplicitAny`, `test:shared/config/schema.test.ts#int_and_url_refuse_lax_forms` | — |
| V15.3.6 | JavaScript code is written in a way that prevents prototype pollution, for example, by … | partial | `test:shared/ui/islands/props.test.ts#proto_key_roundtrip`, `test:shared/ui/islands/props.keys.test.ts#escaped_keys_are_refused` | — |
| V15.3.7 | The application has defenses against HTTP parameter pollution attacks, particularly if … | open |  | — |

## V16 Security Logging and Error Handling

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V16.1.1 | An inventory exists documenting the logging performed at each layer of the application's … | partial | `test:shared/log/logger.test.ts#logger_unknown_event`, `test:shared/log/logger.test.ts#logger_drops_unlisted` | — |
| V16.2.1 | Each log entry includes necessary metadata (such as when, where, who, what) that would … | open |  | — |
| V16.2.2 | Time sources for all logging components are synchronized, and that timestamps in security … | open |  | — |
| V16.2.3 | The application only stores or broadcasts logs to the files and services that are … | open |  | — |
| V16.2.4 | Logs can be read and correlated by the log processor that is in use, preferably by using … | open |  | — |
| V16.2.5 | When logging sensitive data, the application enforces logging based on the data's … | covered | `test:shared/log/logger.test.ts#logger_drops_unlisted`, `test:shared/log/logger.test.ts#word_fields_refuse_identifiers`, `test:shared/http/server.test.ts#salt_never_logged`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_all_logs_have_no_ip_path_or_query`, `test:tests/integration/deployment/edge/edge.image.test.ts#edge_logs_no_client_address` | — |
| V16.3.1 | All authentication operations are logged, including successful and unsuccessful attempts | open | `step:P2.06` | P2.06 |
| V16.3.2 | Failed authorization attempts are logged | partial | `test:shared/log/logger.test.ts#logger_csrf_event`, `test:shared/log/logger.test.ts#logger_rate_limit_events` | P2.03 |
| V16.3.3 | The application logs the security events that are defined in the documentation and also … | partial | `test:shared/log/logger.test.ts#logger_csrf_event`, `test:shared/log/logger.test.ts#logger_csp_event` | — |
| V16.3.4 | The application logs unexpected errors and security control failures such as backend TLS … | partial | `test:infrastructure/net-guard/src/review.request.test.ts#event_matches_log_ruling`, `test:shared/http/server.test.ts#untrusted_peer_logged_once_per_minute` | — |
| V16.4.1 | All logging components appropriately encode data to prevent log injection | covered | `test:shared/log/logger.test.ts#logger_truncates_and_strips_control_characters`, `test:shared/log/logger.test.ts#logger_one_line`, `test:shared/log/logger.hardening.test.ts#logger_scrubs_before_truncating` | — |
| V16.4.2 | Logs are protected from unauthorized access and cannot be modified | open | `step:P1.15` | P1.15 |
| V16.4.3 | Logs are securely transmitted to a logically separate system for analysis, detection … | open |  | — |
| V16.5.1 | A generic message is returned to the consumer when an unexpected or security-sensitive … | covered | `test:shared/http/server.test.ts#error_hides_exception`, `test:shared/http/server.test.ts#not_found_404_no_reflection`, `test:shared/errors/errors.test.ts#app_error_message_is_code` | — |
| V16.5.2 | The application continues to operate securely when external resource access fails, for … | partial | `test:shared/http/server.test.ts#request_deadline_503`, `test:infrastructure/postgres/pool.test.ts#unreachable_server_is_db_busy`, `test:apps/web/src/islands/runtime/hydrate.test.tsx#bootstrap_isolates_failure_unit` | P2.07 |
| V16.5.3 | The application fails gracefully and securely, including when an exception occurs … | covered | `test:shared/http/csrf/gate.test.ts#exception_denies`, `test:shared/http/limits/rateLimit.test.ts#exception_denies`, `test:domains/identity/verify-handle.test.ts#never_throws` | — |

## V17 WebRTC

| id | requirement (short) | status | evidence | step |
|---|---|---|---|---|
| V17.1.1 | The Traversal Using Relays around NAT (TURN) service only allows access to IP addresses … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.2.1 | The key for the Datagram Transport Layer Security (DTLS) certificate is managed and … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.2.2 | The media server is configured to use and support approved Datagram Transport Layer … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.2.3 | Secure Real-time Transport Protocol (SRTP) authentication is checked at the media server … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.2.4 | The media server is able to continue processing incoming media traffic when encountering … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.3.1 | The signaling server is able to continue processing legitimate incoming signaling … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
| V17.3.2 | The signaling server is able to continue processing legitimate signaling messages when … | n/a | n/a: no WebRTC in v1; voice is a later chat slice (plan §5 chat), which reopens these rows | — |
