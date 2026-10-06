# Link

Two kinds of link: inline text links inside a sentence, and standalone links that stand on their own line.

## Provide

- `href` and `children`; any native anchor props.
- `variant`: `inline` (default) or `standalone`.

## Use

- `inline`: `link` colour (Pacific Cyan), 1px underline offset 3px, 2px on hover. Only inside running text.
- `standalone`: `ink`, `label` style, uppercased, ending in the 16px `next` Icon (the `external` Icon when it leaves unset.sh); underlines on hover. Use for "read the docs" rows and footers.
- Never colour a standalone link, and never use a Button where a link will do.
