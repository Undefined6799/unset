# unset.sh lexicons

The [AT Protocol](https://atproto.com) lexicons of [unset.sh](https://unset.sh): the record types an account uses for
its profile and its pages, under the `sh.unset.*` names.

**Status: draft, not yet published on the network.** Until they are published, names, fields and limits may still
change. Do not build on them yet without expecting changes. This line is removed when they are published.

## What is here

Each file under `lexicons/` is one lexicon, at the path its name gives (`sh.unset.card` is
`lexicons/sh/unset/card.json`), which is the layout `goat lex` reads by default.

Records, stored in an account's repository:

- `sh.unset.profile`: who an account is: the name, headline, picture and other details shown at the top of its
  pages, and whether directories may list it. One per account, at the record key `self`.
- `sh.unset.page`: one page of an account: the ordered list of the cards it shows, and who the page is meant for.
  The page at the record key `self` is the account's main page; pages under other keys are shown nowhere yet.
- `sh.unset.card`: one card. It holds exactly one block, plus an optional width and surface. A card shows only on a
  page that lists it.

Blocks, the content a card holds. Each is its own lexicon, so another record type can reuse it:

- `sh.unset.block.text`: formatted text in Markdown, shown like a README.
- `sh.unset.block.links`: a set of links, such as accounts on other sites.
- `sh.unset.block.showcase`: titled items such as projects, writing or talks.
- `sh.unset.block.buttons`: a short pitch with up to five buttons, each an email address or a link.
- `sh.unset.block.images`: one picture, or a small set shown together.
- `sh.unset.block.defs`: the shapes blocks share: a picture with its alt text and proportions.

Permission set, for OAuth:

- `sh.unset.authFull`: everything unset.sh writes in an account's repository: the profile, its pages and their cards.

What a reader of these records must do (hide a block type it does not know, never render raw HTML from text, accept
only cards from the page's own repository) is written in each lexicon's `description` fields.

## Where changes are decided

This repository is a copy. The lexicons are edited, checked and reviewed in the unset.sh application repository,
[Undefined6799/unset](https://github.com/Undefined6799/unset), under `shared/lexicons/`. Every change merged there is
copied here by a workflow, and each commit here links the commit it came from. Nothing is edited here by hand, and a
file changed here directly is replaced by the next copy.

Issues and pull requests are welcome here. See [CONTRIBUTING.md](CONTRIBUTING.md) for what happens to them.

## Licence

MIT, see [LICENSE](LICENSE). The unset.sh application itself is AGPL-3.0; these lexicons are not, so that any app can
read and write the same records.
