---
id: errors
type: area
status: current
areas: ["[[errors]]"]
summary: "Hub for shared/errors: the one error-code catalog and the only way a code enters a URL."
code: [shared/errors/index.ts]
sources: []
importance: normal
related: ["[[http]]"]
replaced_by: null
tags: [area, errors]
checked: 2026-10-06
---
# errors

**What it owns.** Error codes for every failure (plan §2 rule 15).

**Files.**
- `catalog.ts`: every code, `area.reason` in lowercase, with its HTTP status and whether a page may show it. A
  later step adds its codes here.
- `AppError.ts`: an error whose message is always its code; free text never travels in an error.
- `redirect.ts`: writes and reads `error=<code>` in a URL; only public codes pass.
- `messages.ts`: English text per public code, until the i18n slice adds catalogs.

**Links.** [[http]].
