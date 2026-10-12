# Incident response: privacy breaches

What to do when personal information we hold may have been accessed, used or disclosed without authority, or lost.
Plan §6 ("Canadian law"). P1.35's `permission-set-changed.md` and `plc-nullification.md` hand over here when an
integrity incident may have exposed users. Child sexual abuse material follows
[`cybertip-runbook.md`](cybertip-runbook.md) instead; if an incident involves both, run both. The law below was read on
2026-10-12; every citation is marked for the lawyer hour and listed in [`legal-status.md`](legal-status.md). This is
an operating runbook, not legal advice.

**Roles:** Alex alone holds every role: incident lead, the person in charge of personal information (Quebec s. 3.1)
and the contact the notices name. The published contact is the role title and its dedicated address, never a personal
name: [to fill: the role title and the privacy address].

## Which laws apply

- **PIPEDA**, S.C. 2000, c. 5, ss. 10.1 to 10.3 (current to 2026-07-21), and the Breach of Security Safeguards
  Regulations, SOR/2018-64 (current to 2026-09-21). The plan applies it in full once the service is commercial and
  meets it voluntarily before then [lawyer to confirm: L13].
- **Quebec**, the Act respecting the protection of personal information in the private sector, CQLR c. P-39.1, ss.
  3.1 and 3.5 to 3.8 (updated to 2026-08-12), as amended by Law 25, and the Regulation respecting confidentiality
  incidents, CQLR c. A-2.1, r. 3.1 (updated to 2026-06-01). It applies as soon as we have Quebec users
  [lawyer to confirm: L14].

## 1. Contain (first hour)

1. Stop the exposure: revoke the leaked credential, take the affected service offline, or block the route.
2. Keep what shows what happened (audit rows, the change that caused it). Never copy the exposed personal
   information itself into notes, tickets or chat.
3. Open an entry in the register below with the time we became aware.

## 2. Assess the risk

Both tests weigh how sensitive the information is and how likely it is to be misused.

- **PIPEDA:** is it reasonable to believe the breach creates a real risk of significant harm to an individual
  (s. 10.1(1), (7) and (8))? Significant harm includes bodily harm, humiliation, damage to reputation or
  relationships, financial loss, identity theft and loss of opportunities [lawyer to confirm: L15].
- **Quebec:** does the incident present a risk of serious injury (s. 3.5), weighing sensitivity, the anticipated
  consequences of its use and the likelihood of injurious use (s. 3.7)? The person in charge must be consulted, which
  here is Alex [lawyer to confirm: L16].

Write the reasoning in the register entry either way; a "no risk" finding is recorded too.

## 3. If the test is met: report and notify, as soon as feasible

**PIPEDA (s. 10.1; SOR/2018-64 ss. 2 to 5)** [lawyer to confirm: L17]
1. Report to the Office of the Privacy Commissioner through its secure online form
   (https://services.priv.gc.ca/atteinte-breach-lprpde-pipeda/en/register; a PDF form,
   https://www.priv.gc.ca/media/4844/pipeda_pb_form_e.pdf, is uploaded through the same form). The report gives: the
   circumstances and cause; the day or period; the personal information involved; the number of people affected; the
   steps taken to reduce harm; the steps to notify people; and a contact who can answer questions.
2. Notify each affected person directly (email is allowed): the circumstances, the day or period, the information
   involved, what we did, what they can do, and our contact. Indirect, public notice only when direct notice would
   cause further harm or undue hardship, or we have no contact details.
3. Notify any other organization that can reduce the harm (s. 10.2), sharing only what that needs.

**Quebec (s. 3.5; A-2.1, r. 3.1 ss. 3 to 6)** [lawyer to confirm: L18]
1. Notify the Commission d'accès à l'information promptly, in writing, through https://formulaire.cai.gouv.qc.ca/
   (French form). It asks for eleven items, including the dates of the incident and of our awareness, the number of
   people concerned and how many live in Quebec, the risk factors, and the measures taken.
2. Notify each person concerned: the information involved, the circumstances, the measures we suggest they take, and
   our contact. Notice may be delayed if it would hamper an investigation.

## 4. Templates

**Notice to a person (fill each bracket; send from the privacy address):**

> Subject: A security incident involving your unset.sh account
>
> On [date or period], [what happened, in one plain sentence]. It involved your [information involved]. We
> [what we did to stop it and reduce harm]. We suggest you [steps the person can take]. Questions: [contact].

**Register entry:** see the table below.

## 5. Register of incidents

Every incident is recorded, whether or not it was reported. PIPEDA keeps each record 24 months after we determine the
breach occurred (SOR/2018-64 s. 6); Quebec keeps it at least 5 years after we became aware (A-2.1, r. 3.1 s. 8). We
keep 5 years, the longer of the two [lawyer to confirm: L19]. This repository is public, so the register is kept
outside it, in Alex's own records, with these columns: became aware; incident period; information involved; number of
people (and in Quebec); risk found and why; reports and notices sent, with dates; measures taken.

Sources read 2026-10-12: https://laws-lois.justice.gc.ca/eng/acts/P-8.6/page-3.html,
https://laws-lois.justice.gc.ca/eng/regulations/SOR-2018-64/FullText.html,
https://www.legisquebec.gouv.qc.ca/en/pdf/cs/P-39.1.pdf,
https://www.legisquebec.gouv.qc.ca/fr/document/rc/A-2.1,%20r.%203.1, and the OPC and CAI form pages above.
