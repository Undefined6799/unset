---
title: Incidents
weight: 5
---

Severity labels, and the privacy-breach runbook. The procedures stay in `docs/human/`. This page links them.

| Document | What it is |
| --- | --- |
| [severity.md](https://github.com/Undefined6799/unset/blob/main/docs/human/severity.md) | Bug severity. The file's status line says confirmed by Alex 2026-10-03. Labels are `sev-1`, `sev-2` and `sev-3`, defined under those headings. |
| [incident-response.md](https://github.com/Undefined6799/unset/blob/main/docs/human/legal/incident-response.md) | Privacy breaches. The file opens with "Placeholder: not reviewed by a lawyer." It says the incident register is kept outside this repository. |
| [cybertip-runbook.md](https://github.com/Undefined6799/unset/blob/main/docs/human/legal/cybertip-runbook.md) | The incident-response file says child sexual abuse material follows this runbook instead, and that an incident which is both runs both. |
| [legal-status.md](https://github.com/Undefined6799/unset/blob/main/docs/human/legal/legal-status.md) | The incident-response file points here for open lawyer rows. |
| [.github/SECURITY.md](https://github.com/Undefined6799/unset/blob/main/.github/SECURITY.md) | `severity.md` says a possible vulnerability is never filed as a public issue, and points here. The file says to report privately, through GitHub's private vulnerability reporting or by email to `security@unset.sh`. |

`scripts/docs/triage.ts` parses the triage comment. Its header cites `docs/human/severity.md`. The fields it reads, in order, are `Triage`, `Matches`, `Decision`, `Downgraded-from`, `Mitigation test` and `Confirmed-by`.

Other runbooks are on [Runbooks](../runbooks/).
