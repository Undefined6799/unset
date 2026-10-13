# The Postgres image (P1.29d): the official image (deployment/images/bases.lock.json), one stage, run as its own
# postgres user (999:999, which already owns its data directories) with the official docker-entrypoint.sh unchanged.
# gosu exists only to drop root, so a server that never starts as root has no use for it; and if anything ever starts
# this image as root, the entrypoint's gosu call fails instead of running Postgres as root
# (docker-library/postgres 18/trixie/docker-entrypoint.sh, `exec gosu postgres`). The package managers go as in
# node-app.Dockerfile, apt, debconf, dpkg and libapt each through its own removal verb and dpkg last, then dpkg's
# maintainer scripts, keeping dpkg's database so scanners still see the OS packages; last, the eleven setuid and
# setgid files the Debian base ships, so the postgres kind's privilege list is empty (P1.29p).
# P1.11k: the base's ssl-cert package generates a "snakeoil" key pair at upstream build time, so every copy of the
# official image carries the same private key. Nothing here uses it (no server config in this repository sets `ssl`),
# so the pair goes, and the subject-hash link to the certificate with it; bases.lock.json lists the two files as
# stripped, and the mirror scan skips them (the link is not a secret, so it is not listed).

# Upstream base until P1.27s mirrors it (book edit 2026-10-06-p127-upstream-base-by-digest); removed by P1.27s.
# hadolint ignore=DL3026
FROM docker.io/library/postgres:18-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only AND PostgreSQL"
RUN rm -rf /usr/local/bin/gosu /etc/ssl/private/ssl-cert-snakeoil.key /etc/ssl/certs/ssl-cert-snakeoil.pem \
    /etc/ssl/certs/ce275665.0 \
  && apt-get purge --allow-remove-essential -y apt \
  && dpkg --purge --force-remove-essential --force-depends debconf dpkg libapt-pkg7.0 \
  && rm -f /var/lib/dpkg/info/*.preinst /var/lib/dpkg/info/*.postinst /var/lib/dpkg/info/*.prerm \
    /var/lib/dpkg/info/*.postrm /var/lib/dpkg/info/*.config \
  && rm -f /usr/bin/chage /usr/bin/chfn /usr/bin/chsh /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount /usr/bin/newgrp \
    /usr/bin/passwd /usr/bin/su /usr/bin/umount /usr/sbin/unix_chkpwd
USER 999:999
# Ready once the server accepts connections on its own socket (P1.29; Compose's `depends_on: service_healthy` waits on
# it). Exec form, with the timings the other images use; pg_isready ships in the base (PostgreSQL 18 docs, pg_isready).
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["pg_isready", "-h", "/var/run/postgresql"]
