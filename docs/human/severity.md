# Bug severity

Status: confirmed by Alex 2026-10-03 (P5-A5 = L-A1).

Every bug carries exactly one severity label: `sev-1`, `sev-2` or `sev-3`. Whoever files a bug proposes a severity
with the bug form. The agent proposes one at triage, and Alex confirms every `sev-1`, every `sev-2` and every
downgrade. The launch gate (step L.02) fails while any `sev-1` or `sev-2` bug is open, or any `sev-3` bug is not
triaged.

A possible vulnerability is never filed as a public issue. Report it privately as [`SECURITY.md`](../../SECURITY.md)
says.

## Severity 1

Any of the following:
- a security or privacy failure: an auth bypass, an exposed session or token, private content written to a repo or
  shown to someone else, an IP or user agent stored outside the sealed exception, or a secret printed;
- a legal-duty failure: the abuse-material check, report or preservation path does not work, or erasure or export
  does not work;
- data loss or corruption that a restore cannot repair;
- a core flow broken for all users;
- the restore drill failing (it does not complete, or a check fails);
- a compliance-mode retain-until set beyond its cap.

## Severity 2

Any of the following:
- a core feature wrong for some users with no reasonable workaround;
- a plan §2 rule or §6.1 standard violated without a known exploit;
- a blocking WCAG 2.2 A/AA failure on a core flow;
- a missed §6.1 budget on a core surface;
- a moderation or appeal path that loses or misroutes a case;
- data loss that a restore can repair;
- a restore drill that passed but over RTO.

## Severity 3

Everything else.

## Rule of doubt

When two severities are plausible, the higher one applies until Alex lowers it.

## Upstream-mitigation downgrade

An `upstream` bug (in Synapse, the PDS, Tap or Ozone) may drop one level, and never from 1 to 3, only when all of the
following hold:
- a mitigation is deployed;
- the mitigation is covered by a test that ran in the latest gate run;
- Alex confirms in the triage comment.

Without all three it counts at its full severity.

## Triage comment

Triage is one issue comment in this fixed form, one field per line, in this order. The launch gate parses it.

- `Triage: sev-1`, `sev-2` or `sev-3`.
- `Matches:` the definition line above that the bug matches.
- `Decision: fix`, `accept-for-launch` or `upstream-mitigated` (the downgrade).
- `Mitigation test:` the id of the test covering the mitigation. Only for a downgrade, and required for one.
- `Confirmed-by: Alex YYYY-MM-DD`. Required for `sev-1`, for `sev-2` and for every downgrade.

Example:

```text
Triage: sev-2
Matches: a core feature wrong for some users with no reasonable workaround
Decision: fix
Confirmed-by: Alex 2026-10-05
```

Then add the `triaged` label and the severity label.

## Changing a definition

One PR to this file. Open bugs are re-triaged against the new text.
