# 0086 — The chat servers: our own Synapse image, upstream MAS, reviewed config files, internal-only MAS listeners

Status: Accepted by Alex 2026-11-21 19:30Z in substance, with decision 2's change, which he chose on the decision
card at 19:37Z ("Guard only the security settings"); proposed 2026-11-21 (P6.02); Decision 1 revised the same day on
Alex's call below. Builds on ADR 0025 (the chat server name) and the chat build
plan's step 1 (2026-11-21), and alongside ADRs 0081 to 0085 (chat sessions, the service split, the server rule).

## Context

Chat needs Synapse 1.165.0, the latest stable release (pypi.org/pypi/matrix-synapse, 2026-11-10), and MAS 1.26.0.
Both are configured, not coded: every security property in the build plan's step 1 tables is a setting. Four facts
read in the pinned sources decide how they run:

- Upstream's Synapse image fails our image scan: Trivy 0.76.1 found 132 HIGH or CRITICAL fixable findings in
  v1.162.0 and 76 in v1.165.0 (2026-11-21), a CRITICAL among them in the Go runtime of its `gosu`. It also starts
  through `start.py`, which reads `SYNAPSE_CONFIG_PATH`, `SYNAPSE_WORKER`, `UID` and `GID` (synapse
  `docker/start.py:234-314` at v1.165.0) and uses `gosu` to drop root.
- MAS merges every `MAS_*` variable into its config and splits `MAS_CONFIG` on `:` into several files
  (`crates/cli/src/commands/mod.rs:90-109` at v1.26.0). A setting can therefore ride in beside the file through the
  environment.
- MAS with no subcommand runs the server (same file, `None => server`), so our Compose subset's ban on `command`
  needs no image of our own.
- A MAS listener binds addresses, not networks. A container on two networks answers every listener on both unless
  each listener binds only that network's address. chat-admin's calls need a client-credentials token, which only
  the `oauth` resource serves (`docs/topics/admin-api.md` at v1.26.0).

## Decision

1. **Images.** Alex's call, 2026-11-21 01:28Z, on the decision card after the scan above ("Build our own Synapse
   image"): "We build Synapse from pinned, hash-checked packages on our own base, on the latest stable release, so
   most findings go. Anything left gets a short waiver for you to review." So `deployment/images/synapse.Dockerfile`
   builds Synapse 1.165.0 on the official `python:3.13-slim-trixie` image (index digest
   `sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90`, mirrored and locked like our other
   bases). Its Python packages are one hash-pinned lock, `synapse-requirements.txt`, installed with
   `--require-hashes --no-deps --only-binary :all:`: no resolution, no source build, and no optional extra, so
   authlib (OIDC and JWT sign-in, `synapse/handlers/oidc.py` and `jwt.py`, imported only when those are configured)
   and pysaml2 are not there. The PostgreSQL driver is `psycopg2-binary`, whose wheel carries libpq (17.11 in 2.9.13),
   because the final stage installs no OS package (images.test.ts); the cost is that libpq and its OpenSSL are
   inside the wheel, where the image scan does not see their versions, so a libpq fix arrives with a psycopg2
   release. The image runs `python -m synapse.app.homeserver -c /config/homeserver.yaml` as 991, with no `start.py`,
   `gosu`, pip, apt or dpkg, no setuid file, and without Synapse's manhole module (an SSH Python shell whose file
   holds a fixed RSA key). It carries the server rule, `infrastructure/matrix/synapse-module/` (ADR 0085). Built and
   scanned on 2026-11-21, its one finding was zlib1g CVE-2026-85091 from the base, which its final stage upgrades
   under the zlib exception (Alex, 2026-11-16); `.github/trivyignore.python.yaml` waives it for the base's own scan
   only, to the same expiry.
   MAS runs its upstream image as shipped (`ghcr.io/element-hq/matrix-authentication-service:1.26.0`, index digest
   `sha256:e089f1048a1d4a9a492ed17b9fe759100f1bd619407b001f5927928d88b780c4`, read from the registry on
   2026-11-21), mirrored by digest as the PDS and Newt are (`deployment/mirror.list.json`, ADR 0033); its first
   scan is the mirror workflow's.
