# P2.24c / ADR 0027: build only the paired upstream frontend.
# P1.27s keeps the existing pinned upstream builder pending mirror rollout.
# P1.38h: atproto 0.5.49 (5d6febdd package.json devEngines) requires Node ^26.12.1; P1.38j pairs this builder.
# hadolint ignore=DL3026
FROM docker.io/library/node:26.12.1-trixie-slim@sha256:36793bcbb160a6a16cede1e62b93f84e26b78a972a8a4c0b879c1c12f22761ec AS ui-build
COPY source.lock.json /source.lock.json
# P2.24x: the unset.sh theme, appended to upstream's stylesheet before the source is hashed.
COPY ui/unset-theme.css /unset-theme.css
ADD --checksum=sha256:d607296e338b066c6efb1282a8bbc05fd76009907453b20c6098c0fa739bb9be https://codeload.github.com/bluesky-social/atproto/tar.gz/5d6febdd96671891bd82f07fece7eb089c6fe931 /tmp/atproto.tar.gz
# BuildKit tmpfs keeps source/dependencies out of layers; only /dist survives.
# See https://docs.docker.com/reference/dockerfile/#run---mounttypetmpfs.
# Exact pnpm and frozen upstream lock; dependency lifecycle scripts never run. pnpm 11.11.0 has no dependencies, so
# its one tarball is checked against the registry's published integrity (npm view pnpm@11.11.0 dist.integrity,
# read 2026-10-22) and installed offline from that file. It is packed from /build, outside the upstream checkout,
# whose devEngines names pnpm and makes npm refuse to run there (EBADDEVENGINES, npm 11.19.1).
ENV PNPM_INTEGRITY=sha512-RGP2X9gO2A1pvB1L8WPulPYFxzgPwxi7Wy6+FfjNEtScUaTVnpUbQB52TTtsp1HL9RvFDtcAGmvLSTXmhMNIgg==
# hadolint ignore=DL3016
RUN --mount=type=tmpfs,target=/build,size=4294967296 \
    test "$(node --version)" = "v26.12.1" \
    && tar -xzf /tmp/atproto.tar.gz -C /build \
    && cd /build/atproto-5d6febdd96671891bd82f07fece7eb089c6fe931 \
    && node -e 'const fs=require("node:fs"),c=require("node:crypto"),a=require("node:assert/strict"),l=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));a.equal(l.source.revision,"5d6febdd96671891bd82f07fece7eb089c6fe931");a.equal(c.createHash("sha256").update(fs.readFileSync("pnpm-lock.yaml")).digest("hex"),l.source.lockSha256);a.equal(process.versions.node,l.builder.node);a.equal(require("./package.json").packageManager,"pnpm@"+l.builder.pnpm);for(const [p,n,v] of [["packages/pds","@atproto/pds","0.5.49"],["packages/oauth/oauth-provider","@atproto/oauth-provider","0.24.3"],["packages/oauth/oauth-provider-ui","@atproto/oauth-provider-ui","0.10.7"]]){const j=require("./"+p+"/package.json");a.equal(j.name,n);a.equal(j.version,v);}' /source.lock.json \
    && cat /unset-theme.css >> packages/oauth/oauth-provider-ui/src/style.css \
    && find . -type f -exec sha256sum {} + > /build/source.sha256 \
    && (cd /build && npm pack --cache /build/npm-cache pnpm@11.11.0) \
    && node -e 'const c=require("node:crypto"),fs=require("node:fs"),a=require("node:assert/strict");a.equal("sha512-"+c.createHash("sha512").update(fs.readFileSync("/build/pnpm-11.11.0.tgz")).digest("base64"),process.argv[1]);' "$PNPM_INTEGRITY" \
    && npm install --prefix /build/tool --cache /build/npm-cache --offline --ignore-scripts --no-audit --no-fund /build/pnpm-11.11.0.tgz \
    && test "$(/build/tool/node_modules/.bin/pnpm --version)" = "11.11.0" \
    && /build/tool/node_modules/.bin/pnpm --filter '@atproto/oauth-provider-ui...' install --frozen-lockfile --ignore-scripts --store-dir=/build/store \
    && /build/tool/node_modules/.bin/pnpm exec tsc --build \
        packages/oauth/oauth-provider-api/tsconfig.build.json \
        packages/oauth/oauth-scopes/tsconfig.build.json \
        packages/internal/fetch/tsconfig.build.json \
        packages/internal/rolldown-plugin-bundle-manifest/tsconfig.build.json \
    && /build/tool/node_modules/.bin/pnpm --filter @atproto/oauth-provider-ui run i18n:compile \
    && /build/tool/node_modules/.bin/pnpm --filter @atproto/oauth-provider-ui run build:ui \
    && sha256sum -c /build/source.sha256 > /build/source-verified.log \
    && dist=packages/oauth/oauth-provider-ui/dist \
    && node -e 'const fs=require("node:fs"),c=require("node:crypto"),a=require("node:assert/strict"),p=require("node:path"),d=process.argv[1],file=p.join(d,"bundle-manifest.json"),m=JSON.parse(fs.readFileSync(file,"utf8"));for(const [n,i] of Object.entries(m)){a.match(n,/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/);a.ok(i&&typeof i==="object"&&!Object.hasOwn(i,"data"));a.equal(typeof i.sha256,"string");a.ok(fs.lstatSync(p.join(d,n)).isFile());for(const r of i.dynamicImports??[])a.ok(Object.hasOwn(m,r));i.sha256=c.createHash("sha256").update(fs.readFileSync(p.join(d,n))).digest("base64");}fs.writeFileSync(file,JSON.stringify(m,null,2));' "$dist" \
    && cp -a "$dist" /dist

FROM scratch AS ui-artifact
COPY --from=ui-build /dist/ /dist/

# ADR 0027: inherit the complete official runtime Config unchanged.
FROM ghcr.io/bluesky-social/pds:0.4.5049@sha256:cca85fd07701ea3370ff5a3a0f38a4c108d45d49aa75944e38f45c186d9528cf
RUN rm -rf /app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.7/node_modules/@atproto/oauth-provider-ui/dist
COPY --from=ui-artifact /dist/ /app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.7/node_modules/@atproto/oauth-provider-ui/dist/
