---
id: npm-registry-answers-attestations-with-ok
type: pitfall
status: current
areas: ["[[ci]]"]
summary: "npm's CDN can hold the text OK in place of an attestation document for a year; no retry gets past it."
code: [scripts/ci/keep-attestation-documents.ts, scripts/ci/keep-attestation-documents.test.ts, .github/workflows/ci.yml]
sources: [https://github.com/npm/pacote/blob/v21.5.1/lib/registry.js, https://github.com/npm/make-fetch-happen/blob/v15.0.6/lib/remote.js, https://github.com/npm/make-fetch-happen/blob/v15.0.6/lib/cache/entry.js, https://github.com/npm/cacache/blob/v20.0.4/lib/entry-index.js]
importance: normal
related: []
replaced_by: null
tags: [pitfall, ci]
checked: 2026-11-24
---
**What happens.** On 2026-11-24 the `audit` job failed on pull requests that change no dependency, four times for
axe-core@4.14.0 (03:27Z, 03:55Z, 06:25Z, 06:55Z; runs 45319489432, 45322730409, 45340195607, 45343558020) and then
for playwright@1.64.1 (about 07:29Z, #2029):

    npm error code FETCH_ERROR
    npm error invalid json response body at https://registry.npmjs.org/-/npm/v1/attestations/axe-core@4.14.0
    reason: Unexpected token 'O', "OK

**The cause, measured.** registry.npmjs.org's CDN holds a wrong stored object for single attestation addresses at
single locations. Seen from a cloud session served by location ORD at 07:31Z:

    GET /-/npm/v1/attestations/playwright@1.64.1
    200, content-type: text/plain, cf-cache-status: HIT, age: 42690,
    last-modified: Mon, 23 Nov 2026 19:39:07 GMT, cache-control: public, max-age=31557600, body "OK\r\n"

A `HEAD` for the same address is not served from the cache (`cf-cache-status: DYNAMIC`) and says
`content-type: application/json`, so the origin is right and the stored object is wrong. Neighbouring addresses were
correct at the same location. A runner that reaches such a location gets the bad answer every time; others pass.
With a one-year lifetime it does not clear by itself. Other projects report the same publicly.

**Nothing a client does gets past it.** Tried against the stored object: `cache-control: no-cache`, `pragma`,
`max-age=0`, other `accept` and `accept-encoding` values, `if-none-match`, `range`, a cookie, an `authorization`
header, a query string, an encoded `@`. All return the same `OK`. A bounded retry ran for real on #2027 (three
attempts in 2 minutes 13 seconds, each retry with an empty npm cache, npm's log `http fetch GET 200 ... 67ms (cache
miss)` each time) and did not recover. Moving one package to another version only steps around that one address.

**Why npm stops.** npm 11.20.0 (Node 26.12.0) reads attestations in pacote 21.5.1 `lib/registry.js:233-239`, which
parses any answer below 400 as JSON. make-fetch-happen 15.0.6 `lib/remote.js:87-113` retries network errors and
408, 420, 429 and 5xx only. pacote 22.0.1 has the same lines. npm verified nothing in such a run.

**What the audit job does about it (P0.07p).** It carries the attestation documents of a run that verified
everything to later runs, in npm's own cache folder kept by `actions/cache`, and later runs verify those copies. The
registry serves the real document with `cache-control: public, max-age=31557600`, so npm reads a stored copy
without asking (measured with npm-registry-fetch 19.1.1). Packuments, the signing keys and Sigstore's trust root are
asked for on every run as before, so every registry signature is checked against the live registry and every
attestation is verified in every run.

**The trap in keeping npm's cache.** The cache also stores packuments, and make-fetch-happen 15.0.6
`lib/cache/entry.js:403-407` answers from a stale stored copy when the registry cannot be reached unless the answer
said `must-revalidate`; packuments carry `max-age=300` only. A kept packument would let the audit pass on old
signatures while the registry is down. So `scripts/ci/keep-attestation-documents.ts` prunes the store to attestation
documents before the audit reads it and before the job saves it. `npm cache clean <key>` cannot do that: it deletes
the content and leaves the index entry, which npm follows to a missing file (ENOENT), and `npm cache verify` does not
remove the entry (measured, npm 11.20.0). The script deletes index files itself (cacache 20.0.4 keeps one per key
under `_cacache/index-v5/`) and keeps a file only when every line parses and every key is an attestation address.

**What it does not cover.** A dependency version the store has never held is still fetched, so its first run can
meet a bad stored answer. The store needs one green audit to exist. A failed job saves nothing, so a bad `OK` never
enters it. A run does not notice if the registry later withdraws or replaces a document that the packument still
lists; whether npm ever does that is not known.

**If the audit is red with that parse failure.** It is the registry, not the pull request. Re-running on the same
runner within minutes does not help; a new commit lands on another runner. Do not add a retry and do not turn the
failure into a warning. Reporting the fault to npm is Alex's call; the measurements above are what a report needs.
