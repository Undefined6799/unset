# The web server image (P1.27). Three stages on one base: build the SSR bundle, install production dependencies, then
# copy only what `node interfaces/http/main.ts` loads into a runtime stage that runs as 65532 with no shell work after.
# Node runs the TypeScript sources directly (type stripping, Node 26). The base is the official Node Alpine image
# (Alex, 2026-10-07; musl builds of rolldown and lightningcss are in the lockfile), pinned by its multi-arch index
# digest, recorded in deployment/images/bases.lock.json; images.test.ts holds every FROM to that lock.

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
# Only the web app has an image so far; any other APP fails the build instead of producing a mislabelled image.
ARG APP=web
WORKDIR /app
COPY . .
RUN test "$APP" = web && npm ci --ignore-scripts
RUN npm run build -w @unset/apps-web

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json package.json
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/shared shared
COPY --from=deps /app/interfaces/http interfaces/http
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/web/dist apps/web/dist
# The server needs node only. The base's bundled npm (and its own dependencies, which Trivy flags) leaves the runtime;
# the official Node 26 Alpine image ships no yarn or corepack (nodejs/docker-node 26/alpine3.24/Dockerfile).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.LISTEN_PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "interfaces/http/main.ts"]
