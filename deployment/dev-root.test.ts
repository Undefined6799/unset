// P1.33g: the runbook's dev root recipe, run as written on a throwaway root (record
// 2026-10-12-p134c-p134d-local-dev-root-ca, Amendments 1 and 2). The root may vouch only for the two local hosts and
// the names under them, never an IP address and never another CA. `openssl verify` judges the chains: it is the
// OpenSSL that Node's TLS, and so pds and web through NODE_EXTRA_CA_CERTS, verifies with (OpenSSL 3.0.13 here,
// `openssl verify` -help: -CAfile, -untrusted, -verify_hostname).
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const RUNBOOK = resolve(import.meta.dirname, "../docs/human/runbooks/dev-stack-secrets.md");
const SECTION = "## The local stack's dev root and leaf (P1.33g)";
const HOSTS = { APP_HOST: "app.localhost", PDS_HOST: "pds.localhost" };
const DAY_MS = 86_400_000;

/** The section's sh blocks in order: the root, the leaf, then the install lines, which need root and are not run. */
function recipe(): string[] {
  const text = readFileSync(RUNBOOK, "utf8");
  const start = text.indexOf(SECTION);
  if (start === -1) throw new Error(`the runbook has no section "${SECTION}"`);
  const end = text.indexOf("\n## ", start + SECTION.length);
  const section = text.slice(start, end === -1 ? undefined : end);
  return [...section.matchAll(/^```sh\n([\s\S]*?)^```$/gm)].map((match) => match[1] ?? "");
}

