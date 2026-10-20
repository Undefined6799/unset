# 0033 — Image signing: keyless cosign with our exact workflow identity

Status: Proposed (awaiting Alex). Accepted only by his typed line; from then on the record changes only to be marked
superseded.

## Context
PLAN.md (§8, SLSA row and CI shape) chose cosign with a key pair and no transparency-log upload, because the repository
was private: keyless signing writes the signing workflow's identity to the public Rekor log, and GitHub artifact
attestations on a private repository need GitHub Enterprise Cloud. The step book's P1.27 and P1.27s carried that design
(`deployment/cosign.pub`, `COSIGN_PRIVATE_KEY`, `COSIGN_PASSWORD`, `--tlog-upload=false`), and said that once the
repository became public the follow-up would be keyless, as a separate reviewed change.

Alex made the repository public on 2026-10-06 at 22:06Z (ADR 0017, Context; the architecture ruling cites ADR
0012, whose text predates that), so that premise is gone. Architecture put the choice to Alex on a card, "Sign our
images with GitHub's identity (keyless), or with a key you keep?", with keyless recommended. Alex tapped **"Keyless"**
at **2026-10-14T21:16:36Z** (book edit 2026-10-13-verify-819-fixes, "Alex's signing card answered" and "Architecture on
Alex's keyless answer"). The plan thread's PLAN.md edit records the same answer at PLAN.md's SLSA row and CI shape.

Attestation availability, read on 2026-10-20 from GitHub's docs
(https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations):
"If you are on a GitHub Free, GitHub Pro, or GitHub Team plan, artifact attestations are only available for public
repositories", and private or internal repositories need GitHub Enterprise Cloud. Public repositories' attestations use
the Sigstore public-good instance, with its transparency log
(https://docs.github.com/en/actions/concepts/security/artifact-attestations). Being public, this repository can use them.

## Decision
1. **Sign without a key.** `cosign sign` and `cosign attest` (provenance and SBOM) run with no key: a short-lived Fulcio
   certificate bound to the GitHub Actions OIDC identity, recorded in public Rekor, with the bundle stored beside the
   image. First-party images sign in `.github/workflows/publish-images.yml`'s `publish` job; mirrored upstream images
   sign in `.github/workflows/mirror.yml`'s copy-and-sign job. Both jobs run in the GitHub environment `signing`
   (deployment branch `main` only, Alex as required reviewer), and only those two jobs hold `id-token: write`.
   `images.yml` stays the unprivileged pull-request check and never gets it. No signing runs on a pull request.
2. **Verify by exact identity only.** Verification passes `--certificate-identity` with the full workflow URL,
   `https://github.com/Undefined6799/unset/.github/workflows/publish-images.yml@refs/heads/main` for first-party images
   and `https://github.com/Undefined6799/unset/.github/workflows/mirror.yml@refs/heads/main` for mirrors, and
   `--certificate-oidc-issuer https://token.actions.githubusercontent.com`. No `-regexp` form is used anywhere. The
   certificate's repository and ref extensions are checked where cosign exposes them. Anything else fails closed.
3. **Transparency log required.** No cosign call carries `--tlog-upload=false` or `--insecure-ignore-tlog`; the Rekor
   inclusion proof in the bundle is required at verify time.
4. **Offline at deploy.** The deploy preflight verifies with the stored bundle and a committed Sigstore trusted root,
   `deployment/sigstore/trusted_root.json` (trusted base, CODEOWNERS' last section), and never fetches trust material at
   deploy time. The trusted root changes only by a reviewed PR. A manual-only workflow may fetch it through Sigstore's
   TUF client for such a PR; it never commits, pushes or opens a PR itself.
5. **One identity per lock entry.** Every image-lock entry's `verify` is `"cosign-keyless"`, with the identity fixed by
   which workflow signs it; no entry may name another identity.
6. **Attestations alongside.** GitHub artifact attestations may be added in addition to the cosign signature and
   attestations, never instead of them.
7. **Removed.** `deployment/cosign.pub`, the `COSIGN_PRIVATE_KEY` and `COSIGN_PASSWORD` secrets, the KMS option and
   Alex's key-generation item. His setup is the `signing` environment alone.
8. **Pins.** cosign is pinned by version and checksum in CI, and in the preflight before it runs (P2.26b).

Moving back to a signing key needs a new ADR.

## Alternatives
- **Key pair, no transparency log (the previous plan).** Equally strict at the verify step, but a long-lived private
  key must be generated, guarded and rotated if exposed, and its only advantage, keeping the repository identity out of
  a public log, is moot for a public repository. Rejected by Alex's card answer.
- **Keyless with a regexp identity (any workflow or branch in the repository).** Looser: any workflow on any branch
  could produce a passing signature. Rejected; exact match only.
- **Fetch the trusted root at deploy time.** Puts a network fetch of trust material on the deploy path and lets a
  compromised fetch change which signatures count. Rejected; the root is committed and reviewed.

## Consequences
- No signing secret exists to leak. The public Rekor entry shows the repository, workflow and commit, which the public
  repository already shows.
- Verification depends on the committed trusted root; when Sigstore rotates its root, a reviewed PR refreshes it
  (P2.26e places it first).
- Every publish run waits for Alex's approval in the Actions tab (the `signing` environment's required reviewer).
- Steps: P1.27s implements the signing, verify and guard side; P2.26e places the trusted root; P2.26b moves the
  preflight to keyless, offline verification with the cosign pin.

## Compliance
P1.27s's tests hold the record: the workflow guard's `id_token_write_only_on_signing_jobs` and the `packages: write`
fixtures (Decision 1), `verify-images.test.ts`'s red cases for a wrong identity, a wrong issuer, a regexp identity, a
missing bundle and a missing tlog entry (Decisions 2 and 3), and `image-workflows.test.ts`'s
`tlog_upload_never_disabled` (Decision 3). P2.26e's test pins the trusted root's shape and P2.26b's the offline,
pinned verify (Decisions 4 and 8). `/deployment/sigstore/` joins CODEOWNERS' last section in P1.27s. Acceptance of this
record is Alex's line "yes accept ADR 0033 keyless image signing docs/human/decisions/0033-image-signing-keyless.md";
ADR 0001 gains its one-paragraph entry then.
