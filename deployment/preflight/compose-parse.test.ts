// P1.30: the strict Compose subset the preflight reads (architecture record 2026-10-07-p130-preflight-location-and-yaml):
// anything Compose could read differently from us is refused rather than guessed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { parseAllDocuments } from "yaml";
import { networksOf, ParseError, parseCompose, parseEnvFile, refuseAliasesByOption } from "./compose-parse.ts";

describe("compose subset", () => {
  const refused = (yaml: string) => expect(() => parseCompose(yaml, "c.yaml")).toThrow();
  const base = "name: unset-prod\nservices:\n  edge:\n    image: x\n";

  test("preflight_accepts_the_subset", () => {
    const compose = parseCompose(
      `${base}    ports: ["127.0.0.1:2019:2019"]\n    environment: [A=1, B=$$x]\n`,
      "c.yaml",
    );
    expect(compose.services).toMatchObject([
      { name: "edge", ports: [{ hostIp: "127.0.0.1", published: "2019", target: "2019" }] },
    ]);
  });
  test("preflight_refuses_anchor_alias_merge", () => {
    refused(`${base}    environment: &e\n      A: "1"\n  pds:\n    environment: *e\n`);
    refused(`${base}  pds:\n    <<: {image: y}\n`);
  });
  // The second layer behind the walk (docs/ai/book/phase-1.md, P1.30; book edit 2026-10-07-p130p-as-built).
  test("parser_sets_max_alias_count_zero", () => {
    refused(`${base}    environment: &e\n      A: "1"\n  pds:\n    image: y\n    environment: *e\n`);
    // With the walk skipped, the option alone still refuses the alias, naming the file.
    const [aliased] = parseAllDocuments(`a: &x 1\nb: *x\n`);
    expect(() => aliased && refuseAliasesByOption(aliased, "c.yaml")).toThrow(ParseError);
    expect(() => aliased && refuseAliasesByOption(aliased, "c.yaml")).toThrow(/^c\.yaml: alias/);
    const [plain] = parseAllDocuments(base);
    expect(() => plain && refuseAliasesByOption(plain, "c.yaml")).not.toThrow();
  });
  test("preflight_refuses_tags", () => refused(`${base}    user: !!str "1000"\n`));
  test("preflight_refuses_multi_document", () => refused(`${base}---\n${base}`));
  test("preflight_refuses_duplicate_keys", () => refused(`${base}    image: y\n`));
  test("preflight_refuses_include_and_extends", () => {
    refused(`include: [other.yaml]\n${base}`);
    refused(`${base}  pds:\n    extends: edge\n`);
  });
  test("preflight_refuses_interpolation_in_security_fields", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation text, not JS templates.
    for (const field of ["image: ${IMG}", "user: ${U}", 'ports: ["${P}:80"]', "env_file: ${F}", "privileged: ${P}"]) {
      refused(`name: unset-prod\nservices:\n  edge:\n    ${field}\n`);
    }
    refused(`${base}    environment:\n      \${K}: v\n`);
    refused(`${base}    environment:\n      A: pre\${B}\n`);
    refused(`${base}    environment:\n      A:\n`);
  });
  // P1.30n: a network's `name` is the real Docker network name, so two keys could share one network, or one key could
  // take another's `<project>_<key>`, merging networks the C17 table keeps apart. The project `name:` stays allowed.
  test("network_name_is_refused", () => {
    const stack = (networks: string) => `${base}    networks: [a, b]\nnetworks:\n${networks}`;
    // The project-level `name:` alone, with no network `name`, is accepted.
    expect(parseCompose(stack("  a: {}\n  b: {}\n"), "c.yaml").name).toBe("unset-prod");
    expect(() => parseCompose(stack("  a:\n    name: shared\n  b:\n    name: shared\n"), "c.yaml")).toThrow(
      /network a: name is refused/,
    );
    expect(() => parseCompose(stack("  a:\n    name: unset-prod_b\n  b: {}\n"), "c.yaml")).toThrow(
      /network a: name is refused/,
    );
  });
  test("preflight_refuses_ambiguous_scalars", () => refused(`${base}    environment:\n      A: 0123\n`));
});

describe("env file subset", () => {
  test("preflight_reads_strict_env_files", () => {
    expect(parseEnvFile("# note\n\nA=1\nB=\nC='lit $x'\n", "e.env")).toEqual([
      ["A", "1"],
      ["B", ""],
      ["C", "lit $x"],
    ]);
    // Anything Compose would interpolate, unquote or split differently is refused.
    for (const line of ['A="q"', "A=$B", "A=a b", "A=a#b", "export A=1", "1A=x"]) {
      expect(() => parseEnvFile(`${line}\n`, "e.env"), line).toThrow();
    }
  });
});