2. **Config files.** Each server reads one reviewed file from the checkout, `deployment/chat/<env>/`, mounted
   read-only, with secrets only as paths under `/run/secrets`. Preflight C36 refuses a stack whose synapse service
   sets any variable (its config path is the image's entrypoint) or whose mas service sets one beside `MAS_CONFIG`,
   reads an env file, or mounts a file that differs from the reviewed security values or holds a key the
   check does not list. The server name follows ADR 0025: `staging.unset.cc` under dev, `unset.cc` under prod; local
   has no chat server until it is ruled.

   While settings are tuned (Alex, 2026-11-21 19:37Z, "Guard only the security settings"), C36 splits each file's
   keys in two (`deployment/preflight/checks/chat.ts`, `Settings`):
   - Security settings are held to their exact value, always: the listeners and binds, the server name and base URL,
     federation and key servers, registration and guest access, encryption, search, previews, media, push content,
     the pusher range, MAS, the module, retention, profile lookups, the user directory, how long addresses are kept,
     logging and stats; for MAS its http, matrix, passwords and account security settings. The database, secret,
     client and policy shape checks stay as they were.
   - Tuning settings are named in an allowlist and may take any value: push on and its unread count, and Synapse's
     message, room, join, invite, profile, redaction and key-request rate limits. Display name and avatar changes,
     per-room profiles and MAS's display name changes are security settings, held at false: the display name is the
     member's verified handle, so a member who could change it could show someone else's handle as their own.
   - A key in neither list is refused, so a new tuning setting is one name added to the list.
   The full exact-match check is held while settings are tuned and turned back on when Alex says they are final.
3. **Databases.** Each server has its own database and role in our existing Postgres, with its password in a file
   (libpq `passfile` for Synapse, `password_file` for MAS). No trust authentication.
4. **Networks.** No chat network reaches the outside. MAS has no route from the edge and two listeners, each bound to
   MAS's fixed address on one internal network: `discovery`, `oauth` and `health` at 10.250.38.3:8080 on the network
   it shares with Synapse, and `oauth` and `adminapi` at 10.250.38.11:8081 on the network it shares with chat-admin
   alone. `human`, `graphql`, `assets` and `compat` are mounted nowhere. Synapse has one client listener and no
   federation listener; the edge and the door reach only that.

## Alternatives

- **Upstream's Synapse image by digest.** Fails the image scan (Context); waiving 76 findings, `gosu` included, is
  not a short review. Rejected by Alex's call.
- **psycopg2 built from source, with libpq from Debian.** The scan would see libpq, but the final stage would have to
  install `libpq5` and its Kerberos and LDAP libraries, which no image kind may. Left for a later change to that rule.
- **Our own MAS image with `CMD ["server"]`.** Not needed: MAS's default subcommand is the server.
- **MAS listeners on every address, separated by port only.** Synapse's network would reach the admin API's port.
  Rejected; the bind addresses are what keeps the admin API on chat-admin's network.
- **`adminapi` alone on chat-admin's listener (the build plan's table).** chat-admin could then not get its token
  without joining Synapse's network. Adding `oauth` there exposes nothing chat-admin's network did not need.
- **Settings through the environment.** Both servers accept them, but a variable is easy to add unreviewed beside a
  reviewed file. Refused by C36 instead.

## Consequences

- A change to a chat setting is a change to the file and to C36's list, reviewed together; C36's unit tests run the
  committed files through the same rules, Synapse's in YAML 1.1 as its PyYAML reads it.
