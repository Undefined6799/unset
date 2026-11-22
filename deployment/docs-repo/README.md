# unset docs

The documentation of [unset](https://unset.sh), gathered in one place from the repositories it is written in.
[docs.unset.sh](https://docs.unset.sh) is built from this repository on every push.

**Nothing here is edited by hand.** Each folder is a copy of one repository's documentation. That repository's own
pipeline replaces its folder whenever its docs change on `main`, and each commit here names the commit it was copied
from. To change a page, change it where it is written:

| Folder | Written in | What it holds |
| --- | --- | --- |
| [`unset/`](unset/) | [Undefined6799/unset](https://github.com/Undefined6799/unset): `docs/human` and `docs/site` | The app: its architecture, decisions, runbooks and guides, and the documentation site built from them |

A pull request opened here cannot be merged, because the next copy would replace it. Open it, or an issue, on the
repository named in the table.

Each folder keeps the licence of the repository it comes from. `unset/` is AGPL-3.0-only, Copyright (c) 2026 Alex
(Undefined6799).
