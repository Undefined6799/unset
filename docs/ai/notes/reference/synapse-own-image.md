---
id: synapse-own-image
type: reference
status: current
areas: ["[[matrix]]", "[[deployment]]"]
summary: "Our Synapse image: hash-pinned wheels built on python:3.13-slim, run on distroless Python, no manhole, 0400 passfile."
code: [deployment/images/synapse.Dockerfile, deployment/images/synapse-requirements.txt, deployment/images/synapse.image.test.ts]
sources: [https://github.com/element-hq/synapse/blob/v1.165.0/synapse/app/_base.py, https://www.postgresql.org/docs/18/libpq-pgpass.html]
importance: high
related: ["[[mas-config-env-and-listeners]]"]
replaced_by: null
tags: [reference, matrix, deployment]
checked: 2026-11-21
---

# Our Synapse image: what bites

**The rule.** `deployment/images/synapse.Dockerfile` installs only `synapse-requirements.txt` (regenerate it with the
`uv pip compile` line in its header after editing `synapse-requirements.in`; never by hand). Three things that are not
obvious, each found by building and running it on 2026-11-21 with Synapse 1.165.0:

- **The passfile must be 0400 (or 0600) and owned by 991.** libpq ignores a password file its group or others can
  read, and Synapse then dies with `fe_sendauth: no password supplied`. The image test chowns its temp secrets with a
  root container for that reason.
- **The manhole module goes in the build stage.** `synapse/util/manhole.py` holds a fixed RSA key that Trivy's secret
  scan flags; it is imported only for a `manhole` listener (`synapse/app/_base.py:366`), so deleting it (and its
  `.pyc`) before the venv is copied keeps it out of every shipped layer. Re-check the path on each Synapse bump.
- **libpq is inside psycopg2-binary.** The final stage may not install OS packages, so `libpq5` from Debian is not an
  option; the wheel's libpq and OpenSSL are invisible to the image scan. Watch psycopg2 releases for libpq fixes.

- **No python image can ship.** Every `python:*` image carries pip, whose vendored SBOM
  (`pip/_vendor/bom.cdx.json`) fails Trivy on setuptools 70.3.0, msgpack and urllib3; pip 26.3 (2026-11-02) still
  vendors setuptools 70.3.0. So the python image is a build-only base and the runtime is
  `gcr.io/distroless/python3-debian13` (Alex's card "Yes, use distroless", 2026-11-21), which scanned 0 HIGH/CRITICAL
  with zlib1g already at deb13u1.
- **The venv must point at `/usr/bin/python3.13`.** Build it with that path linked to `/usr/local/bin/python3.13`
  (distroless python3/README.md, "Compatibility"); a venv made by `/usr/local/bin/python` keeps a dangling link in
  distroless and the entrypoint fails with "no such file or directory".
- **The final stage has no shell.** Nothing can RUN there, and tests that need to chown or poke the image use
  `/opt/synapse/bin/python` as the entrypoint, never `sh`.

Startup needs no MAS: Synapse 1.165.0 serves `/health` with `matrix_authentication_service.endpoint` unreachable.
Locally, GHCR is blocked by the agent proxy, so build a throwaway copy with `mirror.gcr.io/library/python@<digest>`
and `gcr.io/distroless/python3-debian13@<digest>` as the FROMs, and the proxy CA as `PIP_CERT` in the build stage
only.
