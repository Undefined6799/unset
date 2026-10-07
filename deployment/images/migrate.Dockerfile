# The migrate image (P1.29k; architecture record 2026-10-07-p129-migrate-image-and-run-only-images, point 1): the
# one-shot Compose `migrate` service, `node infrastructure/postgres/migrate-cli.ts`, holding the migrator credentials
# only. Two stages on the locked Node base (deployment/images/bases.lock.json), the same digest as the web image:
# install production dependencies, then copy only what the CLI loads into a runtime stage that runs as 65532. Node
# runs the TypeScript sources directly, so there is no build stage. The stages install no OS packages.

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json package.json
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/shared shared
# config.ts checks PG_HOST through net-guard's address classes (its `classifyAddress`), so net-guard ships too.
COPY --from=deps /app/infrastructure/net-guard infrastructure/net-guard
COPY --from=deps /app/infrastructure/postgres infrastructure/postgres
# The CLI needs node only, so every package manager the base may ship leaves the runtime, as in node-app.Dockerfile.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  /usr/local/bin/pnpm /usr/local/bin/pnpx
USER 65532:65532
ENTRYPOINT ["node", "infrastructure/postgres/migrate-cli.ts"]
