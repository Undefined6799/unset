# Child sexual abuse material: report and preserve

What to do when a fingerprint match, a local check, a reviewer or a user report points at child sexual abuse and
exploitation material (CSAEM) on our service. Plan §5.8 and §6 (decisions 9, 21 and 30). The law below was read on
2026-10-12; every citation is marked for the lawyer hour, and each marker has a row in
[`legal-status.md`](legal-status.md). This is an operating runbook, not legal advice. Decision 9's one-year
preservation is ahead of the law in force: it applies only once C-16's amendments commence, and until then the rule
is 21 days (section 4; plan §6 as restated on 2026-10-12).

**Who:** Alex, the only person who reports. Nobody opens or reviews the item, Alex included: every report works from
the alert's metadata.

**Never:** view more of the item than the alert already showed you; copy, download, screenshot, forward or attach it
anywhere, including to Cybertip.ca, the police, an AI tool or a ticket; search for more material (the Act neither
requires nor authorizes searching, s. 6) [lawyer to confirm: L1]. Report locations and facts, never files.

## 0. A child may be in danger now

If anything suggests a child is in immediate danger, call 9-1-1 or the local police first, then continue below.
Cybertip.ca says the same on its report page (https://www.cybertip.ca/en/report/, read 2026-10-12).

## 1. Contain (minutes)

1. The item is already blocked and sealed under the legal hold by the pipeline (a match or a "suspected" verdict
   blocks it; plan §5.8). Confirm in the admin panel that the hold exists; do not open the media.
2. Freeze the uploader's uploads. Never freeze the reporter's account.
3. Note the time you were alerted. The reporting steps in sections 2 and 3 run "as soon as feasible" from here; the
   preservation clock in section 4 starts later, on the day the police notice is made.

## 2. Which duty applies

The in-force law is An Act respecting the mandatory reporting of Internet child pornography by persons who provide an
Internet service, S.C. 2011, c. 4 ("the Act"; Justice Laws, current to 2026-09-21), and the Internet Child Pornography
Reporting Regulations, SOR/2011-292 (current to 2026-06-21). The Act has no short title until C-16 s. 178 commences.

| Situation | Duty | Where |
| --- | --- | --- |
| Someone tells us of an address (URL or IP) elsewhere where CSAEM may be public | Report the address to the designated organization, the Canadian Centre for Child Protection (Cybertip.ca), as soon as feasible (Act s. 2; Regs s. 2 and s. 3) [lawyer to confirm: L2] | https://www.cybertip.ca/en/report/federal/ |
| We have reasonable grounds to believe our own service is or was used for a CSAEM offence (a match, a reviewer's finding, a credible report about our content) | Notify the police in writing, as soon as feasible (Act s. 3; Regs s. 11), and preserve (section 4 below) [lawyer to confirm: L3] | Local police; the written notice in section 3 |
| Both | Both | |

The Cybertip.ca service-provider form takes a URL or IP only and gives a receipt. Keep the receipt with the case
record; the form advises keeping it for 2 years [lawyer to confirm: L2]. For material on our own network, the page
tells the provider to report to local police instead: that is the s. 3 notice in section 3.

Suspected material that no fingerprint matched follows the same path; whether the duties and timing differ for
suspected versus matched material is on the lawyer-hour list [lawyer to confirm: L4]. Written child sexual material in
a comment is too [lawyer to confirm: L5].

## 3. The written notice to police (Act s. 3; Regs s. 11)

Send it in writing, and keep a copy in the case record. It contains:

1. the offence we believe is being or was committed;
2. a description of the material, including its format (from the alert's metadata only, never from viewing);
3. how and when we found it (the check that flagged it, and the times);
4. any other related evidence we hold or control (the sealed hold record, by its id);
5. the contact details of our representative: [to fill: the role title and the dedicated reporting address].

Do not tell the user, the reporter or anyone else that a report or notice was made, or what it said, if that could
prejudice an investigation (Act s. 5) [lawyer to confirm: L6]. The user-facing messages say only that the item is
under review.

## 4. Preserve, then destroy

C-16, the Protecting Victims Act (S.C. 2026, c. 19), received royal assent on 2026-06-18. Its Mandatory Reporting
Act amendments (ss. 178 to 183) come into force on a date the Governor in Council fixes, and that date is not yet
fixed (Justice Laws, current to 2026-09-21) [lawyer to confirm: L7]. Check Justice Laws and the Canada Gazette Part II
before every case until the order is made.

- **Until then:** notify the police in writing (s. 3); preserve all related computer data for **21 days**, counted
  from the day the police notice is made (s. 4(1)), in a secure offline location (Regs s. 12); then, as soon as
  feasible, destroy anything we would not keep in the ordinary course of business (s. 4(2)), unless a judicial order
  requires otherwise [lawyer to confirm: L8].
- **After commencement:** notify the law enforcement body the regulations designate; attach transmission data
  (Criminal Code s. 487.011: for example routing, IP address, date and time) when the material is manifestly CSAEM;
  and preserve for **one year**, counted from the day the police notice is made (s. 4(1)) [lawyer to confirm: L9].

How we apply it (architecture's design rule of 2026-10-12, held for the lawyer hour, not a decision)
[lawyer to confirm: L20]:
1. The hold length is fixed per case at notification: the case record stores the regime and the preserve-until date.
   A later regime change never shortens or extends a hold already running.
2. The regime switches only through a reviewed config change that cites the order in council. A missing or bad value
   means the in-force regime: 21 days, then destroy.
3. A judicial preservation order is an explicit extension on the case, recorded with its reference.
4. Destruction is an audited event (case id and time only) covering the data and any document made only for the
   preservation.

Open for the lawyer hour: which regime governs a notice made before commencement [lawyer to confirm: L10]; what
"ordinary course of business" means for our log retention, and so what the sealed transmission buffer may keep today
[lawyer to confirm: L11]; whether a report under a foreign duty counts (new s. 9.01) [lawyer to confirm: L12]; and how
we answer a production order for the preserved data [lawyer to confirm: L21].

## 5. Close the case

1. Record in the case record: the alert time, the containment time, each report or notice with its time and receipt,
   the preservation start (the day the police notice was made, s. 4(1)), and the planned destruction date.
2. Set the hold's destruction date to match section 4.
3. Do not discuss the case outside the case record.

## Contacts

- Cybertip.ca service-provider form: https://www.cybertip.ca/en/report/federal/ (access key; URL or IP only).
- Cybertip.ca public form: https://www.cybertip.ca/en/report/report-form/ (reviewed 8:30 to 16:00 Central, Monday
  to Friday). Toll free 1-866-658-9022.
- Local police non-emergency line: [to fill].
- Emergency: 9-1-1.

Sources read 2026-10-12: https://laws-lois.justice.gc.ca/eng/acts/I-20.7/FullText.html,
https://laws-lois.justice.gc.ca/eng/regulations/SOR-2011-292/FullText.html,
https://www.parl.ca/legisinfo/en/bill/45-1/c-16, https://www.justice.gc.ca/eng/csj-sjc/pl/c16/,
https://www.cybertip.ca/en/report/federal/.