- Alex allowed plain rooms with a 30-day auto-delete (2026-11-21, P6.10a): the server rule `RoomPolicy` encrypts every
  room not asked for as plain, so C36 requires `encryption_enabled_by_default_for_room_type: "off"`, `enable_search:
  false`, and `retention` with only `allowed_lifetime_max: 30d` and one unbounded 12-hour purge job, never a
  `default_policy` (synapse `config_documentation.md`, `retention` and `enable_search`, at v1.165.0). A stack without
  the rule, or with it configured, never starts.
- The Synapse admin API is mounted on its client listener (Synapse mounts it with `client`); the edge must deny
  `/_synapse/*` when the chat site is added.
- Synapse's discovery document advertises MAS's internal name as issuer. Clients never talk to MAS (build plan step 2), so
  this is not a public address.
- MAS logs `client.address` on each response at WARN. With no edge route, that address is Synapse's or chat-admin's.

## Compliance

`deployment/preflight/checks/chat.ts` (C36) and `chat.test.ts`; `deployment/images/synapse.test.ts` (what the image
installs and how it starts) and `synapse.image.test.ts` (the built image runs `deployment/chat/dev/homeserver.yaml`
against Postgres with the server rule, and stops when the rule is misconfigured); the image rules in `images.test.ts`
and `package-manager.image.test.ts`. The Compose wiring and an image test that runs MAS with these listeners land with
the servers' Compose services, once the mirror holds both images.

## Follow-up

2026-11-21: MAS pinned at 1.29.0 (Alex, 2026-11-21, 'use the latest version'), re-checked: `crates/cli/src/commands/mod.rs` (`MAS_*` merge, `MAS_CONFIG`, default subcommand) and `crates/handlers` listener resources are unchanged; `docs/config.schema.json` only reorders keys and adds `rate_limiting.username_availability`, which `deployment/chat/dev/mas.yaml` does not set; the image still runs as `nonroot` (`Dockerfile:200`, was 199). Index digest `sha256:9247315c9e86096aaaa393c7b4b685dc506010e09ff4b89331ef2ed4854167af`, matching the registry; 1.29.0 is the latest stable release (1.30.0-rc.0 is a release candidate). Synapse 1.165.0 is still the latest stable on PyPI. Read from the v1.26.0 and v1.29.0 source trees on 2026-11-21; no live run of 1.29.0 was possible here (the image pull and the release binary download were both refused), so the 1.29.0 behaviour is unverified until the image test runs it.

## Notes appended after acceptance

2026-11-21: Decision 1's base changes. The Synapse image now runs on Google's distroless
`gcr.io/distroless/python3-debian13:nonroot` (index digest
`sha256:6c4cb3bfa4b555429dd19541796a6ba6b30c84675b460bd0bd5072f7d5bdae71`), Debian's own python3.13 3.13.5 with no
pip, shell, apt or dpkg, and `python:3.13-slim-trixie` (`e48f59cd…`) is a build-only base that makes the venv. Alex's
call, on the card of 2026-11-21 20:08Z: "Yes, use distroless". Why: every `python:*` image ships pip, whose vendored
SBOM (`pip/_vendor/bom.cdx.json`) fails the mirror scan on five HIGH findings (msgpack 1.1.2 CVE-2026-114613 and
GHSA-6v7p-g79w-8964, setuptools 70.3.0 CVE-2025-47273, urllib3 2.7.0 CVE-2026-97687 and CVE-2026-97689), and pip 26.3
(2026-11-02) still vendors setuptools 70.3.0, so no newer python digest fixes it; Alex refused a waiver for them.
Distroless documents this pairing (GoogleContainerTools/distroless `python3/README.md`, "Compatibility", read
2026-11-21). Scanned with Trivy 0.76.1 (HIGH,CRITICAL, `--ignore-unfixed`, no ignore file, no skips) on 2026-11-21:
the distroless base and the built Synapse image both have 0 findings, its zlib1g is already deb13u1, and the image's
exported filesystem has no secret and no setuid or setgid file. So the final stage runs nothing, the zlib exception no
longer covers the synapse kind, and `.github/trivyignore.python.yaml` is gone; distroless joins `VENDOR_BASES` as a
runtime base, by its exact name.
