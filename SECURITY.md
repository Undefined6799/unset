# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) for this repository.
Do not open a public issue.

We aim to acknowledge reports within 3 working days and to agree a fix and disclosure
timeline with you within 10 working days.

## Scope

The code in this repository and the services it deploys (app, indexer, media proxy,
PDS administration). Issues in upstream projects (the reference PDS, Tap, Matrix
components) should go to those projects; tell us too if they affect unset.sh.

## How we build

Security rules every change follows are in [`CLAUDE.md`](CLAUDE.md) and
[`docs/ai/PLAN.md`](docs/ai/PLAN.md) §2. Changes to auth, identity, crypto, egress or personal
data need a security review before merge.
