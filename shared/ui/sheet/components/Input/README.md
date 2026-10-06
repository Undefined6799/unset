# Input

A single-line text field with a 1px `line-strong` border and the button's 2px corner (`radius-xs`), text in `mono` 14px.

## Provide

- `label`: shown above the field in `label` style, `ink-muted`, uppercased.
- `hint` (optional): helper text under the field in `ink-muted`.
- `error` (optional): turns the border `danger` and prints `[err] <error>` under the field. Write the error lowercase, without a full stop.
- Any native input props (`type`, `name`, `placeholder`, `value`, `onChange`, `disabled`…).

## Use

- Always give a label; a placeholder is an example value, never the label.
- 40px tall, the same height as a Button, so a field and a button sit on one line.
- Hover darkens the border to `ink-muted`; focus is the 2px `focus` outline offset 2px; disabled fills with `surface-raised`.
