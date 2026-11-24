---
id: npm-registry-answers-attestations-with-ok
type: pitfall
status: current
areas: ["[[ci]]"]
summary: "The npm registry sometimes answers an attestation request with the text OK; npm fails without a retry."
code: [scripts/ci/npm-audit-signatures.ts, scripts/ci/npm-audit-signatures.test.ts, .github/workflows/ci.yml]
sources: [https://github.com/npm/cli/blob/v11.20.0/docs/lib/content/commands/npm-audit.md, https://github.com/npm/pacote/blob/v21.5.1/lib/registry.js, https://github.com/npm/make-fetch-happen/blob/v15.0.6/lib/remote.js]
importance: normal
related: []
replaced_by: null
tags: [pitfall, ci]
checked: 2026-11-24
---
**What happens.** On 2026-11-24 the `audit` job failed three times (03:27Z, 03:55Z and 06:25Z; runs 45319489432,
45322730409 and 45340195607) on pull requests that change no dependency:

    npm error code FETCH_ERROR
    npm error invalid json response body at https://registry.npmjs.org/-/npm/v1/attestations/axe-core@4.14.0
    reason: Unexpected token 'O', "OK

Runs between them passed. The registry answered that address with a status below 400 and the body `OK` in place of
the attestation document. It was the same package each time, and the CDN's copy of its document had been stored that
night (06:11Z) while other packages' copies were days or weeks old. Why the registry did it is not known.

**Why npm stops.** npm 11.20.0 (Node 26.12.0) reads attestations in pacote 21.5.1 `lib/registry.js:233-239`, which
parses any answer below 400 as JSON. make-fetch-happen 15.0.6 `lib/remote.js:87-113` retries network errors and
408, 420, 429 and 5xx only, so an unparsable 200 is final. pacote 22.0.1 has the same lines, so a newer npm does not
help. The registry's verdict on any signature is not involved: npm verified nothing in that run.

**The trap in a retry.** The real document is served with `cache-control: public, max-age=31557600`. With those
headers make-fetch-happen stores a 200 `OK` in npm's cache and replays it without asking the registry again (measured
with npm-registry-fetch 19.1.1 against a local server: one request for two fetches). A retry must use an empty cache.

**The rule.** `scripts/ci/npm-audit-signatures.ts` (P0.07p) runs the whole command again, at most twice, with an
empty cache, only when npm exited non-zero, printed no verdict and reported that parse failure for an attestation
address of registry.npmjs.org. A pass is always one complete run that exited 0. Anything else fails at once: do not
widen the match to other errors or addresses, and do not answer a red `audit` job by re-running it.

**Not known yet.** The status and headers of the bad answer. The script now prints npm's own log line for the request
(`http fetch GET <status> <address> <ms> (cache …)`) when it happens again; with that, the registry fault can be
reported to npm, which is Alex's call.
