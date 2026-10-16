# Vendored lexicons

Copied from github.com/bluesky-social/atproto at tag `@atproto/api@0.23.0` (commit
a7c8604d876a200a1e4fa4aec83d4189ac4f1c12, published 2026-10-02), path `lexicons/<authority path>/<name>.json`.
`lex install` resolves each NSID through its `_lexicon` DNS TXT record; the build sandbox cannot query TXT records,
so the files come from the tagged source instead (P1.31 record). biome reformats whitespace, so the hash is of the
JSON value (`JSON.stringify(JSON.parse(file))`), which equals the upstream file's; `vendor_files_pinned` checks it.

| File | sha256 of the JSON value |
| --- | --- |
| app.bsky.actor.profile.json | 35ae081b54c2e0e266f4ab54fdd563873c2d95964b719a428545a8311155224f |
| com.atproto.label.defs.json | 8ddce1a7ec654fe807ef354cffbd2e0ecc16c937b3f91b554604764be1b28c4b |
| com.atproto.repo.strongRef.json | 66379e298b8ea897ef94524bdbf9abf7ae2bafcd97f0a82cb716139e350dee9e |
