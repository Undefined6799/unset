# Checkbox

A checkbox drawn as text: `[x]` in `success` when on, `[ ]` in `ink-muted` when off, then the label, all in `mono` 14px. A real checkbox sits underneath for keyboards and screen readers.

## Provide

- `label`; `defaultChecked`, or `checked` + `onChange(event)`; `name`, `value`, `disabled`.

## Use

- Labels lowercase and short, phrased as the thing that turns on.
- Stack checkboxes vertically; never in a row.
- Focus puts the 2px `focus` outline around the brackets.
