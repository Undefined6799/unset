# PDS debug logging

The only way to turn the PDS's own request logging on. It stays off because, when on, the PDS's `pino-http` logger
writes each request with pino's standard request serializer (the client's address and port) and every header, with
only `authorization` and `dpop` obscured (`packages/pds/src/logger.ts` lines 40 to 58 in bluesky-social/atproto,
`@atproto/pds` 0.5.37, read 2026-10-07). `LOG_ENABLED` turns it on for `true`, `t` or `1` in any case, and
`LOG_DESTINATION` names the file it writes to (`packages/common/src/logger.ts` lines 3 and 4, same read). The deploy
preflight fails C12 unless `LOG_ENABLED` is absent or exactly `false`, so a debugging session cannot be carried
across a deploy by mistake.

**Who:** Alex only.

## Steps

1. Set `LOG_ENABLED=true` and `LOG_DESTINATION` to a path on a tmpfs mount inside the PDS container (never a volume
   or a bind mount), then restart the PDS.
2. Reproduce the problem.
3. Copy out only the lines you need, after removing every address, port and header from them. Nothing else leaves
   the container.
4. Set `LOG_ENABLED=false` (or remove it) and restart the PDS. The restart clears the tmpfs.
5. Add a line to the log below.
6. Run the preflight; C12 passes again.

## Log

| Date | Why | Turned off |
| --- | --- | --- |
