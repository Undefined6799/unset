# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately by email to **security@unset.sh**. Do not open a
public issue. (GitHub's private vulnerability reporting is not available while the repository is
private.)

We aim to acknowledge reports within 3 working days and to agree a fix and disclosure
timeline with you within 10 working days.

## Scope

The code in this repository and every process it deploys: `web`, `api`, `indexer`, `media`,
`review`, `admin`, `pds-admin` and `chat-admin`. The PDS, Tap and Matrix components are upstream
projects: report issues in them to those projects, and tell us too if they affect unset.sh.

## How we build

Security rules every change follows are in [`CLAUDE.md`](../CLAUDE.md) and
[`docs/ai/PLAN.md`](../docs/ai/PLAN.md) §2. Changes to auth, identity, crypto, egress or personal
data need a security review before merge.
