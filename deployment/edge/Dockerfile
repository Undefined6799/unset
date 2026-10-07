# syntax=docker/dockerfile:1
# The edge image (P1.28; ADR 0018): standard Caddy plus exactly one plugin, github.com/mholt/caddy-ratelimit, built
# with xcaddy at pinned versions, on the official Caddy Alpine images pinned by index digest
# (deployment/images/bases.lock.json). Built from deployment/edge as the context; scanned in the images workflow's
# edge job (P1.28q). Nothing is pushed or signed until P1.27s.

# Upstream base until P1.27s mirrors it (book edits 2026-10-06-p127-upstream-base-by-digest, 2026-10-07-p128-edge-bases-and-ratelimit-adr); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/caddy:2.11.7-builder-alpine@sha256:80331d37e7d4d230f186f2707079e279f32552924f101ee659e8cae9f9877c26 AS build
# Module downloads go through the default proxy (proxy.golang.org) and are checked against the checksum database
# (sum.golang.org); none of GONOSUMDB, GONOSUMCHECK, GOINSECURE, GOPRIVATE or an insecure flag is set. With
# -mod=readonly the final `go build` fails if go.mod would change after xcaddy's `go get` and `go mod tidy` (Go 1.27:
# cmd/go/internal/modload/init.go setDefaultBuildMod; `go get` omits the -mod flag, modget/get.go:270).
ENV GOFLAGS=-mod=readonly
RUN xcaddy build v2.11.7 \
      --with github.com/mholt/caddy-ratelimit@v0.1.1-0.20260612195517-5625512f24f6 \
      --output /out/caddy

# Upstream base until P1.27s mirrors it (book edits 2026-10-06-p127-upstream-base-by-digest, 2026-10-07-p128-edge-bases-and-ratelimit-adr); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset" \
      org.opencontainers.image.licenses="AGPL-3.0-only AND Apache-2.0"
COPY --from=build /out/caddy /usr/bin/caddy
# The built binary gets cap_net_bind_service only, so it binds 80 and 443 as a non-root user; then setcap's package,
# curl and the base's sample site go.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
    && apk del --no-network curl libcap \
    && rm -rf /usr/share/caddy /etc/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY snippets/ /etc/caddy/snippets/
COPY sites/pds.caddy /etc/caddy/sites/pds.caddy
USER 65532:65532
WORKDIR /etc/caddy
EXPOSE 80 443
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/health"]
ENTRYPOINT ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
