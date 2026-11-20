# 0073 — The Text card gets a Milkdown editor, and the CSP allows ProseMirror's one paste policy

Status: Accepted by Alex, 2026-11-20 13:08:50Z, against 76abad4. At 13:08:21Z he wrote "Merge 1827 and 1832"; the
coordinator answered at 13:08:26Z with the exact lines "Merge 1827 at 76abad4" and "Merge 1832 at 4c69b5e", and at
13:08:50Z he replied under them "Just do it with these 2 heads here", taken by the coordinator and the verifier as
naming both heads (ADR 0059). Merged as 93fa393. This status paragraph, the index row and the ADR 0001 acceptance
line were added afterwards in P1.21z. Alex asked for it on 2026-11-20 ("it feels pretty awful to write markdown right
now"). It loosens a security control (one Trusted Types policy name). Measurements are in #1827 (P1.21u).

## Context

The Text (README) card is written in a plain textarea with Write and Preview tabs (ADR 0051). Members have to know
markdown. Milkdown 7.23.0 (MIT, https://milkdown.dev) is a what-you-see editor built on ProseMirror that reads and
writes markdown through remark, so the stored value can stay the markdown the server parses today.

Two facts decide the shape, both read in the installed source:

- prosemirror-view 1.42.9, `dist/index.js` `maybeWrapTrusted`: to read pasted HTML it assigns the HTML to
  `innerHTML` on an element of a detached document, wrapped in a Trusted Types policy it creates named
  `ProseMirrorClipboard` (or the page's default policy, which we do not have). Our CSP allows only
  `svelte-trusted-html` and `sveltekit-trusted-url` (ADR 0054), so without the name `createPolicy` throws and paste
  fails.
- `@milkdown/kit` and `@milkdown/crepe` pull in Vue, CodeMirror, KaTeX and lodash; the separate packages do not.

## Decision

1. The owner's Text card editor uses `@milkdown/core`, `@milkdown/preset-commonmark`, `@milkdown/plugin-history`,
   `@milkdown/prose` and `@milkdown/utils`, all 7.23.0, pinned, imported only in `apps/web/lib/editor/`
   (dependency-cruiser `vendor-sdk-one-adapter`). No kit, Crepe, theme or icon package.
2. The plain textarea stays the field the form posts. With no script it is all there is. With script the editor is
   loaded when the Text editor opens, drawn over the field and writes its markdown back into it; text opened and
   saved untouched is posted exactly as stored. The server's parser (`apps/web/lib/profile/parse.ts`) and the
   lexicon caps stay the authority. Public profile pages run no script and are unchanged.
3. The app's CSP adds `ProseMirrorClipboard` to `trusted-types`. Nothing else in the policy changes: no
   `unsafe-inline`, no `unsafe-eval`, `script-src` and `style-src` stay file-only.
4. The parser follows CommonMark's backslash escapes and numeric character references (spec 0.31.2 "Backslash
   escapes", "Entity and numeric character references"), since remark-stringify writes `\*` for a literal star
   and `&#x62;` for a letter beside an italic inside a word.
5. The editor is styled only with our theme tokens and stock components; its buttons use our Iconoir set.

## What the policy name allows, and what still holds

Mechanism: Trusted Types makes the browser refuse a plain string at an HTML sink such as `innerHTML` unless it went
through a named policy the CSP lists. Adding the name lets exactly one policy, created by prosemirror-view, turn a
string into HTML. Its function passes the string through unchanged; that is how ProseMirror's own code is written,
and it is only ever given clipboard HTML, parsed in a detached document that is not shown.

Risks: a page script that calls `trustedTypes.createPolicy("ProseMirrorClipboard", ...)` first could use the name
for its own sink writes. Only our own bundle runs on app pages (script-src is our files plus SvelteKit's hashed
start-up script), so that needs code we shipped. A flaw in ProseMirror's paste parsing could at worst put pasted
content into the member's own editor, which then becomes markdown that the server parses and escapes like typed text.

What still holds: script-src still refuses inline scripts and inline event handlers, so markup with a script in it
does not run even inside the detached document (tests/e2e/text-editor.spec.ts pastes `<img onerror>` and
`<script>` and checks nothing ran). No other HTML sink gains a policy. The stored text is still parsed and escaped
on the server, and public pages load no script at all. Inline `style` attributes in pasted HTML (Chromium copies
computed styles that way) are refused by the app's `style-src-attr` while ProseMirror parses the paste; the browser
logs that in the member's own console only (the app has no CSP reporting endpoint), and nothing is lost, since markdown
keeps no styles.

## Alternatives

- Keep the plain field with Preview only: no new code or policy, but members still have to know markdown, which
  Alex found awful to write in.
- Tiptap: the same ProseMirror core, so the same size and the same policy name, but it stores JSON and treats
  markdown as an add-on, so keeping our stored markdown exact would be more work.
- CodeMirror with markdown highlighting: exact text, but not what-you-see, and it injects style elements, which
  needs a style nonce in the CSP: a larger loosening than one Trusted Types name.
- Milkdown's Crepe: a finished editor, but it brings Vue, CodeMirror and KaTeX and its own look and icons.

## Compliance

Parser tests cover the backslash escapes; browser tests under the app's real CSP cover the toolbar and markdown
shortcuts, a real keyboard copy and paste from a page with no CSP, in all three engines, with no Trusted Types
violation, a script in pasted markup not running, text saved untouched staying as
stored, and the phone layout; the existing card editor and no-script tests still pass; the gate test pins the
policy's exact text.

## Consequences

- Size: the editor is about 115 KiB gzip. With the bundle split (ADR 0069) it is its own file, fetched only when a
  member opens the Text editor. Until that split lands it is part of the one bundle signed-in pages load.
- Stored text: only text a member edits in the rich editor is rewritten by remark. The changes: `*` and `+` bullets
  become `-`, `1)` becomes `1.`, `~~~` fences become backticks, `***` rules become `---`, underline headings become
  `#` headings, closing `#`s go, extra blank lines collapse to one, a line break made with two spaces becomes a plain
  new line, a literal `*`, `_` or `[` gains a backslash, italic is written `_word_` and bold `**word**`
  whatever marker they had (so bold and italic together never make the `***` run the page reads wrongly), and a
  letter beside an italic inside a word becomes a numeric reference. Each renders as before on the page.
- Dependencies (ADR 0057): MIT throughout, maintained (ten releases in 2026), at least seven days old by
  `.npmrc` `min-release-age=7`, `npm audit` reports nothing new.
- Images are not offered: shared images are ADR 0070's work, and the editor's paste and upload hooks stay off.
