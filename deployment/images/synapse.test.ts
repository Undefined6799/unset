// The Synapse image (P6.02; ADR 0086 Decision 1, Alex's "Build our own Synapse image", 2026-11-21): what it installs
// and how it starts. Every Python package comes from one hash-pinned lock, with no dependency resolution and no source
// build, and none of the packages Synapse's OIDC, JWT or SAML sign-in would import ships. A change to any of this is
// a change to this test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");
const DOCKERFILE = read("synapse.Dockerfile");
const LOCK = read("synapse-requirements.txt");
/** The latest stable release (pypi.org/pypi/matrix-synapse/json, read 2026-11-21: 1.165.0, released 2026-11-10). */
const SYNAPSE = "1.165.0";

/** The instructions, comment lines dropped and continuation lines joined. */
const instructions = DOCKERFILE.replace(/\\\n\s*/g, " ")
  .split("\n")
  .map((line) => line.trim().replaceAll(/\s+/g, " "))
  .filter((line) => line !== "" && !line.startsWith("#"));

/** Each requirement in the lock, `name==version` with its hashes, continuation lines joined. */
const requirements = LOCK.replace(/\\\n\s*/g, " ")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => {
    const [pin = "", ...rest] = line.split(/\s+/);
    return { pin, rest };
  });

describe("synapse image", () => {
  test("synapse_installs_only_the_hash_pinned_lock", () => {
    const pips = instructions.filter((line) => line.startsWith("RUN ") && /\bpip\b.*\binstall\b/.test(line));
    expect(pips).toEqual([
      "RUN python -m venv --without-pip /opt/synapse && pip --python /opt/synapse/bin/python install --no-cache-dir " +
        "--require-hashes --no-deps --only-binary :all: -r /tmp/synapse-requirements.txt",
    ]);
    expect(requirements.length).toBeGreaterThan(0);
    for (const { pin, rest } of requirements) {
      // Exact version, and only hashes after it: no URL, index, editable or option line.
      expect(pin, pin).toMatch(/^[a-z0-9][a-z0-9._-]*==[0-9][A-Za-z0-9.]*$/);
      expect(rest.length, pin).toBeGreaterThan(0);
      for (const word of rest) expect(word, pin).toMatch(/^--hash=sha256:[0-9a-f]{64}$/);
    }
    const names = requirements.map(({ pin }) => pin.split("==")[0]);
    expect(names).toContain("matrix-synapse");
    expect(requirements.find(({ pin }) => pin.startsWith("matrix-synapse=="))?.pin).toBe(`matrix-synapse==${SYNAPSE}`);
    // libpq comes inside the psycopg2 wheel: the final stage installs no OS package (images.test.ts).
    expect(names).toContain("psycopg2-binary");
    // OIDC and JWT sign-in (authlib), SAML (pysaml2), and the other optional extras stay out; MAS signs users in.
    for (const extra of ["authlib", "pysaml2", "pyjwt", "matrix-synapse-ldap3", "sentry-sdk", "txredisapi", "lxml"]) {
      expect(names, extra).not.toContain(extra);
    }
  });

  test("synapse_start_line_pinned", () => {
    const exec = (keyword: string) =>
      instructions.filter((line) => line.startsWith(`${keyword} `)).map((line) => line.slice(keyword.length + 1));
    // No start.py, gosu or su-exec: the image never starts as root and reads one fixed config path, which C36 checks.
    expect(exec("ENTRYPOINT")).toEqual([
      '["/opt/synapse/bin/python", "-m", "synapse.app.homeserver", "-c", "/config/homeserver.yaml"]',
    ]);
    expect(exec("CMD")).toEqual([]);
    expect(exec("USER")).toEqual(["991:991"]);
    expect(exec("ENV")).toEqual([]);
    // The server rule (ADR 0085) is on the interpreter's path, where homeserver.yaml's modules entry imports it.
    expect(instructions).toContain(
      "COPY infrastructure/matrix/synapse-module/unset_chat_policy " +
        "/opt/synapse/lib/python3.13/site-packages/unset_chat_policy",
    );
  });

  test("synapse_has_no_manhole", () => {
    // The manhole is an SSH Python shell into the server, imported only for a `manhole` listener
    // (synapse/app/_base.py:366 at v1.165.0), and its module holds a fixed RSA key the secret scan flags. The build
    // stage deletes it and its bytecode before the venv is copied, so no layer holds them and such a listener fails.
    const site = "/opt/synapse/lib/python3.13/site-packages/synapse/util";
    expect(instructions).toContain(`RUN rm ${site}/manhole.py ${site}/__pycache__/manhole.cpython-313.pyc`);
    const build = instructions.slice(
      0,
      instructions.findIndex((line) => line.startsWith("FROM ") && line.endsWith("AS runtime")),
    );
    expect(build.some((line) => line.includes("manhole.py"))).toBe(true);
  });
});
