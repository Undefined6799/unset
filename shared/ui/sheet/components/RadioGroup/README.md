# RadioGroup

A set of choices drawn as text: `(•)` in `success` for the chosen one, `( )` in `ink-muted` for the rest, with real radio inputs underneath.

## Provide

- `options`: `[{ value, label }]`; `label` for the group (a legend, uppercase `label` style).
- `defaultValue`, or `value` + `onChange(value)`; `name`, `disabled`.

## Use

- Two to five options; more belongs in a Select.
- Arrow keys move between options, as with native radios.
