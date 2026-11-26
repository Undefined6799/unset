# The review image (ADR 0070 point 2.2): `node interfaces/review/main.ts`, the process that turns a member's upload
# into the versions we keep, in sandboxed children. Built like the indexer image: two stages on the locked Node base,
# production dependencies only, then a runtime stage that copies just the workspaces the process loads and runs as
# 65532. It holds no secret. sharp's prebuilt libvips (LGPL-3.0) ships with its licence texts and a pointer to its
# source at /app/deployment/images/review-notices (SOURCE.md there).
# node-app.test.ts review_image_copies_every_workspace_the_process_reaches fails when a workspace is missing.

FROM ghcr.io/undefined6799/mirror/node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev

FROM ghcr.io/undefined6799/mirror/node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only AND LGPL-3.0-or-later"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/package.json /app/package.json
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/shared /app/shared
COPY --from=deps /app/domains/content /app/domains/content
COPY --from=deps /app/infrastructure/image /app/infrastructure/image
COPY --from=deps /app/interfaces/review /app/interfaces/review
COPY --from=deps /app/deployment/images/review-notices /app/deployment/images/review-notices
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): as in the
# indexer image.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 && rm -rf /var/lib/apt/lists/*
# The process needs node and util-linux's prlimit (each child's address-space limit) only, so every package manager
# the base may ship leaves the runtime, apt and dpkg included, then the base's setuid and setgid files.
# review.image.test.ts runs the built image's prlimit, so a base without it fails there.
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
EXPOSE 8082
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.LISTEN_PORT ?? 8082}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "interfaces/review/main.ts"]
