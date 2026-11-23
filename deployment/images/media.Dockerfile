# The media image (book P2.19; ADR 0070 point 5): `node interfaces/media/main.ts`, the process on the media origin that
# answers a signed draft preview link with the one object it names, read from the store with its own read-only
# identity. Built like the indexer image: two stages on the locked Node base, production dependencies only, then a
# runtime stage that copies just the workspaces the process loads and runs as 65532. Node runs the TypeScript sources
# directly, so there is no build stage.
# node-app.test.ts media_image_copies_every_workspace_the_process_reaches fails when a workspace is missing.

FROM ghcr.io/undefined6799/mirror/node@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev

FROM ghcr.io/undefined6799/mirror/node@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/shared /app/shared
COPY --from=deps /app/domains/content /app/domains/content
COPY --from=deps /app/infrastructure/net-guard /app/infrastructure/net-guard
COPY --from=deps /app/infrastructure/seal /app/infrastructure/seal
COPY --from=deps /app/infrastructure/storage /app/infrastructure/storage
COPY --from=deps /app/interfaces/media /app/interfaces/media
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): as in the
# indexer image.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 && rm -rf /var/lib/apt/lists/*
# The process needs node only, so every package manager the base may ship leaves the runtime, apt and dpkg included,
# and dpkg's maintainer scripts with them, then the base's setuid and setgid files, as in node-app.Dockerfile.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
  /usr/local/bin/pnpm /usr/local/bin/pnpx \
  && apt-get purge --allow-remove-essential -y apt \
  && dpkg --purge --force-remove-essential --force-depends debconf dpkg libapt-pkg7.0 \
  && rm -f /var/lib/dpkg/info/*.preinst /var/lib/dpkg/info/*.postinst /var/lib/dpkg/info/*.prerm \
    /var/lib/dpkg/info/*.postrm /var/lib/dpkg/info/*.config \
  && rm -f /usr/bin/chage /usr/bin/chfn /usr/bin/chsh /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount /usr/bin/newgrp \
    /usr/bin/passwd /usr/bin/su /usr/bin/umount /usr/sbin/unix_chkpwd
USER 65532:65532
EXPOSE 8083
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.LISTEN_PORT ?? 8083}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "interfaces/media/main.ts"]
