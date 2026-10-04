# Glossary

One sentence per word. The code, the comments and this book spell these the same way. A reader who meets a
word in the code that is not here and not plain English has found a defect: add it here in the same PR.

## AT Protocol (atproto)

| Word | Meaning |
|---|---|
| **DID** | A permanent account identifier (`did:plc:…` or `did:web:…`); it never changes when the handle changes. |
| **DID document** | The public record a DID resolves to: the account's handle claim (`alsoKnownAs`), signing key and PDS address. |
| **PLC** | The directory that stores `did:plc` documents; changes are signed operations; read replicas may lag. |
| **handle** | A human-readable name (`alice.0x40.me`) that must be verified both ways: handle → DID and DID → handle. |
| **`verifyHandle`** | Our one function that does that two-way check; nothing else reads `alsoKnownAs`. |
| **PDS** | Personal Data Server: hosts accounts and their repos, runs sign-in. Ours is `unset.ac` (production) and `0x40.space` (development). |
| **repo** | An account's public, signed data store on its PDS; everything in it is public and copied by relays. |
| **record** | One item in a repo, stored under a collection and a record key. |
| **collection / NSID** | The record type's namespaced id, for example `sh.unset.video` or `app.bsky.feed.like`. |
| **rkey** | Record key: the record's name inside its collection (`self`, or a time-based TID). |
| **TID** | A time-ordered record key. |
| **AT-URI** | A record's address: `at://<did>/<collection>/<rkey>`. |
| **CID** | A content hash of one version of a record or blob; it changes on every edit (so never key likes on it). |
| **rev** | A repo's revision; increases with every commit; the indexer uses it to refuse older updates. |
| **blob** | A binary file (image, video) stored by the PDS and referenced from a record by CID. |
| **`getBlob`** | The PDS endpoint that serves blobs to anyone, unauthenticated; never linked to browsers. |
| **`applyWrites`** | One PDS call that creates, updates or deletes several records atomically. |
| **lexicon** | The schema of a record type or API method. |
| **permission set** | A published bundle of OAuth scopes (`include:sh.unset.…`) shown to users as one consent line. |
| **lexicon authority** | The DID that owns and publishes our `sh.unset.*` schemas, named by the `_lexicon` DNS record. |
| **XRPC** | atproto's HTTP API style: `/xrpc/<method NSID>`. |
| **service auth** | A short-lived token a user's PDS signs so another service can trust the request is from that user. |
| **DPoP** | A proof that ties OAuth tokens to a key held by our server, so stolen tokens are useless alone. |
| **relay** | A service that aggregates repo changes from many PDSes into one firehose. |
| **firehose** | The stream of repo commits and account/identity events. |
| **Tap** | Bluesky's reference consumer that verifies the firehose, backfills repos and delivers events with acknowledgements. |
| **`#account` / `#identity` event** | Firehose events saying an account's status changed / its handle or DID document changed. |
| **AppView** | A service that indexes records and serves views (Bluesky's is `api.bsky.app`). |
| **feed generator** | A service that returns a list of post URIs for a feed; the app fills in the posts. |
| **labeler** | A service that publishes moderation labels; ours is Ozone. |
| **label** | A signed tag on an account or record (for example "hide" or a warning). |
| **Ozone** | Bluesky's open-source moderation service, run as our labeler and public-record report intake. |
| **Spaces** | An alpha atproto feature for permissioned data. The destination for private data (decision 38, ADR 0005), but not used until it is in an official PDS release and the spec (checked at P4.00); until then private records stay in our DB, shaped for a copy. |

## Matrix (chat)

| Word | Meaning |
|---|---|
| **homeserver** | The Matrix server holding accounts and rooms; ours is Synapse. |
| **MAS** | Matrix Authentication Service: the OAuth/OIDC sign-in in front of Synapse. |
| **MXID** | A Matrix user id, `@alice:unset.sh`. |
| **`server_name`** | The domain in every MXID; permanent once accounts exist. |
| **device** | One signed-in client; encryption keys are per device. |
| **cross-signing** | The user's keys that vouch for their own devices. |
| **recovery key / 4S** | The key that unlocks Secure Secret Storage, which holds the cross-signing keys and the key-backup key. |
| **Megolm** | The group encryption scheme; room keys go only to devices that exist when a message is sent. |
| **`history_visibility`** | Who can read a room's earlier messages; set at creation. |
| **`join_rules`** | Who may join a room; pinned at power level 100. |
| **power level (PL)** | A member's rights in a room, 0–100. |
| **message request** | The invite that starts every direct conversation (whoever sends it, followed or not); it carries no text until accepted (decision 12). |
| **`chat-auth`** | Our bridge that signs a member into MAS with their atproto identity (`sub` = DID). |
| **`chat-admin`** | Our isolated service that creates (seeds) a member's chat account; it holds MAS admin rights, `web` does not. |

## unset.sh

| Word | Meaning |
|---|---|
| **draft** | Content kept privately in our database; never in a repo. |
| **publish** | Writing records to the user's repo, after review where required; makes them public everywhere. |
| **unpublish** | Deleting those records from the repo and keeping the content as a draft. |
| **review** | The checks a post or comment passes before publish, all on our own servers: fingerprints, image gate, text gate, a person if unsure (nothing goes to a model provider in v1). |
| **image gate** | P4.08: local nudity (NudeNet class) and gore (hold-only) models on every frame or image submitted for publication. |
| **text gate** | P4.09a (`textGate`): local rules, Detoxify and Llama Guard 3 1B on every published text field; answers allow, hold, block or `suspected_csam`. |
| **shadow mode** | `REVIEW_MODE = shadow`: every automated allow or block goes to a person, so the models are measured before they decide alone. |
| **suspected material** | Child sexual abuse material suspected by a local check or a person without a fingerprint match; it takes P4.07's emergency path (block, legal hold with subject kind `suspected`, immediate `csam_emergency` alert, report case, upload freeze, `csam.suspected` audit). |
| **fingerprint** | A PDQ perceptual hash, computed locally (P2.16b) for each image and for frames taken from each video, and compared with known abuse material; no MD5 or TMK is checked. |
| **`FingerprintCheck`** | The interface of the fingerprint check stage: `check(hashes)` answers `clear`, `match` (with a classification such as `harmful-abusive-material`) or `unavailable` and never throws; a fake from Phase 2, the real Arachnid client from P5.07b, and production refuses to boot without the real one. |
| **Arachnid Shield** | The Canadian Centre for Child Protection's service our PDQ fingerprints are checked against (real client in P5.07b); media never leaves. |
| **legal hold** | Preservation after a fingerprint match, a report or suspected material (Bill C-16): material sealed with `sealTo` to the offline legal-hold key in P4.07's one table, kept until one year after notification on `pds-admin`'s clock (`preserve.*` verbs, P3.16c, code name `LegalHold`); no verb shortens it and no server can decrypt it. Only a named owner's own `legal_hold_reader` login exports it (ciphertext, offline CLI); `admin` sees hold metadata only. |
| **delete hold** | Not a legal hold: the 7-day wait (or second person's approval) before `pds-admin` deletes an account (`hold.*` verbs, P3.16a, code name `DeleteHold`). |
| **transmission data** | The uploader's address, time and route, sealed to the legal-hold key into a short-lived buffer for every upload; a match moves it unchanged into the legal hold, anything else destroys it within minutes (decision 21). |
| **delist** | Removing an account from our directory and feeds without touching its repo. |
| **takedown** | A PDS-level action that stops an account or record being served. |
| **seal** | Our envelope encryption (`seal`/`unseal`, AES-256-GCM with a key-encryption key and key id, bound to a column context; P1.14), with one chunked form `sealStream`/`unsealStream` (format `s1c`) for data over 1 MiB. |
| **`sealTo`** | Encrypt-only sealing to the offline legal-hold public key (age X25519, P1.14a), called `sealTo(recipients, plaintext, context)`, with the streaming form `sealToStream` for held media of any size; no server can open it. |
| **net-guard** | Our one egress module (`guardedFetch`, `guardedRequest`): resolve, vet, pin, no redirects, caps; a proxy mode for processes that are not ours. |
| **`pds-admin`** | The only holder of the PDS admin password; acts only on a moderator's hardware-key signature. |
| **`admin`** | The internal console over Tailscale. |
| **roster** | The owner-signed list of moderator keys `pds-admin` trusts. |
| **envelope** | An admin action plus the moderator's WebAuthn signature over exactly that action. |
| **`eraseDid`** | The one function (`core.erase_did`, P3.07) that removes every row about a DID, except material under an open legal hold. |
| **`partially_erased_legal_hold`** | The `eraseDid` outcome when held material was kept; the rest is erased now and the held part when the hold closes. |
| **`core.is_held`** | The one hold predicate, a SQL function in two forms, `core.is_held(did)` and `core.is_held(subject_kind, subject_ref)`, saying whether a DID or a subject is under an open legal hold; P3.07 declares it, P4.07 writes the body; erasure, backups and pruning all call it. |
| **identity seam** | A signed, single-use assertion that tells another of our services which DID a user is. |
| **media proxy** | The `media` service on its own domain that serves vetted bytes with a sandbox policy. |
| **rendition** | A transcoded copy of a video at one size (360p, 720p) or the 1080p master. |
| **`matched_hold`** | The terminal state of an upload, Bluesky-post draft or pending comment whose fingerprint matched or that was suspected (text-gate S4 or a reviewer); its content is under legal hold and the member sees only a generic "unavailable". |
| **`needs_reauth`** | A flag (not a state) on an `approved` item whose OAuth session is gone; nothing is written until the member signs in and chooses "Publish now". |
| **`master_downgraded`** | A flag (not a state) recorded when a foreign PDS refused the 1080p master and the member chose to publish the 720p rendition as the repo blob (decision 22: always asked, never automatic). |
| **severity 1 / 2 / 3** | The bug levels defined in `docs/human/severity.md` (P0.09b); the launch gate (L.02) allows no open severity 1 or 2. |
| **test track** | Up to 10 people Alex knows on the development PDS, from the end of Phase 2; not a launch. |
| **step** | One entry of this book; one pull request. |
| **`alert.send`** | Writes an alert (tier, class, text) as a database outbox row that `admin` delivers; services without mail use it. |
| **`ops.report`** | The definer through which a service records one of its own health metrics in `ops.metric`. |
| **`permissionSetCheck`** | The monitor that checks our published permission set resolves with the expected content (P1.35's monitor; Phase 5 polls it when the lexicon authority moves). |
| **`release.json`** | The CI release manifest: the commit and each service image by digest; deploys read it. |
| **`sh.unset.follow`** | Our follow record, written when a public member follows an unset.sh account (one with an `sh.unset.profile` record); a follow of a Bluesky account is `app.bsky.graph.follow`. |
| **Bluesky picture proxy** | P4.21a: `media` fetches a Bluesky post's picture from the author's PDS, checks its CID and fingerprint, re-encodes it and serves it, so viewers never contact Bluesky. |

## Editor pass (2026-10-03)

- Added: `FingerprintCheck`, delete hold (separated from legal hold, phase-3 Notes), `sealTo`, `partially_erased_legal_hold`,
  `isHeld`, `matched_hold`, `needs_reauth`, `master_downgraded`, severity 1/2/3, and the phase-5 names `alert.send`, `ops.report`,
  `permissionSetCheck`, `release.json` (phase-5 Notes).
- Fixed: fingerprint (PDQ only, no TMK or MD5; editor resolution 2); legal hold (P4.07 table, `sealTo`, one year after
  notification on `pds-admin`'s clock; resolution 3); transmission data (a buffer for every upload, decision 21); seal,
  net-guard and `eraseDid` (resolutions 3 and 4); message request (every DM starts as an invite, decision 12; phase-6 Notes 9).
- Lead sweep (2026-10-03): `isHeld` → `core.is_held` with its two forms (lead decision 2); seal and `sealTo` entries
  name `sealStream`/`unsealStream` and `sealToStream` and the owner's argument order (lead decision 1); legal hold
  says who may export it (lead decision 3).
- Moderation editor (2026-10-03, Alex answers 29b, 30, 30b, 30c, 33): review reworded (local only); added image gate,
  text gate, shadow mode, suspected material, `sh.unset.follow`, Bluesky picture proxy; legal hold and `matched_hold`
  cover suspected material.
- Not added: entries for `packages/admin-shared` and other phase-3 helper names. They are code, not domain words, and they
  stay documented in their steps.

### Editor pass (2026-10-04 05:10Z refinement, decision 34)

- Layout open points resolved by the architecture thread (guideline §1 refined 05:10Z; `layout-map.md`): `docs/severity.md` → `docs/human/severity.md` (O-10).
