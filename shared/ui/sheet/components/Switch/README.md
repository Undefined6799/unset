# Switch

An on/off setting drawn as text, like the Checkbox: `[──◉] on` in `success` when on, `[○──] off` in `ink-muted` when off, with the label on the left; a real checkbox with `role="switch"` sits underneath.

**Approved by Alex 2026-10-03.**

## Provide

- `label`; `defaultChecked`, or `checked` + `onChange(event)`; `name`, `value`, `disabled`.

## Use

- For a setting that takes effect as a whole, like "show my email" or a privacy switch; use a Checkbox when the choice is one of several in a form.
- Label on the left, the switch on the right of the same row; rows are 40px tall and stack with a `line` hairline between them in a settings list.
- The words "on" and "off" are always shown, so the state never depends on colour. The ◉ and ○ reuse the live/offline meaning.
- Works with no JavaScript: the look follows the real checkbox through CSS, and the form posts it like any checkbox. A setting that saves at once (no Save button) says so in a Toast.
- Focus puts the 2px `focus` outline around the bracket group.
