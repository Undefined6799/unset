# The door's image (P6.03, P6.06; ADR 0093 decision 4, ADR 0099 decision 1): `node interfaces/chat-auth/main.ts`, the
# unset.cc door, with the chat page's static build it serves. Three stages on the locked Node base
# (deployment/images/bases.lock.json, the same digest and GHCR mirror as the web image, P2.26b): build the page with
# Vite, install production dependencies, then a runtime stage that copies just the workspaces the door loads and the
# built page, and runs as 65532. Node runs the door's TypeScript sources directly, so only the page is built. The only
# OS package step is the temporary zlib upgrade below, as in the other Node images.
# node-app.test.ts chat_auth_image_copies_every_workspace_the_door_reaches fails when a workspace is missing.

FROM ghcr.io/undefined6799/mirror/node@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS build
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts
# apps/chat/vite.config.ts writes index.html and the hashed files to apps/chat/dist/page/, where main.ts reads them.
RUN npm run build -w @unset/apps-chat

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
# The door's domains and adapters: the messaging rules, identity's types, and the Postgres adapter with the domains
# its stores are typed in; the chat-admin client in the Matrix adapter, net-guard and sealing.
COPY --from=deps /app/domains/content /app/domains/content
COPY --from=deps /app/domains/identity /app/domains/identity
COPY --from=deps /app/domains/messaging /app/domains/messaging
COPY --from=deps /app/domains/notifications /app/domains/notifications
COPY --from=deps /app/domains/profile /app/domains/profile
COPY --from=deps /app/infrastructure/matrix /app/infrastructure/matrix
COPY --from=deps /app/infrastructure/net-guard /app/infrastructure/net-guard
COPY --from=deps /app/infrastructure/postgres /app/infrastructure/postgres
COPY --from=deps /app/infrastructure/seal /app/infrastructure/seal
COPY --from=deps /app/interfaces/chat-auth /app/interfaces/chat-auth
# The chat page (ADR 0099 decision 1): the build alone, none of apps/chat's sources.
COPY --from=build /app/apps/chat/dist/page /app/apps/chat/dist/page
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): the
# base ships zlib1g 1:1.3.dfsg+really1.3.1-1+b1, and Debian fixed CVE-2026-76844 and CVE-2026-85091 in deb13u1, which
# no upstream index carries yet. Upgrade exactly that package to exactly that version while apt is still here.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 && rm -rf /var/lib/apt/lists/*
# The door needs node only, so every package manager the base may ship leaves the runtime, apt and dpkg included,
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
ENTRYPOINT ["node", "interfaces/chat-auth/main.ts"]
