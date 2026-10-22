# P2.24c / ADR 0027: build only the paired upstream frontend.
# P1.27s keeps the existing pinned upstream builder pending mirror rollout.
# hadolint ignore=DL3026
FROM docker.io/library/node:26-trixie-slim@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS ui-build
COPY source.lock.json /source.lock.json
ADD --checksum=sha256:706ab7fa7410a406ed3d4e67837662e21ade7d4be4f6a33a491703c0805b0555 https://codeload.github.com/bluesky-social/atproto/tar.gz/a7c8604d876a200a1e4fa4aec83d4189ac4f1c12 /tmp/atproto.tar.gz
# BuildKit tmpfs keeps source/dependencies out of layers; only /dist survives.
# See https://docs.docker.com/reference/dockerfile/#run---mounttypetmpfs.
# Exact pnpm and frozen upstream lock; dependency lifecycle scripts never run. pnpm 11.11.0 has no dependencies, so
# its one tarball is checked against the registry's published integrity (npm view pnpm@11.11.0 dist.integrity,
# read 2026-10-22) and installed offline from that file.
ENV PNPM_INTEGRITY=sha512-RGP2X9gO2A1pvB1L8WPulPYFxzgPwxi7Wy6+FfjNEtScUaTVnpUbQB52TTtsp1HL9RvFDtcAGmvLSTXmhMNIgg==
# hadolint ignore=DL3016
RUN --mount=type=tmpfs,target=/build,size=4294967296 \
    test "$(node --version)" = "v26.10.0" \
    && tar -xzf /tmp/atproto.tar.gz -C /build \
    && cd /build/atproto-a7c8604d876a200a1e4fa4aec83d4189ac4f1c12 \
    && node -e 'const fs=require("node:fs"),c=require("node:crypto"),a=require("node:assert/strict"),l=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));a.equal(l.source.revision,"a7c8604d876a200a1e4fa4aec83d4189ac4f1c12");a.equal(c.createHash("sha256").update(fs.readFileSync("pnpm-lock.yaml")).digest("hex"),l.source.lockSha256);a.equal(process.versions.node,l.builder.node);a.equal(require("./package.json").packageManager,"pnpm@"+l.builder.pnpm);for(const [p,n,v] of [["packages/pds","@atproto/pds","0.5.37"],["packages/oauth/oauth-provider","@atproto/oauth-provider","0.23.1"],["packages/oauth/oauth-provider-ui","@atproto/oauth-provider-ui","0.10.5"]]){const j=require("./"+p+"/package.json");a.equal(j.name,n);a.equal(j.version,v);}' /source.lock.json \
    && find . -type f -exec sha256sum {} + > /build/source.sha256 \
    && npm pack --pack-destination /build --cache /build/npm-cache pnpm@11.11.0 \
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
FROM ghcr.io/bluesky-social/pds:0.4.5037@sha256:3a8feb3415e319dbcc13372293b7ef1fb05a318a6ff1d55968cf99ba6633c5d4
RUN rm -rf /app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.5/node_modules/@atproto/oauth-provider-ui/dist
COPY --from=ui-artifact /dist/ /app/node_modules/.pnpm/@atproto+oauth-provider-ui@0.10.5/node_modules/@atproto/oauth-provider-ui/dist/
