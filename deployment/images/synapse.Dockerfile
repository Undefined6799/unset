# The chat homeserver (P6.02; ADR 0086 Decision 1, Alex's "Build our own Synapse image", 2026-11-21): Synapse 1.165.0
# built on the official Python 3.13 Debian slim image (deployment/images/bases.lock.json, pulled from our GHCR mirror by
# its index digest), not upstream's image, which ships gosu, start.py and the extras' packages (76 HIGH or CRITICAL
# findings for v1.165.0 in Trivy 0.76.1 on 2026-11-21).
# Two stages on one base. The build stage installs synapse-requirements.txt into a venv with no pip of its own:
# --require-hashes so every file is the one hashed there, --no-deps so pip resolves nothing, and --only-binary :all:
# so no package's build script runs. The runtime stage copies the venv and the server rule, installs no OS package, and
# drops pip, apt, dpkg and every setuid or setgid file, as the node images do. synapse.test.ts pins what is installed
# and how it starts; synapse.image.test.ts runs it with deployment/chat/dev/homeserver.yaml.

FROM ghcr.io/undefined6799/mirror/python@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90 AS build
COPY deployment/images/synapse-requirements.txt /tmp/synapse-requirements.txt
RUN python -m venv --without-pip /opt/synapse \
  && pip --python /opt/synapse/bin/python install --no-cache-dir --require-hashes --no-deps --only-binary :all: \
    -r /tmp/synapse-requirements.txt
# The manhole, an SSH Python shell into the server, is imported only for a `manhole` listener (synapse/app/_base.py:366
# at v1.165.0), and its module holds a fixed RSA key (synapse/util/manhole.py:45) that the secret scans flag. It goes
# here, before the copy, so no shipped layer holds it, and a manhole listener fails to start.
RUN rm /opt/synapse/lib/python3.13/site-packages/synapse/util/manhole.py \
  /opt/synapse/lib/python3.13/site-packages/synapse/util/__pycache__/manhole.cpython-313.pyc

FROM ghcr.io/undefined6799/mirror/python@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=build /opt/synapse /opt/synapse/
# The server rule (P6.10a; ADR 0085), from infrastructure/matrix/synapse-module/ (its folder lands with #1864), into the
# venv's site-packages, where homeserver.yaml's `modules:` entry imports unset_chat_policy.RoomPolicy.
COPY infrastructure/matrix/synapse-module/unset_chat_policy /opt/synapse/lib/python3.13/site-packages/unset_chat_policy
# Temporary (Alex, 2026-11-16, "yes zlib exception"; ZLIB_UPGRADE in images.test.ts, expires 2026-11-30): this base
# also ships zlib1g 1:1.3.dfsg+really1.3.1-1+b1 (checked 2026-11-21), and Debian fixed CVE-2026-76844 and
# CVE-2026-85091 in deb13u1. Upgrade exactly that package to exactly that version while apt is still here.
RUN apt-get update && apt-get install -y --no-install-recommends --only-upgrade zlib1g=1:1.3.dfsg+really1.3.1-1+deb13u1 && rm -rf /var/lib/apt/lists/*
# Synapse needs the interpreter and its venv only. The base's pip and its bundled wheel go (the lock entry's stripped
# paths), then apt, debconf, dpkg and libapt through their own removal verbs, dpkg last, then dpkg's maintainer
# scripts; dpkg's database stays so scanners still see the OS packages. Last, the setuid and setgid files the Debian
# base ships (find / -xdev -perm /6000 on the base, 2026-11-21): Synapse runs as 991 and needs none.
RUN rm -rf /usr/local/lib/python3.13/site-packages/pip /usr/local/lib/python3.13/site-packages/pip-26.2.2.dist-info \
  /usr/local/lib/python3.13/ensurepip \
  && rm -f /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.13 \
  && apt-get purge --allow-remove-essential -y apt \
  && dpkg --purge --force-remove-essential --force-depends debconf dpkg libapt-pkg7.0 \
  && rm -f /var/lib/dpkg/info/*.preinst /var/lib/dpkg/info/*.postinst /var/lib/dpkg/info/*.prerm \
    /var/lib/dpkg/info/*.postrm /var/lib/dpkg/info/*.config \
  && rm -f /usr/bin/chage /usr/bin/chfn /usr/bin/chsh /usr/bin/expiry /usr/bin/gpasswd /usr/bin/mount /usr/bin/newgrp \
    /usr/bin/passwd /usr/bin/su /usr/bin/umount /usr/sbin/unix_chkpwd
# Synapse's own uid in upstream's image (docker/start.py:244-245 at v1.165.0), which owns the secrets and media the
# runbook (docs/human/runbooks/chat-servers.md) sets up.
USER 991:991
EXPOSE 8008
# GET /health answers once Synapse serves: it "is by default active for all other resources", so the client listener
# has it (docs/usage/configuration/config_documentation.md:522 at v1.165.0).
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["/opt/synapse/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8008/health', timeout=2)"]
ENTRYPOINT ["/opt/synapse/bin/python", "-m", "synapse.app.homeserver", "-c", "/config/homeserver.yaml"]
