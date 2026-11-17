---
id: log
type: area
status: current
areas: ["[[log]]"]
summary: "Hub for shared/log: the structured logger that writes only allowlisted fields and scrubs every string (SE-7)."
code: [shared/log/index.ts, shared/log/logger.ts, shared/log/scrub.ts]
sources: [docs/ai/book/phase-1.md, docs/human/engineering/engineering-rules.md]
importance: normal
related: ["[[http]]", "[[errors]]"]
replaced_by: null
tags: [area, log]
checked: 2026-11-17
---
# log

**What it owns.** The structured logger (P1.03, rule SE-7). MIT-licensed, no product meaning. It writes one JSON
line per call with only allowlisted fields, and it cannot write an IP address, a user agent, a raw path, a secret or
free text.

**Files.**
- `logger.ts`: `createLogger` and the `EVENTS` list. A step that logs a new event adds it there; anything else is
  logged as `log.unknown_event`.
- `scrub.ts`: `scrub`, the second line of defence after the field allowlist. It replaces control characters,
  redacts emails, DIDs, addresses, credentials and keys as `[redacted]`, and truncates. Input is capped before the
  patterns run, and the patterns are kept linear (P1.37o).

**Who uses it.** Every server process and adapter that logs: [[http]], [[postgres]], [[pds]] and [[session]].

**Links.** [[http]], [[errors]]; SE-7 in `docs/human/engineering/engineering-rules.md`; `docs/ai/book/phase-1.md` P1.03.
