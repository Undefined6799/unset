---
id: safari-no-pointerdown-after-drag
type: reference
status: current
areas: ["[[web]]", "[[ui]]"]
summary: On macOS Safari the first press after a native drag sends no pointerdown, so a card menu needs a second press.
code: [apps/web/lib/components/profile/card-controls.svelte]
sources: [https://bugs.webkit.org/show_bug.cgi?id=202287, https://bugs.webkit.org/show_bug.cgi?id=222632]
importance: normal
related: ["[[web]]", "[[ui]]"]
replaced_by: null
tags: [reference, web, ui]
checked: 2026-11-19
---
# Safari sends no pointerdown on the first press after a native drag

What happens: on a large screen a member drags a card by its top bar. That is native HTML drag and drop
(`draggable`, `dragstart`, `dragover`, `drop` in `card-controls.svelte`), with no pointer capture or pointer listener
of ours. After the drop, the first press on a card's three-dot menu does nothing in Safari on macOS. A second press
opens it, and so does a reload.

Why: WebKit bug 202287, "pointerdown events not fired after drag and drop", has been open since 2019. It was last
active 2026-01-12, and reports cover Safari 13 through 17.6. Bug 279749 (Safari 17, 2024) is a duplicate of it.
A comment on 202287 traces it to WebKit's PointerCaptureController keeping the pointer marked as pressed after the
drag. So the next press sends `pointermove` where `pointerdown` belongs, while `mousedown` still fires. A related
open bug, 222632, records that macOS Safari never sends the `pointercancel` the spec requires on `dragstart`.

Why it shows in our menus: Bits UI 2.20.6 opens a dropdown on `pointerdown`. Its trigger ignores a mouse `click`
whose `detail` is not 0, and keeps that path for keyboard and VoiceOver clicks only (node_modules/bits-ui
dist/bits/menu/menu.svelte.js, DropdownMenuTriggerState). With no `pointerdown`, the first press is lost.

Seen first in Playwright 1.64.1's WebKit during #1754 (2026-11-19). The WebKit bugs above show real Safari does the
same. Chromium and Firefox are not affected.

Status: Alex decided on 2026-11-19 to leave our code as it is and report it to Bits UI. A report is drafted for
him to file; there is no workaround in our code.
A member recovers with a second press. A test that drags a card and then opens a card menu in WebKit must expect
this, or reload first.
