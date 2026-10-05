# AI notes

`docs/ai/` is the working-material vault for agents: the plan ([`PLAN.md`](PLAN.md)), the step book
([`book/`](book/)) and the AI notes under [`notes/`](notes/). Rules approved by Alex 2026-10-04 22:11Z,
enforced by `scripts/guards/notes.ts` (step P0.09d).

## What a note is for
Code is the truth. A note keeps only what the code cannot say: why, a trap, how an
outside system really behaves, or where unfinished work stands. If the code already
says it, link the code and write nothing. Product decisions are not notes: they live
once, as ADRs in `docs/human/decisions/`, and a note links to the ADR.

## Order (where things go)
```
docs/ai/
  README.md          these rules
  INDEX.md           generated list: id, type, areas, summary (never hand-edited)
  PLAN.md            the plan
  book/              the step book
  notes.base         Obsidian Bases table of all notes
  notes/
    area/            map of one part of the code: what lives where, how it fits
    reference/       how an outside system really works, checked against its spec
    pitfall/         a trap we hit or nearly hit, and the rule that avoids it
    how-to/          a repeatable procedure (deploy, restore, add a lexicon)
    handoff/         unfinished work for the next agent; deleted when the work lands
```
Five types, one folder each. Nothing else goes under `notes/`.

## The header (every field required, closed lists)
```yaml
---
id: invite-exports-room-history
type: pitfall
status: current
areas: ["[[messaging]]", "[[matrix]]"]
summary: One line, own words, at most 120 characters.
code: [domains/messaging/rooms.ts]
sources: [https://spec.matrix.org/latest/client-server-api/#room-history-visibility]
importance: high
related: ["[[matrix-room-access-control]]"]
replaced_by: null
tags: [pitfall, messaging, matrix]
checked: 2026-10-04
---
```
- `id`: the file name without `.md`, kebab-case. Ids are unique across all folders.
- `type`: area, reference, pitfall, how-to or handoff; the note sits in `notes/<type>/`.
- `status`: current or replaced. A replaced note sets `replaced_by: "[[newer-note]]"`; a current one has `null`.
- `areas`: one or more `"[[area]]"` links from the list below.
- `summary`: own words, at most 120 characters.
- `code`: files or folders where the truth lives; `[]` only if no code exists yet.
- `importance`: high (must read before touching the areas) or normal.
- `related`: `"[[note-id]]"` links to neighbour notes, `[]` if none.
- `tags`: exactly the type plus the area names, for Obsidian's tag pane.
- `checked`: the last date (YYYY-MM-DD) someone confirmed the note is still true.

The guard reads the header with a small parser, not a YAML library: one `key: value` per line,
values are `null`, a plain word, a `"double-quoted"` string (no backslashes) or a one-line
`[list]`. No comments and no multi-line values. Quote a value that contains `: ` or `"`, or that
YAML would read as a boolean or number (`true`, `404`). `code:` paths are plain repo-relative
paths (no `./`, `..` or `//`), and `checked` is never after today.

Allowed `areas`: web, admin, chat, http, api, indexer, media, review, pds-admin,
chat-admin, identity, content, social, feed, messaging, moderation, privacy,
postgres, pds, tap, matrix, storage, arachnid, email, net-guard, seal, audit,
lexicons, ui, config, errors, i18n, deployment, tests, ci, docs.
A new area is added here, and in `AREAS` in the guard, only when its folder is created.

## Body (keep under 60 lines; split if longer)
- **area:** What it owns. Entry points. How data flows in and out. Links.
- **reference:** The rule, with the spec link and the pinned version. What we rely on. Links.
- **pitfall:** What goes wrong. Why. The rule. Can it be repaired later? Links.
- **how-to:** When to use it. Steps. How to check it worked.
- **handoff:** Goal. Done so far. Next step. Open questions. Delete when done.

Link other notes with `[[note-id]]` in the body too; a link never needs a folder path.

## Rules
1. One fact per note; one screen long. Split rather than grow.
2. The summary is written in our own words, never pasted from a web page, a spec or
   a chat. Quotes go in the body, marked as quotes, with the source link.
3. `reference` notes need at least one official source and the version checked.
4. Correct by adding, not rewriting: a newer note sets `replaced_by` on the old one,
   which flips to `status: replaced`. Handoffs are the exception: delete them.
5. Never secrets, tokens, personal data or real user handles. The secret scan runs on
   every commit.
6. Old 0x40 notes are not copied wholesale. A note is ported only when a step needs it,
   re-checked against the current spec and code, and given a fresh `checked` date.

## Obsidian (open `docs/ai/` as the vault)
Built-in features only, no community plugins:
- **Properties:** the header shows as a properties panel; `areas`, `related` and `replaced_by` are clickable.
- **Graph and backlinks:** every note joins its area hub in the graph, and each area note's
  backlinks list everything about that area. An area with no note yet shows as a grey dot.
- **Area notes are the hubs:** `notes/area/identity.md` and so on, one per area, named exactly like the area.
- **Tags pane:** groups notes by type and area.
- **Bases view:** [`notes.base`](notes.base) is a table of all notes with views for must-reads
  and open handoffs, sorted by `checked`.
- **Graph colours:** `.obsidian/graph.json` colours pitfalls red, references blue, handoffs
  amber and how-tos green. The rest of `.obsidian/` is git-ignored.
- **Plain links still work outside Obsidian:** [`INDEX.md`](INDEX.md) uses normal Markdown links.

## Finding notes
- Scan [`INDEX.md`](INDEX.md).
- `grep -rl "\[\[identity\]\]" docs/ai/notes` lists every note about identity.
- `grep -rl "importance: high" docs/ai/notes` lists the must-reads; read them before touching an area.

## Keeping it maintained
Enforced by the repo, not by memory. `npm run guards` (CI and the pre-commit hook) fails when:
1. `[notes-header]` a field is missing, unknown, unreadable or outside its list;
   `[notes-id]` the `id` differs from the file name, the note is outside its type's folder, or
   two notes share an id; `[notes-summary]` the summary is empty or over 120 characters;
   `[notes-tags]` `tags` are not exactly the type plus the areas.
2. `[notes-link]` `related` or `replaced_by` names no note, or a `code:` path does not exist.
3. `[notes-index]` the committed `INDEX.md` differs from the generated one. Run `npm run notes:index`.
4. `[notes-code-moved]` the change touches a file named in a note's `code:` (or a file inside a
   named folder) and not that note. Update the note, or bump `checked` if it is still true.
   In CI the change is `BASE_SHA...HEAD`, and a missing base fails; locally it is the working
   tree against the merge-base with `origin/main`.
5. `[notes-handoff-age]` a handoff's `checked` is more than 14 days old. Finish it or delete it.

It warns, without failing, when a `current` note's `checked` is more than 90 days old, or when
an area's code folder exists (for example `domains/identity/`) with no `notes/area/<area>.md` hub.

Every PR fills the template line "AI notes: updated / none needed / which", and each step's
done-check in the book includes "notes updated or none needed". Each phase's refine step runs a
short tidy pass: re-check the warned notes, merge duplicates, mark replaced notes, delete finished
handoffs, and port any old 0x40 note the coming phase needs. One commit, reviewed like code.
