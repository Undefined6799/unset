---
title: Docs rules
weight: 4
---

Notes, decision records, and the pages on this site. Where a fact already lives in code, these pages link the file.

## Notes

The vault rules are [`docs/ai/README.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/README.md). [`scripts/guards/notes.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/notes.ts) enforces the header, the links, the index, a moved `code:` path, and handoff age. The header parser is `scripts/guards/notes-header.ts`. Both run under `npm run guards`.

Five types, one folder each under `docs/ai/notes/`: `area`, `reference`, `pitfall`, `how-to`, `handoff`. Nothing else goes in `notes/`.

| Check | Fails when |
| --- | --- |
| `notes-header`, `notes-id`, `notes-summary`, `notes-tags` | A field is missing, unreadable, or outside its list. The id disagrees with the file name. The summary is empty or over 120 characters. `tags` are not the type plus the area names |
| `notes-link` | `related`, `replaced_by`, or a `code:` path does not resolve |
| `notes-index` | The committed `docs/ai/INDEX.md` differs from the generated text |
| `notes-code-moved` | A change touches a path named in `code:` and leaves that note untouched |
| `notes-handoff-age` | A handoff's `checked` date is more than 14 days ago |

A `current` note whose `checked` date is more than 90 days ago is a warning. An area folder with no `docs/ai/notes/area/<area>.md` hub is a warning. Warnings leave the command green.

## INDEX.md

[`docs/ai/INDEX.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/INDEX.md) is generated. Hand-editing it fails `notes-index` on the next guard run.

```sh
npm run notes:index
```

That is `node scripts/guards/notes.ts`. When every header parses, the command rewrites the index. A header error prints the findings and leaves the file alone.

## ADRs

Records in [`docs/human/decisions/`](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md) stay as history. [`scripts/docs/docs.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/docs/docs.ts) checks the index and, through `adrChangeProblem`, what a later change may do.

| Record | A later change may |
| --- | --- |
| An accepted ADR | Replace the status line with `Status: Superseded by NNNN`, naming an ADR file that exists. The rest of the file stays |
| `0001-phase-0-defaults.md` | Add lines at the end. This file is the append-only log |
| A new decision | Add the next numbered file, with the headings Context, Decision, Alternatives, Consequences and Compliance, and a row in the index |

`docs/human/decisions/**` is outside the docs-only allowlist on [Commits and pull requests](../commits-and-prs/). [DO-1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) and [DO-2](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) are the written rules. The index introduction states the same limit for an accepted record.

## This site

Pages under `docs/site/content/` follow the outline in [issue #1161](https://github.com/Undefined6799/unset/issues/1161). Hugo reads that tree. `docs/ai/` and `docs/human/` stay where the checks read them, and these pages link them.

| Practice | What a page does |
| --- | --- |
| One topic | One short page |
| Reference | Tables, the command the repository runs, and a path |
| Absent from `main` | Mark `(planned)` or `(planned, Phase N)` |
| Agent text and ADRs | Link the file. The page keeps the path and the status line |
| Security | Say what the check is for, and link the source |
| Order | `weight` in front matter. The navbar entries are `menu.main` in `docs/site/hugo.yaml` |

Preview from the repository root, with the image in [`docs/site/README.md`](https://github.com/Undefined6799/unset/blob/main/docs/site/README.md). The image is Hugo extended v0.168.0. The theme is Hextra v0.13.0 (`docs/site/go.mod`).

```sh
docker run --rm --entrypoint hugo -v "$PWD:/project" -w /project/docs/site ghcr.io/gohugoio/hugo:v0.168.0@sha256:1fb8fe7f417abd5802d86747d297728aa48078d763159e7dff6559fe3f8bb8e7 build --gc --minify --panicOnWarning
```

`--entrypoint hugo` skips the image entrypoint that runs `npm i` when a `package.json` is present. `docs/site/` has no `package.json`. `public/` and `resources/` are build output and are git-ignored.

## Generators on this tree

| Script | Role |
| --- | --- |
| `scripts/guards/notes.ts` | Rewrites `docs/ai/INDEX.md` |
| `scripts/docs/docs.ts` | Checks `CLAUDE.md`, the ADR set, the pull-request template, the book snapshot and the architecture rule table |
| `scripts/docs/legal.ts` | Checks `docs/human/legal/` |
| `scripts/docs/compliance.ts` | Checks `docs/human/compliance/` |
| `scripts/docs/outline.ts` | Checks the step-book dependency graph |
| `scripts/docs/triage.ts` | Parses the severity triage comment |
| `scripts/docs/endpoints.ts` | (planned). The file is not on the tree. [Endpoints](../../endpoints/) says the route pages will be generated from the manifests |

`scripts/docs/glue-spike.ts` recomputes the framework-glue measurements. It does not write this site.