describe("the runbook's local dev root (P1.33g)", () => {
  let dir = "";
  const ca = (name: string) => join(dir, "unset-dev-ca", name);
  const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  /** `openssl verify` against the recipe's root; the error text when it refuses, "OK" when it accepts. */
  const verify = (leaf: string, ...extra: string[]): string => {
    const run = spawnSync("openssl", ["verify", "-CAfile", ca("root.pem"), ...extra, leaf], {
      cwd: dir,
      encoding: "utf8",
    });
    return run.status === 0 ? "OK" : (/error \d+ at \d+ depth lookup: (.+)/.exec(run.stdout + run.stderr)?.[1] ?? "?");
  };
  let made = 0;
  /** A certificate signed by `issuer` (the recipe's root unless named), with the given subject and extensions. */
  const signed = (subject: string, extensions: string[], issuer = ca("root")): string => {
    const name = join(dir, `made${made++}`);
    openssl(
      ...`req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ${name}.key -out ${name}.pem`.split(
        " ",
      ),
      ...["-days", "30", "-subj", subject, "-CA", `${issuer}.pem`, "-CAkey", `${issuer}.key`],
      ...extensions.flatMap((extension) => ["-addext", extension]),
    );
    return `${name}.pem`;
  };
  const leaf = (subject: string, san?: string) =>
    signed(subject, ["basicConstraints=critical,CA:FALSE", ...(san === undefined ? [] : [`subjectAltName=${san}`])]);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "dev-root-"));
    const [root, issue] = recipe();
    for (const block of [root, issue]) {
      execFileSync("sh", ["-e", "-c", block ?? "exit 1"], {
        cwd: dir,
        env: { ...process.env, ...HOSTS },
        stdio: "pipe",
      });
    }
  });
  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  test("recipe_has_the_root_leaf_and_install_blocks", () => {
    expect(recipe()).toHaveLength(3);
  });

  test("recipe_root_is_a_constrained_ca_for_at_most_825_days", () => {
    const root = new X509Certificate(readFileSync(ca("root.pem")));
    expect(root.ca).toBe(true);
    expect(root.validToDate.getTime() - root.validFromDate.getTime()).toBeLessThanOrEqual(825 * DAY_MS);
    const text = openssl("x509", "-noout", "-text", "-in", ca("root.pem")).toString();
    expect(text).toMatch(/Basic Constraints: critical\n\s+CA:TRUE, pathlen:0\n/);
    expect(text).toMatch(/Key Usage: critical\n\s+Certificate Sign, CRL Sign\n/);
    expect(text).toMatch(
      /Name Constraints: critical\n\s+Permitted:\n\s+DNS:app\.localhost\n\s+DNS:pds\.localhost\n\s+Excluded:\n\s+IP:0\.0\.0\.0\/0\.0\.0\.0\n\s+IP:0:0:0:0:0:0:0:0\/0:0:0:0:0:0:0:0\n/,
    );
    // The key and the folder are the deploy user's alone; the trusted copy is the same bytes, readable by the services.
    expect(statSync(ca("root.key")).mode & 0o777).toBe(0o400);
    expect(statSync(join(dir, "unset-dev-ca")).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(dir, "unset-dev-trust/root.pem"))).toEqual(readFileSync(ca("root.pem")));
    expect(statSync(join(dir, "unset-dev-trust/root.pem")).mode & 0o777).toBe(0o644);
    expect(statSync(join(dir, "unset-dev-trust")).mode & 0o777).toBe(0o755);
  });

  test("recipe_trust_copy_reruns_and_replaces_a_link", () => {
    // P1.35p S3 and N6 (verify-896): the copy lines run again where the folder already exists, and a link left at
    // unset-dev-trust/root.pem is replaced by the file, never written through. Measured with GNU coreutils 9.4: install
    // replaces the link and leaves its target alone, cp writes through it, and mkdir -m fails on an existing folder.
    const lines = (recipe()[0] ?? "").split("\n").filter((line) => line.includes("unset-dev-trust"));
    const trust = join(dir, "unset-dev-trust");
    writeFileSync(join(dir, "elsewhere.pem"), "outside\n");
    rmSync(join(trust, "root.pem"));
    symlinkSync("../elsewhere.pem", join(trust, "root.pem"));
    execFileSync("sh", ["-e", "-c", lines.join("\n")], { cwd: dir, stdio: "pipe" });
    expect(lstatSync(join(trust, "root.pem")).isFile()).toBe(true);
    expect(readFileSync(join(trust, "root.pem"))).toEqual(readFileSync(ca("root.pem")));
    expect(statSync(join(trust, "root.pem")).mode & 0o777).toBe(0o644);
    expect(statSync(trust).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(dir, "elsewhere.pem"), "utf8")).toBe("outside\n");
  });

  test("recipe_leaf_serves_exactly_the_two_hosts_for_397_days", () => {
    const issued = new X509Certificate(readFileSync(ca("leaf.pem")));
    expect(issued.ca).toBe(false);
    expect(issued.subjectAltName).toBe("DNS:app.localhost, DNS:pds.localhost");
    expect(issued.validToDate.getTime() - issued.validFromDate.getTime()).toBe(397 * DAY_MS);
    expect(issued.publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(openssl("x509", "-noout", "-ext", "extendedKeyUsage", "-in", ca("leaf.pem")).toString()).toMatch(
      /TLS Web Server Authentication\n$/,
    );
    for (const host of Object.values(HOSTS)) expect(verify(ca("leaf.pem"), "-verify_hostname", host), host).toBe("OK");
  });

  test("throwaway_root_refuses_every_name_beyond_the_two_hosts", () => {
    // Amendment 2's refusals: an unrelated DNS leaf, IP-only leaves, a CN-only unrelated leaf, and a sub-CA's leaf.
    expect(verify(leaf("/CN=x", "DNS:other.localhost"))).toBe("permitted subtree violation");
    expect(verify(leaf("/CN=x", "IP:127.0.0.1"))).toBe("excluded subtree violation");
    expect(verify(leaf("/CN=x", "IP:::1"))).toBe("excluded subtree violation");
    expect(verify(leaf("/CN=other.localhost"))).toBe("permitted subtree violation");
    const sub = signed("/CN=sub", ["basicConstraints=critical,CA:TRUE", "keyUsage=critical,keyCertSign"]);
    const below = signed(
      "/CN=x",
      ["basicConstraints=critical,CA:FALSE", "subjectAltName=DNS:app.localhost"],
      sub.slice(0, -4),
    );
    expect(verify(below, "-untrusted", sub)).toBe("path length constraint exceeded");
    // And it passes each exact host, alone or together; names under them are admitted (Amendment 2: accepted).
    expect(verify(leaf("/CN=x", "DNS:app.localhost"))).toBe("OK");
    expect(verify(leaf("/CN=x", "DNS:pds.localhost"))).toBe("OK");
    expect(verify(leaf("/CN=x", "DNS:app.localhost,DNS:pds.localhost"))).toBe("OK");
    expect(verify(leaf("/CN=x", "DNS:handle.pds.localhost"))).toBe("OK");
  });
});
