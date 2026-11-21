---
id: content
type: area
status: current
areas: ["[[content]]"]
summary: "Hub for domains/content: the image standard, a member's image library, processing contract and draft links."
code: [domains/content/index.ts, domains/content/images/standard.ts, domains/content/images/library.ts, domains/content/images/processing.ts, domains/content/images/draft-url.ts]
sources: [docs/human/decisions/0070-shared-image-foundation.md, docs/human/decisions/0076-image-uploads-up-to-64-mib.md]
importance: normal
related: ["[[web]]", "[[review]]", "[[media]]", "[[postgres]]", "[[storage]]"]
replaced_by: null
tags: [area, content]
checked: 2026-11-21
---
# content

**What it owns.** What members post and place on their pages (decision 34). Today that is the shared image
foundation of ADR 0070: product rules only, no I/O. `index.ts` is the only import path (`@unset/domains-content`).

**Files.**
- `images/standard.ts`: the image standard (ADR 0070 point 3, upload numbers raised by ADR 0076): `UPLOAD_LIMITS`,
  `DISPLAY_WIDTHS`, and `imageVersions` and `avatarVersions`, the versions we keep of an upload. One place for the
  numbers, so the upload route, review's processing and the pages agree.
- `images/library.ts`: a member's image library (ADR 0070 points 4, 6 and 7): who may upload (`uploadsOpen`), how
  much (`IMAGE_ALLOWANCE`, `fitsQuota`, `admitUpload`), when a stored image goes (`IMAGE_EXPIRY`) and how much one
  sweep may delete (`SWEEP_GOVERNOR`, `sweepAllowed`). [[postgres]] keeps the rows and applies these rules under a
  per-member lock.
- `images/processing.ts`: the processing contract (`ImageProcessor`, ADR 0070 point 2.2): untrusted bytes in,
  versions we made out. `infrastructure/image` implements it with sharp in killable child processes, run by
  [[review]]; web reaches review through net-guard.
- `images/draft-url.ts`: short-lived signed links to a member's draft versions (ADR 0070 point 5). Web mints one
  for the owner's own preview (`mintDraftPath`); [[media]] checks it (`verifyDraftPath`) before it reads the object
  from [[storage]]. A link is a bearer capability that lives five minutes (`DRAFT_URL_TTL_S`), and a check refuses
  an expiry more than ten minutes ahead (`DRAFT_URL_MAX_AHEAD_S`), so no process logs one, and every refusal looks
  the same.

**How data flows.** Upload at [[web]] → `admitUpload` and `fitsQuota` → review decodes and makes the versions →
the versions go to the object store and the row to [[postgres]] → the owner previews them through a signed link
served by [[media]].

**Links.** ADR 0070, ADR 0076; `infrastructure/image/` (the processing adapter, no hub of its own).
