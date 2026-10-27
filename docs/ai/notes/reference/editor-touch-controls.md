---
id: editor-touch-controls
type: reference
status: current
areas: ["[[web]]", "[[ui]]", "[[tests]]"]
summary: "Touch editor controls follow pointer input and the visible viewport, independently of the README's width."
code: [apps/web/src/editor, shared/ui/components/Profile, shared/ui/components/Readme, tests/e2e/editor.spec.ts]
sources: [https://github.com/TypeCellOS/BlockNote/tree/v0.56.0/packages/react/src/components, https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport]
importance: normal
related: ["[[web]]", "[[ui]]", "[[tests]]"]
replaced_by: null
tags: [reference, web, ui, tests]
checked: 2026-10-26
---
# Editor touch controls

BlockNote 0.56.0's React controllers distinguish desktop selection formatting from mobile formatting above the
software keyboard. Unset keeps the headless engine because ADR 0037's Trusted Types policy excludes that UI's
HTML snapshots. The interaction adapter writes placement through CSSOM, as the existing editor already did.

Viewport width cannot identify touch: a tablet may have a hardware keyboard, and a desktop window may be narrow.
Initial input follows `any-pointer: coarse`; actual pointer events switch between mouse and touch/pen. Phone layouts
below 768px also use compact controls with a mouse, so resizing a preview never restores the desktop handles in
phone size. Input modality stays separate from this presentation choice. Controls remain available while focus is
in the editor or its controls. Docking uses the visual viewport intersected with
the app's clipping scroll container, including when there is no software keyboard. Caret scrolling waits until a
pointer gesture finishes so focus cannot shift the target out from under a tap.

Compact layouts have a labeled block action sheet instead of desktop +/drag controls. Double tapping a block background opens
it; holding then dragging reorders siblings. Text and interactive controls keep their native gestures. A normal
swipe cancels before the hold threshold. Move buttons remain available as an alternative to gestures.

Reading and editing share container thresholds so opening the editor does not change the column layout. Explicit
Move up/down is a single transaction, retaining nested content and undo; touch never depends on dragging.

`/fixture/editor` uses synthetic content and the normal app CSP. Browser tests cover 1440, 900 and 390px separately
with and without touch capability. Emulation does not replace an actual mobile keyboard or native text-selection
test on a physical touch device.
