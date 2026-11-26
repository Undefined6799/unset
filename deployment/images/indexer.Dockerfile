# The indexer image (book P3.05s PR 3; ADR 0052): `node interfaces/indexer/main.ts`, the process that reads our PDS's
# stream and repos into the idx schema as the indexer role. Built like the migrate image: two stages on the locked
# Node base (deployment/images/bases.lock.json, the same digest and GHCR mirror as the web image, P2.26b), production
# dependencies only, then a runtime stage that copies just the workspaces the process loads and runs as 65532. Node
# runs the TypeScript sources directly, so there is no build stage. The only OS package step is the temporary zlib
# upgrade below, as in the other Node images.
# node-app.test.ts indexer_image_copies_every_workspace_the_process_reaches fails when a workspace is missing.

FROM ghcr.io/undefined6799/mirror/node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev

FROM ghcr.io/undefined6799/mirror/node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/shared /app/shared
COPY --from=deps /app/domains/content /app/domains/content
COPY --from=deps /app/domains/identity /app/domains/identity
COPY --from=deps /app/domains/notifications /app/domains/notifications
COPY --from=deps /app/domains/profile /app/domains/profile
COPY --from=deps /app/infrastructure/firehose /app/infrastructure/firehose
COPY --from=deps /app/infrastructure/net-guard /app/infrastructure/net-guard
COPY --from=deps /app/infrastructure/pds /app/infrastructure/pds
COPY --from=deps /app/infrastructure/postgres /app/infrastructure/postgres
COPY --from=deps /app/infrastructure/seal /app/infrastructure/seal
COPY --from=deps /app/interfaces/indexer /app/interfaces/indexer
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): the
# base ships zlib1g 1:1.3.dfsg+really1.3.1-1+b1, and Debian fixed CVE-2026-76844 and CVE-2026-85091 in deb13u1, which
# no upstream index carries yet. Upgrade exactly that package to exactly that version while apt is still here.
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
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.HEALTH_PORT ?? 8081}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "interfaces/indexer/main.ts"]