const digest = `sha256:${"a".repeat(64)}`;
// Every field the parser reads, so the comparison covers its whole view: a whole-reference and a `$$` value, env
// files and file secrets (the files exist, as Compose requires), and networks in both service forms beside a service
// on the implicit default network (P1.30t).
const STACK = `name: unset-prod
services:
  edge:
    image: ghcr.io/undefined6799/edge@${digest}
    ports: ["80:80", "443:443", "127.0.0.1:2019:2019"]
    networks:
      front:
        aliases: [edge]
      inner:
  pds:
    image: ghcr.io/undefined6799/mirror/pds@${digest}
    env_file: [pds.env]
    environment:
      PDS_HOSTNAME: pds.example.test
      PDS_PRICE: one$$
      PDS_ADMIN_PASSWORD: \${PDS_ADMIN_PASSWORD}
    ports:
      - target: 3000
        published: "3000"
        host_ip: 127.0.0.1
    networks: [inner]
  web:
    image: ghcr.io/undefined6799/web@${digest}
networks:
  front: {}
  inner:
    internal: true
    driver: bridge
secrets:
  pds_admin:
    file: ./pds-admin.secret
`;

/** Whether `docker compose` runs here; CI must have it (the architecture record's anti-drift test runs there). */
const hasCompose = (() => {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ROOT = join(import.meta.dirname, "..", "..");
/** Every compose file in the repository (P1.29 adds compose.dev.yaml, P5.03 the production one). */
const repositoryFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", ":(glob)**/compose*.yaml"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((file) => join(ROOT, file));

type Theirs = {
  name: string;
  services: Record<
    string,
    {
      image: string;
      env_file?: { path: string }[];
      environment?: Record<string, string | null>;
      ports?: { target: number; published?: string; host_ip?: string }[];
      networks?: Record<string, unknown>;
      network_mode?: string;
    }
  >;
  networks?: Record<string, { internal?: boolean }>;
  secrets?: Record<string, { file?: string }>;
};

/** Compose's reading of `file` (never the preflight's: only this test runs Compose), with nothing interpolated. */
function composeConfig(file: string): Theirs {
  const json = execFileSync("docker", ["compose", "-f", file, "config", "--format", "json", "--no-interpolate"], {
    encoding: "utf8",
  });
  return JSON.parse(json) as Theirs;
}

/** The parser's whole view of `file`, in Compose's terms: paths resolved beside the file, values as written. */
function oursAsCompose(file: string) {
  const ours = parseCompose(readFileSync(file, "utf8"), file);
  return {
    name: ours.name,
    services: Object.fromEntries(
      ours.services.map((service) => [
        service.name,
        {
          image: service.image,
          envFiles: service.envFiles.map((path) => resolve(dirname(file), path)),
          environment: Object.fromEntries(
            service.environment.map(([key, value]) => [
              key,
              "ref" in value ? `\${${value.ref}}` : value.literal.replaceAll("$", () => "$$"),
            ]),
          ),
          ports: service.ports,
          networks: [...service.networks].sort(),
          networkMode: service.networkMode,
        },
      ]),
    ),
    networks: Object.fromEntries(networksOf(ours).map((n) => [n.name, { internal: n.internal }])),
    secretFiles: ours.secretFiles.map((path) => resolve(dirname(file), path)).sort(),
  };
}

function theirsAsOurs(theirs: Theirs) {
  return {
    name: theirs.name,
    services: Object.fromEntries(
      Object.entries(theirs.services).map(([name, service]) => [
        name,
        {
          image: service.image,
          envFiles: (service.env_file ?? []).map((entry) => entry.path),
          environment: service.environment ?? {},
          ports: (service.ports ?? []).map((p) => ({
            hostIp: p.host_ip ?? null,
            published: p.published ?? null,
            target: `${p.target}`,
          })),
          networks: Object.keys(service.networks ?? {}).sort(),
          networkMode: service.network_mode ?? null,
        },
      ]),
    ),
    networks: Object.fromEntries(
      Object.entries(theirs.networks ?? {}).map(([name, n]) => [name, { internal: n.internal ?? false }]),
    ),
    secretFiles: Object.values(theirs.secrets ?? {})
      .flatMap((secret) => (secret.file === undefined ? [] : [secret.file]))
      .sort(),
  };
}

describe("compose agreement", () => {
  const dir = mkdtempSync(join(tmpdir(), "compose-parse-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // P1.30 core (step book record 2026-10-07-p130p-as-built): the parser's whole view (name, services, image, ports,
  // env_file, environment, file secrets and, from P1.30t, networks: each service's, its network_mode, and every network
  // with its internal flag) against Compose's, for the fixture and every compose*.yaml in the repository.
  test.runIf(hasCompose || process.env.CI)("preflight_matches_compose_config", async ({ annotate }) => {
    const fixture = join(dir, "compose.yaml");
    writeFileSync(fixture, STACK);
    writeFileSync(join(dir, "pds.env"), "PDS_PORT=3000\n");
    writeFileSync(join(dir, "pds-admin.secret"), "");
    const real = repositoryFiles();
    if (real.length === 0)
      await annotate(
        "preflight_matches_compose_config: no compose*.yaml in the repository yet, so the fixture alone was compared",
      );
    for (const file of [fixture, ...real]) {
      expect(oursAsCompose(file), file).toEqual(theirsAsOurs(composeConfig(file)));
    }
  });
});
