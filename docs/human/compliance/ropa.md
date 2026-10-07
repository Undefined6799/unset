# Record of processing activities

This is the skeleton of the record of processing activities (plan §6). It names each purpose, the personal data
involved, a lawful basis, how long the data is kept and any processor. P5.12 completes it with
retention class ids, countries and safeguards.

The lawful bases are proposals. They are confirmed at the lawyer hour before production (plan §6, decision 30; P5.12).

A row whose facts are not known yet is `open`, and its evidence names the step that settles it. Nothing is invented to
fill it.

`scripts/docs/compliance.test.ts` checks every row's lawful basis, and that the dev PDS `device` table and the closed
test track have rows.

| Activity | Purpose | Personal data | Lawful basis | Retention | Processors | Status | Evidence |
|---|---|---|---|---|---|---|---|
| Accounts | Run the user's account, profile and sign-in | DID, handle, profile fields, session records | Contract (GDPR Art. 6(1)(b)); PIPEDA consent | Until the account is deleted, then erased by `eraseDid`, with backups within 30 days | None | partial | `doc:docs/human/db/erasure.md`, `step:P2.03` |
| E-mail | Send verification and account mail | E-mail address | Contract (GDPR Art. 6(1)(b)); PIPEDA consent | Until the account is deleted | The SMTP provider (row below) | open | `step:P2.11` |
| SMTP provider | Deliver transactional e-mail | E-mail address, message content | Contract (GDPR Art. 6(1)(b)); PIPEDA consent | The provider's terms, not chosen yet | A paid sending service hosted in Canada or the EU, picked by Alex from the team's shortlist before the first invite (Alex answer 21) | open | `step:P2.15` |
| Edge logs | Keep the service running and find faults | Status, route template and timing only: no address, path, query or user agent | Legitimate interests (GDPR Art. 6(1)(f)) | 3 days | None | open | `step:P1.28` |
| Backups | Recover from data loss | Everything in the databases and repositories, encrypted | Legitimate interests (GDPR Art. 6(1)(f)) | 30 days (Alex, step-book question 38) | The backup storage host, not chosen yet | open | `step:P5.04` |
| Dev PDS `device` table | Keep the user signed in on the development PDS | The edge's internal address (never the client's) and the user agent, per signed-in browser | Contract (GDPR Art. 6(1)(b)) | Until the device session ends or the account is deleted | None | open | `step:P1.28` |
| Closed test track | Let invited testers use the service before launch | Test users' accounts on the dev PDS, invites, e-mail sent through the SMTP provider | Consent (GDPR Art. 6(1)(a)); PIPEDA consent | Until the test track is wiped (P2.25) | The SMTP provider | open | `step:P2.25` |
| Admin action log | Make every admin action accountable | The acting admin's private tailnet address, staff only, never a user's (decision 29) | Legitimate interests (GDPR Art. 6(1)(f)) | 2 years | None | open | `step:P1.15` |
| Local automated review | Check public posts before they go live | Post media and text, processed in the no-network container; scores kept | Legitimate interests (GDPR Art. 6(1)(f)) | Scores only, with the draft | None (Alex answer 30b) | open | `doc:docs/human/compliance/ai-system-record.md` |
| Aggregate metrics | Measure the service without per-user analytics | None: rounded service-wide counts, never joined to a DID | No personal data | 13 months | None | open | `step:P5.09` |
| Controller contact | Name who answers privacy requests | The privacy officer's name and contact address | Legal obligation (Quebec Law 25) | While the role is held | None | open | `step:P2.15` |
