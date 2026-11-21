---
id: synapse-own-image
type: reference
status: current
areas: ["[[matrix]]", "[[deployment]]"]
summary: "Our Synapse image: hash-pinned wheels on the Python base, no manhole, and a 0400 passfile owned by 991."
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

Startup needs no MAS: Synapse 1.165.0 serves `/health` with `matrix_authentication_service.endpoint` unreachable.
Locally, `deb.debian.org` is blocked by the agent proxy, so the zlib upgrade line can only be checked in CI; build a
throwaway copy without that line (and with `mirror.gcr.io/library/python@<digest>` as FROM and the proxy CA in the
build stage only) to test everything else.
