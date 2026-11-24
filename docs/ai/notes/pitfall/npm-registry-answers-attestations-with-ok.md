---
id: npm-registry-answers-attestations-with-ok
type: pitfall
status: current
areas: ["[[ci]]"]
summary: "The npm registry can answer one attestation address with the text OK for hours; a retry does not recover."
code: [.github/workflows/ci.yml, package-lock.json]
sources: [https://github.com/npm/cli/blob/v11.20.0/docs/lib/content/commands/npm-audit.md, https://github.com/npm/pacote/blob/v21.5.1/lib/registry.js, https://github.com/npm/make-fetch-happen/blob/v15.0.6/lib/remote.js, https://github.com/npm/make-fetch-happen/blob/v15.0.6/lib/cache/entry.js]
importance: normal
related: []
replaced_by: null
tags: [pitfall, ci]
checked: 2026-11-24
---
**What happens.** On 2026-11-24 the `audit` job failed four times (03:27Z, 03:55Z, 06:25Z and 06:55Z; runs
45319489432, 45322730409, 45340195607 and 45343558020) on pull requests that change no dependency:

    npm error code FETCH_ERROR
    npm error invalid json response body at https://registry.npmjs.org/-/npm/v1/attestations/axe-core@4.14.0
    reason: Unexpected token 'O', "OK

It was the same address each time. About one audit run in eight failed; runs between them passed, `main` included.
npm's debug log of the fourth failure has the request as `http fetch GET 200 <address> 67ms (cache miss)`: the
registry answered with status 200 and the body `OK`, and the answer did not come from npm's own cache. Why the
registry does it is not known. From another network the same address returned the real document throughout.

**Why npm stops.** npm 11.20.0 (Node 26.12.0) reads attestations in pacote 21.5.1 `lib/registry.js:233-239`, which
parses any answer below 400 as JSON. make-fetch-happen 15.0.6 `lib/remote.js:87-113` retries network errors and
408, 420, 429 and 5xx only, so an unparsable 200 is final. pacote 22.0.1 has the same lines, so a newer npm does not
help. The registry's verdict on any signature is not involved: npm verified nothing in that run.

**A retry does not recover.** The fourth failure ran a retry script (since removed): the whole command again after
30 s and again after 90 s, each time with an empty npm cache. All three attempts, over 2 minutes 13 seconds on one
runner, got the same 200 `OK` in about 70 ms. A runner keeps getting the bad answer; other runners get the good one.
Request headers do not get past it either: `cache-control: no-cache`, `max-age=0`, an encoded `@` and a trailing `?`
all returned the same stored object where that was tried.

**Keeping the documents between runs is not a clean way out.** The real document is served with
`cache-control: public, max-age=31557600`, so npm's cache replays it without asking the registry (measured with
npm-registry-fetch 19.1.1: a second fetch with the network cut is a `hit`). But a kept npm cache also keeps the
packuments, and make-fetch-happen 15.0.6 `lib/cache/entry.js:403-407` answers from a stale stored copy when the
registry cannot be reached, unless the answer said `must-revalidate`; packuments are served with
`cache-control: public, max-age=300` only. A kept cache would let the audit pass on old packuments while the registry
is down, which loosens the check. npm's own commands cannot keep the documents alone: `npm cache clean <key>` deletes
the content and leaves an index entry that make-fetch-happen still follows (the next fetch fails with ENOENT), and
`npm cache verify` does not remove it (measured, npm 11.20.0).

**What was done (P0.07p).** Nothing in the check changed. The lockfile's axe-core moved from 4.14.0 to 4.14.1, the
next patch release in the range `@axe-core/playwright` 4.14.0 asks for (`~4.14.0`), published 2026-11-16, so the
audit no longer asks for the bad address. That steps around this one address. It does not stop the registry doing
the same to another one.

**If it happens again.** A red `audit` with that exact parse failure for an attestation address is the registry's
fault, not the pull request's, and re-running on the same runner within minutes does not help. Do not add a retry,
and do not turn the failure into a warning. If the address belongs to a package with a newer release in range, move
to it. If it keeps happening across packages, the choice between keeping documents between runs (the loosening
above) and living with the failures is Alex's. Reporting the fault to npm is also his call; the address, times,
status and npm versions above are what a report needs.
