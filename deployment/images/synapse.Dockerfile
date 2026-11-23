# The chat homeserver (P6.02; ADR 0098 Decision 1, Alex's "Build our own Synapse image", 2026-11-21): Synapse 1.165.0
# from pinned, hash-checked wheels, not upstream's image, which ships gosu, start.py and the extras' packages (76 HIGH
# or CRITICAL findings for v1.165.0 in Trivy 0.76.1 on 2026-11-21).
# The venv is built on the official Python 3.13 image and runs on Debian's own python3.13 in distroless
# python3-debian13 (Alex's card "Yes, use distroless", 2026-11-21): every python image ships pip, whose vendored
# setuptools 70.3.0, msgpack and urllib3 fail the mirror scan (pip 26.3 still vendors setuptools 70.3.0), and
# distroless has no pip, shell, apt, dpkg or setuid file to remove. Both bases are in bases.lock.json and pulled from
# our GHCR mirror by index digest; the python one is build-only. Distroless documents this pairing: build on
# python:3.13-slim-trixie for python3-debian13, with the venv linked to the distroless interpreter path
# (GoogleContainerTools/distroless python3/README.md, "Compatibility", read 2026-11-21).
# The build stage installs synapse-requirements.txt into a venv with no pip of its own: --require-hashes so every file
# is the one hashed there, --no-deps so pip resolves nothing, and --only-binary :all: so no package's build script
# runs. The final stage only copies; it has no shell to run anything with. synapse.test.ts pins what is installed and
# how it starts; synapse.image.test.ts runs it with deployment/chat/dev/homeserver.yaml.

FROM ghcr.io/undefined6799/mirror/python@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90 AS build
COPY deployment/images/synapse-requirements.txt /tmp/synapse-requirements.txt
# The venv's interpreter link is made at /usr/bin/python3.13, where distroless has Debian's python3.13 (3.13.5 at
# 6c4cb3bf): cp313 wheels and 3.13 bytecode run on any 3.13 patch release. Synapse 1.165.0 needs Python >=3.11.0
# (pyproject.toml:9 at v1.165.0).
RUN ln -s /usr/local/bin/python3.13 /usr/bin/python3.13 \
  && /usr/bin/python3.13 -m venv --without-pip /opt/synapse \
  && pip --python /opt/synapse/bin/python install --no-cache-dir --require-hashes --no-deps --only-binary :all: \
    -r /tmp/synapse-requirements.txt
# The manhole, an SSH Python shell into the server, is imported only for a `manhole` listener (synapse/app/_base.py:366
# at v1.165.0), and its module holds a fixed RSA key (synapse/util/manhole.py:45) that the secret scans flag. It goes
# here, before the copy, so no shipped layer holds it, and a manhole listener fails to start.
RUN rm /opt/synapse/lib/python3.13/site-packages/synapse/util/manhole.py \
  /opt/synapse/lib/python3.13/site-packages/synapse/util/__pycache__/manhole.cpython-313.pyc
# homeserver.yaml's media_store_path, empty here: compose mounts a named volume over /data/media, and a fresh volume
# takes the owner and mode of the directory it covers, so only Synapse's 991 can read or write the media. Made inside
# /stage and copied by its contents, as pds-admin.Dockerfile's state folder is (#1720).
RUN mkdir -p -m 0700 /stage/media

FROM ghcr.io/undefined6799/mirror/python3-debian13@sha256:6c4cb3bfa4b555429dd19541796a6ba6b30c84675b460bd0bd5072f7d5bdae71 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Undefined6799/unset"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
COPY --from=build /opt/synapse /opt/synapse/
COPY --from=build --chown=991:991 --chmod=0700 /stage/ /data/
# The server rule (P6.10a; ADR 0097), from infrastructure/matrix/synapse-module/ (its folder lands with #1864), into the
# venv's site-packages, where homeserver.yaml's `modules:` entry imports unset_chat_policy.RoomPolicy.
COPY infrastructure/matrix/synapse-module/unset_chat_policy /opt/synapse/lib/python3.13/site-packages/unset_chat_policy
# Synapse's own uid in upstream's image (docker/start.py:244-245 at v1.165.0), which owns the secrets and media the
# runbook (docs/human/runbooks/chat-servers.md) sets up.
USER 991:991
EXPOSE 8008
# GET /health answers once Synapse serves: it "is by default active for all other resources", so the client listener
# has it (docs/usage/configuration/config_documentation.md:522 at v1.165.0). Synapse binds only its fixed addresses,
# never 127.0.0.1 (homeserver.yaml), so the check asks the first listener's first address, read from the config the
# container runs, with the PyYAML Synapse itself loads it with.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["/opt/synapse/bin/python", "-c", "import urllib.request, yaml; l = yaml.safe_load(open('/config/homeserver.yaml'))['listeners'][0]; urllib.request.urlopen('http://%s:%d/health' % (l['bind_addresses'][0], l['port']), timeout=2)"]
ENTRYPOINT ["/opt/synapse/bin/python", "-m", "synapse.app.homeserver", "-c", "/config/homeserver.yaml"]
