# The chat-admin image (P6.04; ADR 0081 decision 5, ADR 0091): the internal service that alone holds the MAS admin
# client's secret, creates chat accounts, mints and ends sessions and sweeps idle plain rooms,
# `node interfaces/chat-admin/main.ts`. Built as pds-admin.Dockerfile is: two stages on the locked Node base
# (deployment/images/bases.lock.json, the same digest and GHCR mirror as the other Node images, P2.26b). The service
# has no third-party package (ADR 0081 decision 5, the zero-dependency rule), so the deps stage installs the workspace
# and then deletes everything in node_modules but the one workspace link chat-admin imports,
# `@unset/shared-admin-envelope`; the runtime stage copies that link, its folder and the service, nothing else. Node
# runs the TypeScript sources directly, so there is no build stage; the runtime stage installs no OS packages but the
# zlib upgrade below.

FROM ghcr.io/undefined6799/mirror/node@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS deps
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --omit=dev
RUN find node_modules -mindepth 1 -maxdepth 1 ! -name @unset -exec rm -r {} + \
  && find node_modules/@unset -mindepth 1 -maxdepth 1 ! -name shared-admin-envelope -exec rm -r {} +
# The service's STATE_DIR (replay guard and quota chains), empty here: compose mounts a named volume over it, and a
# fresh volume takes the owner and mode of the directory it covers, so only 65532 can read or write it. Made inside
# /stage, as in pds-admin.Dockerfile (#1720: a directory copied as the COPY source keeps 0755 whatever --chmod says).
RUN mkdir -p -m 0700 /stage/state

FROM ghcr.io/undefined6799/mirror/node@sha256:930557a230abacbc3f4fd9b8648abf8f4bee1e17cb72195dcdfb2f709bc85b33 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/shared/admin-envelope /app/shared/admin-envelope
COPY --from=deps /app/interfaces/chat-admin /app/interfaces/chat-admin
COPY --from=deps --chown=65532:65532 --chmod=0700 /stage/ /app/
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): the
# base ships zlib1g 1:1.3.dfsg+really1.3.1-1+b1, and Debian fixed CVE-2026-76844 and CVE-2026-85091 in deb13u1, which
# no upstream index carries yet. Upgrade exactly that package to exactly that version while apt is still here.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 && rm -rf /var/lib/apt/lists/*
# The service needs node only, so every package manager the base may ship leaves the runtime, apt and dpkg included,
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
ENTRYPOINT ["node", "interfaces/chat-admin/main.ts"]
