# The edge image (P1.28; ADR 0018): standard Caddy plus exactly one plugin, github.com/mholt/caddy-ratelimit, built
# with xcaddy at pinned versions, on the official Caddy Alpine images pinned by index digest
# (deployment/images/bases.lock.json). Built from deployment/edge as the context; scanned in the images workflow's
# edge job (P1.28q). Nothing is pushed or signed until P1.27s.

# Upstream base until P1.27s mirrors it (book edits 2026-10-06-p127-upstream-base-by-digest, 2026-10-07-p128-edge-bases-and-ratelimit-adr); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/caddy:2.11.7-builder-alpine@sha256:d718a1d1431403c4a46698f33ad1c0f9dd5dd7fe2bae654d1027d275b6fb5fd7 AS build
# Module downloads go through the default proxy (proxy.golang.org) and are checked against the checksum database
# (sum.golang.org); none of GONOSUMDB, GONOSUMCHECK, GOINSECURE, GOPRIVATE or an insecure flag is set. With
# -mod=readonly the final `go build` fails if go.mod would change after xcaddy's `go get` and `go mod tidy` (Go 1.27:
# cmd/go/internal/modload/init.go setDefaultBuildMod; `go get` omits the -mod flag, modget/get.go:270).
ENV GOFLAGS=-mod=readonly
# Builder index d718a1d1 (tag 2.11.7-builder-alpine, Docker Hub last_updated 2026-10-20T08:52:39Z)
# sets GOLANG_VERSION=1.27.3. Rebuilding with it drops the fixed stdlib HIGH finding
# CVE-2026-111943 (crypto/x509, fixed in 1.27.3). The index is under 7 days old; the base-digest
# bump procedure allows that when the PR names the CVE. Caddy v2.11.7 go.mod still requires
# golang.org/x/net v0.59.0, so --replace pins v0.60.0 (proxy.golang.org, 2026-10-08T17:22:58Z),
# the fixed module for CVE-2026-78669. xcaddy v0.4.7 writes it as `go mod edit -replace`
# (github.com/caddyserver/xcaddy blob/v0.4.7/environment.go) and does not add an import.
RUN xcaddy build v2.11.7 \
      --with github.com/mholt/caddy-ratelimit@v0.1.1-0.20260612195517-5625512f24f6 \
      --replace golang.org/x/net=golang.org/x/net@v0.60.0 \
      --output /out/caddy

# Upstream base until P1.27s mirrors it (book edits 2026-10-06-p127-upstream-base-by-digest, 2026-10-07-p128-edge-bases-and-ratelimit-adr); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/caddy:2.11.7-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset" \
      org.opencontainers.image.licenses="AGPL-3.0-only AND Apache-2.0"
COPY --from=build /out/caddy /usr/bin/caddy
# The built binary gets cap_net_bind_service only, so it binds 80 and 443 as a non-root user; then setcap's package,
# curl and the base's sample site go, and apk-tools last, so the image ships no package manager (P1.28o).
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
    && apk del --no-network curl libcap \
    && rm -rf /usr/share/caddy /etc/caddy \
    && apk del --no-network apk-tools
COPY Caddyfile /etc/caddy/Caddyfile
COPY snippets/ /etc/caddy/snippets/
COPY sites/pds.caddy /etc/caddy/sites/pds.caddy
# Caddy keeps its ACME account and certificate keys under /data and its autosave under /config; the base leaves both
# root-owned with world-writable caddy directories inside. A fresh named volume copies the image's owner and mode, so
# both trees go to caddy at 0700, the base's sticky bit cleared too (P1.27o; book edit
# 2026-10-12-edge-data-volume-owner, amendments 1 and 2). Exec form, no shell; the images test admits exactly these
# two lines because final-stage-runs.json lists them.
RUN ["/bin/chown", "-R", "65532:65532", "/data", "/config"]
RUN ["/bin/chmod", "-R", "u=rwX,go=,-t", "/data", "/config"]
USER 65532:65532
WORKDIR /etc/caddy
EXPOSE 80 443
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/health"]
ENTRYPOINT ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
