---
title: Decisions
weight: 6
---

Decisions that are expensive to reverse are ADRs, one file each in [`docs/human/decisions/`](https://github.com/Undefined6799/unset/tree/main/docs/human/decisions). Accepted records stay as written. The files are not rendered on this site.

Each ADR records its own status, acceptance and supersession in front matter ([ADR 0083](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0083-each-adr-is-its-own-record.md)), so this table is built from the files each time the site is built; `npm run adr:index` prints the same table. The folder's [README](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md) explains the format. Every ADR file on main is one row.

Handles on main are `<user>.unset.name`, and on the development system `<user>.staging.unset.name`. [ADR 0064](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0064-handles-move-to-unset-name.md) records that move and is still Proposed (awaiting Alex). [ADR 0063](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0063-handle-records-written-on-claim.md) is Proposed (awaiting Alex) as well. Preflight C15 pins the development PDS to `.staging.unset.name` (`deployment/preflight/checks/settings.ts`). The 0025 row below keeps its frozen text, which still names the handle domain `unset.im`.

{{% adr-index %}}
